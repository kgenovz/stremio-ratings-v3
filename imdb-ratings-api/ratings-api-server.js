const express = require('express');
const axios = require('axios');
const fs = require('fs');
const readline = require('readline');
const zlib = require('zlib');
const cron = require('node-cron');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const port = process.env.PORT || 3001;

// Add JSON body parser for new endpoints
app.use(express.json());

// Database setup
const dbPath = path.join(__dirname, 'ratings.db');
let db;
let lastUpdated = null;
let ratingsCount = 0;
let episodesCount = 0;

// Helper functions for IMDb ID compression
function imdbToInt(imdbId) {
    return parseInt(imdbId.replace('tt', ''));
}

function intToImdb(num) {
    return 'tt' + num.toString().padStart(7, '0');
}

// Initialize database
function initDatabase() {
    try {
        db = new Database(dbPath);
        console.log('Connected to database');
        
        // Enable performance optimizations
        db.pragma('journal_mode = DELETE');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = 10000');
        db.pragma('temp_store = memory');
        db.pragma('mmap_size = 268435456'); // 256MB
        
        // Create optimized tables with compressed IDs
        db.exec(`CREATE TABLE IF NOT EXISTS ratings (
            imdb_id INTEGER PRIMARY KEY,
            rating REAL NOT NULL,
            votes INTEGER DEFAULT 0
        ) WITHOUT ROWID`);
        
        // Only store episodes that have ratings (filtered)
        db.exec(`CREATE TABLE IF NOT EXISTS episodes (
            series_id INTEGER NOT NULL,
            season INTEGER NOT NULL,
            episode INTEGER NOT NULL,
            episode_id INTEGER NOT NULL,
            PRIMARY KEY (series_id, season, episode)
        ) WITHOUT ROWID`);
        
        // *** NEW: Add caching and mapping tables ***
        // Table for persistent API response caching
        db.exec(`CREATE TABLE IF NOT EXISTS api_cache (
            cache_key TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        ) WITHOUT ROWID`);
        
        // Table for Kitsu → IMDb mappings (permanent storage)
        db.exec(`CREATE TABLE IF NOT EXISTS kitsu_imdb_mappings (
            kitsu_id TEXT PRIMARY KEY,
            imdb_id TEXT NOT NULL,
            source TEXT DEFAULT 'api_discovery',
            confidence_score INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            last_verified INTEGER NOT NULL
        ) WITHOUT ROWID`);
        
        // Optional: Table for TMDB metadata (rich metadata caching)
        db.exec(`CREATE TABLE IF NOT EXISTS tmdb_metadata (
            tmdb_key TEXT PRIMARY KEY,
            tmdb_id INTEGER NOT NULL,
            media_type TEXT NOT NULL,
            imdb_id TEXT,
            title TEXT,
            original_title TEXT,
            year INTEGER,
            genres TEXT,
            episode_count INTEGER,
            popularity REAL,
            data TEXT,
            updated_at INTEGER NOT NULL
        ) WITHOUT ROWID`);
        
        // Optimized indexes
        db.exec(`CREATE INDEX IF NOT EXISTS idx_episodes_lookup ON episodes(series_id, season, episode)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_episodes_id ON episodes(episode_id)`);
        
        // *** NEW: Indexes for caching tables ***
        db.exec(`CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_kitsu_mappings_imdb ON kitsu_imdb_mappings(imdb_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tmdb_metadata_imdb ON tmdb_metadata(imdb_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tmdb_metadata_title ON tmdb_metadata(title)`);
        
        console.log('✅ Database tables and indexes created');
        return Promise.resolve();
    } catch (err) {
        return Promise.reject(err);
    }
}

// Function to download and extract a gzipped TSV file
async function downloadAndExtract(url, filename) {
    console.log(`Downloading ${filename}...`);
    
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }
    
    const gzipFilePath = path.join(dataDir, `${filename}.gz`);
    const tsvFilePath = path.join(dataDir, filename);
    
    // Download
    const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream'
    });
    
    const fileWriter = fs.createWriteStream(gzipFilePath);
    response.data.pipe(fileWriter);
    
    await new Promise((resolve, reject) => {
        fileWriter.on('finish', resolve);
        fileWriter.on('error', reject);
    });
    
    console.log(`Extracting ${filename}...`);
    
    // Extract
    const fileStream = fs.createReadStream(gzipFilePath);
    const unzipStream = zlib.createGunzip();
    const outputStream = fs.createWriteStream(tsvFilePath);
    
    fileStream.pipe(unzipStream).pipe(outputStream);
    
    await new Promise((resolve, reject) => {
        outputStream.on('finish', resolve);
        outputStream.on('error', reject);
    });
    
    // Clean up compressed file
    fs.unlinkSync(gzipFilePath);
    
    return tsvFilePath;
}

// Process ratings into database
async function processRatings(filePath) {
    console.log('Processing ratings into database...');
    
    return new Promise(async (resolve, reject) => {
        // Clear existing data
        db.exec("DELETE FROM ratings");
        
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity
        });
        
        let headerSkipped = false;
        let processedLines = 0;
        const batchSize = 1000;
        let batch = [];
        
        // Prepare insert statement
        const stmt = db.prepare("INSERT OR REPLACE INTO ratings (imdb_id, rating, votes) VALUES (?, ?, ?)");
        
        for await (const line of rl) {
            if (!headerSkipped) {
                headerSkipped = true;
                continue;
            }
            
            const [tconst, averageRating, numVotes] = line.split('\t');
            if (tconst && averageRating && averageRating !== 'N/A') {
                batch.push([
                    imdbToInt(tconst),
                    parseFloat(averageRating),
                    parseInt(numVotes) || 0
                ]);
                
                // Insert in batches for performance
                if (batch.length >= batchSize) {
                    const transaction = db.transaction((rows) => {
                        for (const row of rows) stmt.run(row);
                    });
                    transaction(batch);
                    
                    processedLines += batch.length;
                    batch = [];
                    
                    if (processedLines % 50000 === 0) {
                        console.log(`   Processed ${processedLines.toLocaleString()} ratings...`);
                    }
                }
            }
        }
        
        // Insert remaining batch
        if (batch.length > 0) {
            const transaction = db.transaction((rows) => {
                for (const row of rows) stmt.run(row);
            });
            transaction(batch);
            processedLines += batch.length;
        }
        
        ratingsCount = processedLines;
        
        console.log(`Loaded ${ratingsCount.toLocaleString()} ratings into database`);
        
        // Clean up file
        fs.unlinkSync(filePath);
        resolve();
    });
}

// Process episodes into database (FILTERED!)
async function processEpisodes(filePath) {
    console.log('Processing episodes into database (filtered for ratings)...');
    
    return new Promise(async (resolve, reject) => {
        // Clear existing data
        db.exec("DELETE FROM episodes");
        
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity
        });
        
        let headerSkipped = false;
        let processedLines = 0;
        let filteredLines = 0;
        const batchSize = 1000;
        let batch = [];
        
        // Prepare statements
        const stmt = db.prepare("INSERT OR REPLACE INTO episodes (series_id, season, episode, episode_id) VALUES (?, ?, ?, ?)");
        const checkRating = db.prepare("SELECT 1 FROM ratings WHERE imdb_id = ? LIMIT 1");
        
        for await (const line of rl) {
            if (!headerSkipped) {
                headerSkipped = true;
                continue;
            }
            
            const [episodeId, seriesId, seasonNum, episodeNum] = line.split('\t');
            
            if (episodeId && seriesId && seasonNum && episodeNum && 
                seasonNum !== '\\N' && episodeNum !== '\\N') {
                
                processedLines++;
                
                // FILTER: Only store episodes that have ratings!
                const episodeIdInt = imdbToInt(episodeId);
                const hasRating = checkRating.get(episodeIdInt);
                
                if (hasRating) {
                    batch.push([
                        imdbToInt(seriesId),
                        parseInt(seasonNum),
                        parseInt(episodeNum),
                        episodeIdInt
                    ]);
                    filteredLines++;
                    
                    // Insert in batches
                    if (batch.length >= batchSize) {
                        const transaction = db.transaction((rows) => {
                            for (const row of rows) stmt.run(row);
                        });
                        transaction(batch);
                        
                        batch = [];
                        
                        if (filteredLines % 25000 === 0) {
                            console.log(`   Processed ${processedLines.toLocaleString()} episodes, stored ${filteredLines.toLocaleString()} with ratings...`);
                        }
                    }
                }
                
                if (processedLines % 100000 === 0) {
                    console.log(`   Scanned ${processedLines.toLocaleString()} episodes, found ${filteredLines.toLocaleString()} with ratings...`);
                }
            }
        }
        
        // Insert remaining batch
        if (batch.length > 0) {
            const transaction = db.transaction((rows) => {
                for (const row of rows) stmt.run(row);
            });
            transaction(batch);
        }
        
        episodesCount = filteredLines;
        
        console.log(`Loaded ${episodesCount.toLocaleString()} episode mappings (filtered from ${processedLines.toLocaleString()} total)`);
        console.log(`Storage efficiency: ${((episodesCount / processedLines) * 100).toFixed(1)}% of episodes stored`);
        
        // Clean up file
        fs.unlinkSync(filePath);
        resolve();
    });
}

// Main function to download and process all datasets
async function downloadAndProcessAllData() {
    console.log('Starting optimized IMDb data download...')
    
    try {
        // Download and process ratings FIRST (needed for filtering)
        const ratingsFile = await downloadAndExtract(
            'https://datasets.imdbws.com/title.ratings.tsv.gz',
            'title.ratings.tsv'
        );
        await processRatings(ratingsFile);
        
        // Download and process episodes (filtered against ratings)
        const episodesFile = await downloadAndExtract(
            'https://datasets.imdbws.com/title.episode.tsv.gz',
            'title.episode.tsv'
        );
        await processEpisodes(episodesFile);
        
        // Optimize database
        console.log('Optimizing database...');
        db.pragma('optimize');
        
        lastUpdated = new Date();
        
        const dbSize = fs.statSync(dbPath).size;
        console.log('All datasets processed and optimized!');
        console.log(`Total ratings: ${ratingsCount.toLocaleString()}`);
        console.log(`Total episodes: ${episodesCount.toLocaleString()}`);
        console.log(`Memory usage: ~${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
        console.log(`Database size: ~${Math.round(dbSize / 1024 / 1024)} MB`);
        console.log(`Compression ratio: ${((episodesCount / 7000000) * 100).toFixed(1)}% of original episode data stored`);
        
        return true;
        
    } catch (error) {
        console.error('Error processing IMDb data:', error);
        return false;
    }
}

// *** EXISTING API ENDPOINTS ***

// API endpoint for ratings
app.get('/api/rating/:id', (req, res) => {
    const id = req.params.id;
    
    if (!id || !id.startsWith('tt')) {
        return res.status(400).json({ error: 'Invalid ID. Must start with "tt"' });
    }
    
    const idInt = imdbToInt(id);
    
    try {
        const row = db.prepare("SELECT rating, votes FROM ratings WHERE imdb_id = ?").get(idInt);
        
        if (row) {
            return res.json({ 
                id, 
                rating: row.rating.toFixed(1),
                votes: row.votes.toString(),
                type: 'direct'
            });
        } else {
            return res.status(404).json({ error: 'Rating not found for the specified ID' });
        }
    } catch (err) {
        return res.status(500).json({ error: 'Database error' });
    }
});

// API endpoint for episode ratings
app.get('/api/episode/:seriesId/:season/:episode', (req, res) => {
    const { seriesId, season, episode } = req.params;
    
    if (!seriesId || !seriesId.startsWith('tt')) {
        return res.status(400).json({ error: 'Invalid series ID. Must start with "tt"' });
    }
    
    const seriesIdInt = imdbToInt(seriesId);
    
    try {
        // Look up episode IMDb ID using compressed IDs
        const episodeRow = db.prepare("SELECT episode_id FROM episodes WHERE series_id = ? AND season = ? AND episode = ?")
                             .get(seriesIdInt, parseInt(season), parseInt(episode));
        
        if (!episodeRow) {
            return res.status(404).json({ 
                error: 'Episode not found',
                seriesId,
                season,
                episode 
            });
        }
        
        // Get rating for the episode
        const ratingRow = db.prepare("SELECT rating, votes FROM ratings WHERE imdb_id = ?")
                            .get(episodeRow.episode_id);
        
        if (ratingRow) {
            return res.json({
                seriesId,
                season: parseInt(season),
                episode: parseInt(episode),
                episodeId: intToImdb(episodeRow.episode_id),
                rating: ratingRow.rating.toFixed(1),
                votes: ratingRow.votes.toString(),
                type: 'episode'
            });
        } else {
            return res.status(404).json({ 
                error: 'Rating not found for episode',
                episodeId: intToImdb(episodeRow.episode_id)
            });
        }
    } catch (err) {
        return res.status(500).json({ error: 'Database error' });
    }
});

// *** NEW: Episode rating by episode ID (for Cinemeta fix) ***
app.get('/api/episode/id/:episodeId', (req, res) => {
    const { episodeId } = req.params;
    
    if (!episodeId || !episodeId.startsWith('tt')) {
        return res.status(400).json({ error: 'Invalid episode ID. Must start with "tt"' });
    }
    
    const episodeIdInt = imdbToInt(episodeId);
    
    try {
        // Get rating for the episode directly
        const ratingRow = db.prepare("SELECT rating, votes FROM ratings WHERE imdb_id = ?")
                            .get(episodeIdInt);
        
        if (ratingRow) {
            return res.json({
                episodeId,
                rating: ratingRow.rating.toFixed(1),
                votes: ratingRow.votes.toString(),
                type: 'episode'
            });
        } else {
            return res.status(404).json({ 
                error: 'Rating not found for episode ID',
                episodeId
            });
        }
    } catch (err) {
        return res.status(500).json({ error: 'Database error' });
    }
});

// *** NEW: CACHING API ENDPOINTS ***

// GET /api/cache/:key - Get cached data
app.get('/api/cache/:key', (req, res) => {
    try {
        const { key } = req.params;
        const decodedKey = decodeURIComponent(key);
        const now = Date.now();
        
        const result = db.prepare(
            'SELECT data, timestamp FROM api_cache WHERE cache_key = ? AND expires_at > ?'
        ).get(decodedKey, now);
        
        if (result) {
            let parsedData;
            try {
                parsedData = JSON.parse(result.data);
            } catch (e) {
                return res.status(500).json({ error: 'Invalid cached data format' });
            }
            
            res.json({
                data: parsedData,
                timestamp: new Date(result.timestamp).toISOString(),
                cached: true
            });
        } else {
            res.status(404).json({ error: 'Cache miss' });
        }
    } catch (error) {
        console.error('Cache read error:', error);
        res.status(500).json({ error: 'Cache read failed' });
    }
});

// POST /api/cache - Store cached data
app.post('/api/cache', (req, res) => {
    try {
        const { key, data, timestamp } = req.body;
        
        if (!key || !data) {
            return res.status(400).json({ error: 'Missing key or data' });
        }
        
        const timestampMs = timestamp ? new Date(timestamp).getTime() : Date.now();
        const expiresAt = timestampMs + (60 * 60 * 1000); // 1 hour from timestamp
        
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO api_cache (cache_key, data, timestamp, expires_at) 
            VALUES (?, ?, ?, ?)
        `);
        
        stmt.run(key, JSON.stringify(data), timestampMs, expiresAt);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Cache write error:', error);
        res.status(500).json({ error: 'Cache write failed' });
    }
});

// *** NEW: KITSU MAPPING API ENDPOINTS ***

// GET /api/kitsu-mapping/:kitsuId - Get Kitsu → IMDb mapping
app.get('/api/kitsu-mapping/:kitsuId', (req, res) => {
    try {
        const { kitsuId } = req.params;
        
        const result = db.prepare(
            'SELECT imdb_id, source, confidence_score, created_at FROM kitsu_imdb_mappings WHERE kitsu_id = ?'
        ).get(kitsuId);
        
        if (result) {
            res.json({
                kitsuId: kitsuId,
                imdbId: result.imdb_id,
                source: result.source,
                confidence: result.confidence_score,
                createdAt: new Date(result.created_at).toISOString()
            });
        } else {
            res.status(404).json({ error: 'Mapping not found' });
        }
    } catch (error) {
        console.error('Mapping read error:', error);
        res.status(500).json({ error: 'Mapping read failed' });
    }
});

// POST /api/kitsu-mapping - Store Kitsu → IMDb mapping
app.post('/api/kitsu-mapping', (req, res) => {
    try {
        const { kitsuId, imdbId, source = 'api_discovery', confidence = 0 } = req.body;
        
        if (!kitsuId || !imdbId) {
            return res.status(400).json({ error: 'Missing kitsuId or imdbId' });
        }
        
        const now = Date.now();
        
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO kitsu_imdb_mappings 
            (kitsu_id, imdb_id, source, confidence_score, created_at, last_verified) 
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(kitsuId, imdbId, source, confidence, now, now);
        
        res.json({ 
            success: true, 
            mapping: { kitsuId, imdbId, source } 
        });
    } catch (error) {
        console.error('Mapping write error:', error);
        res.status(500).json({ error: 'Mapping write failed' });
    }
});

// *** NEW: STATS AND MAINTENANCE ENDPOINTS ***

// GET /api/stats/cache - Cache and mapping statistics
app.get('/api/stats/cache', (req, res) => {
    try {
        const now = Date.now();
        
        // Cache statistics
        const cacheStats = db.prepare(`
            SELECT 
                COUNT(*) as total_entries,
                COUNT(CASE WHEN expires_at > ? THEN 1 END) as active_entries,
                COUNT(CASE WHEN expires_at <= ? THEN 1 END) as expired_entries
            FROM api_cache
        `).get(now, now);
        
        // Mapping statistics
        const mappingStats = db.prepare(`
            SELECT 
                COUNT(*) as total_mappings,
                COUNT(CASE WHEN source = 'manual' THEN 1 END) as manual_mappings,
                COUNT(CASE WHEN source = 'tmdb' THEN 1 END) as tmdb_mappings,
                COUNT(CASE WHEN source = 'api_discovery' THEN 1 END) as api_discovery_mappings,
                COUNT(CASE WHEN source = 'imdb_fallback' THEN 1 END) as imdb_fallback_mappings
            FROM kitsu_imdb_mappings
        `).get();
        
        res.json({
            cache: {
                totalEntries: parseInt(cacheStats.total_entries),
                activeEntries: parseInt(cacheStats.active_entries),
                expiredEntries: parseInt(cacheStats.expired_entries)
            },
            mappings: {
                totalMappings: parseInt(mappingStats.total_mappings),
                manualMappings: parseInt(mappingStats.manual_mappings),
                tmdbMappings: parseInt(mappingStats.tmdb_mappings),
                apiDiscoveryMappings: parseInt(mappingStats.api_discovery_mappings),
                imdbFallbackMappings: parseInt(mappingStats.imdb_fallback_mappings)
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Stats failed' });
    }
});

// DELETE /api/cache/cleanup - Clean expired cache entries
app.delete('/api/cache/cleanup', (req, res) => {
    try {
        const now = Date.now();
        const result = db.prepare('DELETE FROM api_cache WHERE expires_at < ?').run(now);
        
        res.json({ 
            success: true, 
            deletedEntries: result.changes 
        });
    } catch (error) {
        console.error('Cache cleanup error:', error);
        res.status(500).json({ error: 'Cleanup failed' });
    }
});

// Health check endpoint (enhanced)
app.get('/health', (req, res) => {
    const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    
    // Get cache stats
    let cacheStats = null;
    let mappingStats = null;
    
    try {
        const now = Date.now();
        const cacheResult = db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN expires_at > ? THEN 1 END) as active
            FROM api_cache
        `).get(now);
        
        const mappingResult = db.prepare('SELECT COUNT(*) as total FROM kitsu_imdb_mappings').get();
        
        cacheStats = {
            total: parseInt(cacheResult.total),
            active: parseInt(cacheResult.active)
        };
        
        mappingStats = {
            total: parseInt(mappingResult.total)
        };
    } catch (e) {
        // Cache stats not critical for health check
    }
    
    res.json({
        status: 'healthy',
        lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
        ratingsCount: ratingsCount.toLocaleString(),
        episodesCount: episodesCount.toLocaleString(),
        cacheStats,
        mappingStats,
        memoryUsage: process.memoryUsage(),
        databaseSize: `${Math.round(dbSize / 1024 / 1024)} MB`,
        optimized: true,
        dataLoaded: ratingsCount > 0 && episodesCount > 0
    });
});

// Status endpoint (enhanced)
app.get('/', (req, res) => {
    const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    
    res.json({
        service: 'Enhanced IMDb Ratings API with Caching',
        status: 'active',
        lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
        data: {
            ratings: ratingsCount.toLocaleString(),
            episodes: episodesCount.toLocaleString(),
            compressionRatio: `${((episodesCount / 7000000) * 100).toFixed(1)}%`
        },
        storage: {
            type: 'Enhanced SQLite with Caching (better-sqlite3)',
            size: `${Math.round(dbSize / 1024 / 1024)} MB`,
            memoryUsage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`
        },
        optimizations: [
            'Compressed IMDb IDs (integer storage)',
            'Filtered episodes (only rated content)',
            'Optimized indexes and pragmas',
            'Batch processing with transactions',
            'better-sqlite3 for performance',
            '✨ NEW: API response caching',
            '✨ NEW: Kitsu→IMDb mapping storage',
            '✨ NEW: TMDB metadata caching'
        ],
        endpoints: {
            // Existing endpoints
            movieRating: '/api/rating/:imdb_id',
            episodeRating: '/api/episode/:series_id/:season/:episode',
            episodeRatingById: '/api/episode/id/:episode_id',
            health: '/health',
            
            // New caching endpoints
            getCache: '/api/cache/:key',
            setCache: 'POST /api/cache',
            
            // New mapping endpoints
            getKitsuMapping: '/api/kitsu-mapping/:kitsu_id',
            setKitsuMapping: 'POST /api/kitsu-mapping',
            
            // Stats and maintenance
            cacheStats: '/api/stats/cache',
            cacheCleanup: 'DELETE /api/cache/cleanup'
        },
        examples: {
            movie: '/api/rating/tt0111161',
            episode: '/api/episode/tt0903747/1/1',
            episodeById: '/api/episode/id/tt0959621',
            kitsuMapping: '/api/kitsu-mapping/7936',
            cacheStats: '/api/stats/cache'
        }
    });
});

// *** SCHEDULED MAINTENANCE ***

// Schedule cache cleanup every 6 hours
cron.schedule('0 */6 * * *', () => {
    console.log('Running scheduled cache cleanup...');
    try {
        const now = Date.now();
        const result = db.prepare('DELETE FROM api_cache WHERE expires_at < ?').run(now);
        console.log(`Cleaned up ${result.changes} expired cache entries`);
    } catch (error) {
        console.error('Scheduled cache cleanup failed:', error);
    }
});

// Initialize the server
app.listen(port, async () => {
    console.log(`🚀 Enhanced IMDb Ratings API running on http://localhost:${port}`);
    console.log(`📊 Status: http://localhost:${port}/`);
    console.log(`📈 Stats: http://localhost:${port}/api/stats/cache`);
    console.log('');
    
    // Initialize database
    await initDatabase();
    
    // Check if we already have data
    const hasData = db.prepare("SELECT COUNT(*) as count FROM ratings").get().count > 0;
    
    if (!hasData) {
        console.log('No data found. Starting optimized download...');
        console.log('This downloads ~400MB but stores efficiently...');
        console.log('Expected final database size: ~100-150MB');
        console.log('Estimated time: 15-20 minutes');
        console.log('');
        await downloadAndProcessAllData();
    } else {
        console.log(`Enhanced database already loaded`);
        
        // Get counts
        ratingsCount = db.prepare("SELECT COUNT(*) as count FROM ratings").get().count;
        console.log(`   📊 ${ratingsCount.toLocaleString()} ratings`);
        
        episodesCount = db.prepare("SELECT COUNT(*) as count FROM episodes").get().count;
        console.log(`   📺 ${episodesCount.toLocaleString()} episodes`);
        
        // Get cache stats
        try {
            const cacheCount = db.prepare("SELECT COUNT(*) as count FROM api_cache").get().count;
            const mappingCount = db.prepare("SELECT COUNT(*) as count FROM kitsu_imdb_mappings").get().count;
            console.log(`   💾 ${cacheCount} cached responses`);
            console.log(`   🎌 ${mappingCount} Kitsu mappings`);
        } catch (e) {
            console.log(`   💾 Cache tables ready`);
        }
        
        const dbSize = fs.statSync(dbPath).size;
        console.log(`   📁 Database: ${Math.round(dbSize / 1024 / 1024)} MB`);
    }
    
    // Schedule daily updates at 2 AM
    cron.schedule('0 2 * * *', async () => {
        console.log('Running scheduled update of optimized IMDb datasets');
        await downloadAndProcessAllData();
    });
    
    console.log('');
    console.log('✅ Ready to serve enhanced ratings data with caching!');
    console.log('✨ New features:');
    console.log('   - API response caching for rate limit protection');
    console.log('   - Kitsu→IMDb mapping storage for anime support');
    console.log('   - TMDB metadata caching for rich data');
    console.log('   - Automatic cache cleanup every 6 hours');
    console.log('   - Enhanced statistics and monitoring');
});