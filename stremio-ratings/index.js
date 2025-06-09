const https = require('https');
const http = require('http');
const fs = require('fs');  // ADD THIS BACK
const path = require('path');  // ADD THIS BACK

// Constants
const RATINGS_API_URL = process.env.RATINGS_API_URL || 'http://localhost:3001';
const DEFAULT_CONFIG = {
    showVotes: true,
    format: 'multiline',
    streamName: 'IMDb Rating'
};

function setCORSHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization, X-API-Key');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Cache-Control', 'public, max-age=3600');
}

function parseConfig(configStr) {
    if (!configStr) return DEFAULT_CONFIG;
    try {
        const parsed = JSON.parse(configStr);
        return { ...DEFAULT_CONFIG, ...parsed };
    } catch (e) {
        console.error('Error parsing config:', e);
        return DEFAULT_CONFIG;
    }
}

function makeRequest(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? https : http;
        
        protocol.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    console.error("Failed to parse JSON response:", e);
                    resolve(null);
                }
            });
        }).on('error', reject);
    });
}

function parseContentId(id) {
    const decodedId = decodeURIComponent(id);
    console.log('Parsing content ID:', decodedId);

    // Enhanced Kitsu format: support both simple and three-segment formats
    const kitsuMatch = decodedId.match(/^kitsu:(?:anime|movie|manga|)?(\d+)(?::(\d+))?$/);
    if (kitsuMatch) {
        const [, kitsuId, episode] = kitsuMatch;
        console.log(`Matched Kitsu ID: ${kitsuId}, Episode: ${episode || 'N/A'}`);
        return {
            platform: 'kitsu',
            kitsuId: kitsuId,
            episode: episode ? parseInt(episode) : null,
            season: episode ? 1 : null,
            type: episode ? 'series' : 'movie',
            originalId: decodedId,
            needsMapping: true
        };
    }

    // Standard IMDb format
    const imdbMatch = decodedId.match(/^(tt\d+)(?::(\d+):(\d+))?$/);
    if (imdbMatch) {
        const [, imdbId, season, episode] = imdbMatch;
        const isSeries = season && episode;
        console.log(`Matched IMDb ID: ${imdbId}, Season: ${season || 'N/A'}, Episode: ${episode || 'N/A'}`);
        return {
            platform: 'imdb',
            imdbId: imdbId,
            season: isSeries ? parseInt(season) : null,
            episode: isSeries ? parseInt(episode) : null,
            type: isSeries ? 'series' : 'movie',
            originalId: decodedId,
            needsMapping: false
        };
    }

    console.warn('Could not parse ID format:', decodedId);
    return null;
}

// Simplified Kitsu to IMDb mapping
async function getImdbFromKitsu(kitsuId) {
    try {
        console.log(`Auto-mapping Kitsu ID ${kitsuId} to IMDb...`);
        
        // Get anime metadata from Kitsu
        const kitsuUrl = `https://kitsu.io/api/edge/anime/${kitsuId}`;
        const kitsuResponse = await makeRequest(kitsuUrl);
        
        if (!kitsuResponse?.data?.attributes) {
            console.log(`No Kitsu metadata found for ID: ${kitsuId}`);
            return null;
        }
        
        const attrs = kitsuResponse.data.attributes;
        const animeTitle = attrs.canonicalTitle || attrs.titles?.en || attrs.titles?.en_jp;
        
        if (!animeTitle) {
            console.log(`No title found for Kitsu ID: ${kitsuId}`);
            return null;
        }
        
        console.log(`Found anime: "${animeTitle}"`);
        
        // Search IMDb using the title
        const letter = animeTitle.slice(0, 1).toLowerCase();
        const query = encodeURIComponent(animeTitle.trim());
        const imdbUrl = `https://v2.sg.media-imdb.com/suggestion/${letter}/${query}.json`;
        
        const imdbResponse = await makeRequest(imdbUrl);
        
        if (imdbResponse?.d?.length > 0) {
            const candidates = imdbResponse.d.filter(item => 
                item.q === 'TV series' || item.q === 'TV movie' || item.q === 'video'
            );
            
            if (candidates.length > 0) {
                const imdbId = candidates[0].id;
                console.log(`Auto-mapped: ${kitsuId} → ${imdbId} (${animeTitle})`);
                return imdbId;
            }
        }
        
        console.log(`No IMDb mapping found for: "${animeTitle}"`);
        return null;
        
    } catch (error) {
        console.error(`Error auto-mapping Kitsu ID ${kitsuId}:`, error);
        return null;
    }
}

async function getRating(imdbId) {
    if (!imdbId) return null;
    
    try {
        const url = `${RATINGS_API_URL}/api/rating/${imdbId}`;
        console.log(`Fetching rating: ${url}`);
        
        const data = await makeRequest(url);
        if (data?.rating && !data.error) {
            return {
                rating: data.rating,
                votes: data.votes || '0',
                id: data.id,
                type: data.type || 'direct'
            };
        }
        
        console.log('No rating found for', imdbId);
        return null;
    } catch (error) {
        console.error('Error fetching rating:', error);
        return null;
    }
}

async function getEpisodeRating(seriesId, season, episode) {
    if (!seriesId || !season || !episode) return null;
    
    try {
        const url = `${RATINGS_API_URL}/api/episode/${seriesId}/${season}/${episode}`;
        console.log(`Fetching episode rating: ${url}`);
        
        const data = await makeRequest(url);
        if (data?.rating && !data.error) {
            return {
                rating: data.rating,
                votes: data.votes || '0',
                episodeId: data.episodeId,
                type: 'episode'
            };
        }
        
        console.log(`No episode rating found for ${seriesId} S${season}E${episode}`);
        return null;
    } catch (error) {
        console.error('Error fetching episode rating:', error);
        return null;
    }
}

function createStream(name, description, originalId, imdbId = null, ratingData = null) {
    return {
        name: name,
        description: description,
        url: imdbId                                   // CRITICAL: must be url or infoHash
             ? `https://www.imdb.com/title/${ratingData?.episodeId || imdbId}/`
             : 'https://www.imdb.com/',               // harmless placeholder
        behaviorHints: {
            notWebReady: true,
            bingeGroup: `ratings-${originalId}`
        },
        type: "other"
    };
}

function formatVoteCount(votes) {
    if (!votes || votes === '0') return '';
    
    const num = parseInt(votes.replace(/,/g, ''));
    if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
        return `${Math.round(num / 1000)}K`;
    }
    return num.toString();
}

function formatRatingDisplay(ratingData, config, type = 'episode') {
    const { rating, votes } = ratingData;
    const { showVotes, format, streamName } = config;
    const votesText = showVotes && votes ? ` ${formatVoteCount(votes)}` : '';

    if (format === 'singleline') {
        return {
            name: streamName,
            description: `⭐ ${rating}/10${votesText}`,
        };
    }

    const lines = [
        "───────────────",
        `⭐ ${rating}/10`
    ];
    
    // Add votes on separate line if enabled
    if (showVotes && votes) {
        lines.push(formatVoteCount(votes));
    }
    
    const typeIndicators = {
        episode: "(Episode Rating)",
        series_fallback: "(Series Rating)",
        movie: "(Movie Rating)"
    };

    if (typeIndicators[type]) {
        lines.push(typeIndicators[type]);
    }
    
    lines.push("───────────────");

    return {
        name: streamName,
        description: lines.join('\n')
    };
}

async function getStreams(type, id, config) {
    console.log(`Stream request - Type: ${type}, ID: ${id}`);
    
    const parsedId = parseContentId(id);
    if (!parsedId) {
        console.log('Could not parse content ID:', id);
        return [createStream(
            config.streamName,
            `⭐ IMDb Rating: Not Available\n(Could not parse ID format)`,
            id
        )];
    }
    
    console.log('Parsed ID structure:', parsedId);

    let imdbId = parsedId.imdbId;

    // Handle Kitsu IDs using auto-mapping
    if (parsedId.needsMapping && parsedId.platform === 'kitsu') {
        console.log(`Kitsu content detected: ${parsedId.kitsuId}`);
        
        imdbId = await getImdbFromKitsu(parsedId.kitsuId);
        
        if (!imdbId) {
            console.log('No auto-mapping found');
            return [createStream(
                config.streamName,
                `⭐ IMDb Rating: Not Available\n(Could not find IMDb mapping)`,
                parsedId.originalId
            )];
        }
        
        console.log(`Successfully auto-mapped to IMDb: ${imdbId}`);
    }
    
    let ratingData = null;
    
    // Handle series/episodes
    if (parsedId.type === 'series' && parsedId.season && parsedId.episode) {
        console.log(`Processing episode S${parsedId.season}E${parsedId.episode} for ${imdbId}`);
        ratingData = await getEpisodeRating(imdbId, parsedId.season, parsedId.episode);
        
        // Fallback to series rating
        if (!ratingData) {
            console.log('No episode rating, trying series rating...');
            ratingData = await getRating(imdbId);
            if (ratingData) ratingData.type = 'series_fallback';
        }
    } else {
        // Handle movies
        console.log(`Processing movie: ${imdbId}`);
        ratingData = await getRating(imdbId);
        if (ratingData) ratingData.type = 'movie';
    }

    // Create stream with rating or fallback
    if (ratingData) {
        const displayConfig = formatRatingDisplay(ratingData, config, ratingData.type);
        console.log(`Added ${ratingData.type} rating stream: ${ratingData.rating}/10`);
        return [createStream(displayConfig.name, displayConfig.description, parsedId.originalId, imdbId, ratingData)];
    } else {
        console.log('No rating data found');
        return [createStream(
            config.streamName,
            '⭐ IMDb Rating: Not Available\n(Rating not found in dataset)',
            parsedId.originalId,
            imdbId
        )];
    }
}

// Main handler
module.exports = async (req, res) => {
    setCORSHeaders(res);
    
    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const searchParams = url.searchParams;
    
    console.log(`${req.method} ${pathname}`);
    
    try {
        // Manifest - CRITICAL: Use flat format for compatibility
        if (pathname === '/manifest.json') {
            const manifest = {
                id: 'imdb.ratings.universal',
                version: '2.6.0',
                name: 'Universal IMDb Ratings',
                description: 'Shows IMDb ratings for movies, series, and anime',
                resources: ['stream'],                    // CRITICAL: flat list
                types: ['movie', 'series', 'anime'],     // top level
                idPrefixes: ['tt', 'kitsu'],             // CRITICAL: now at top level
                catalogs: [],
                behaviorHints: {
                    configurable: true,
                    configurationRequired: false
                }
            };
            
            console.log('Returning manifest');
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify(manifest, null, 2));
        }

        // Health check
        if (pathname === '/health') {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({
                status: 'OK',
                time: new Date().toISOString(),
                version: '2.6.0'
            }));
        }

        // Stream requests
        if (pathname.startsWith('/stream/')) {
            const parts = pathname.split('/').filter(Boolean);
            if (parts.length >= 3) {
                const type = parts[1];
                const id = parts[2].replace('.json', '');
                
                console.log(`Stream request: ${type}/${id}`);
                
                const configStr = searchParams.get('config');
                const config = parseConfig(configStr);
                
                const streams = await getStreams(type, id, config);
                
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ streams }, null, 2));
            }
        }

        // Configure page - FIXED VERSION
        if (pathname === '/configure') {
            const baseUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
            
            // Try to read external config.html file first
            try {
                const configPath = path.join(__dirname, 'config.html');
                const configTemplate = fs.readFileSync(configPath, 'utf8');
                const html = configTemplate.replace(/\{\{BASE_URL\}\}/g, baseUrl);
                res.setHeader('Content-Type', 'text/html');
                return res.end(html);
            } catch (error) {
                console.log('External config.html not found, using built-in template');
                
                // Fallback to built-in template
                const html = `<!DOCTYPE html>
<html>
<head>
    <title>Universal IMDb Ratings</title>
    <style>body{font-family:Arial;max-width:800px;margin:50px auto;padding:20px;background:#1a1a1a;color:white} .info{background:#2a4a2a;padding:15px;border-radius:8px;margin:20px 0} .url{background:#333;padding:10px;border-radius:4px;font-family:monospace;margin:10px 0}</style>
</head>
<body>
    <h1>🎬 Universal IMDb Ratings</h1>
    
    <div class="info">
        <h3>✨ Features</h3>
        <p>This addon provides IMDb ratings for content from any catalog:</p>
        <ul>
            <li>Movies and TV series from Cinemeta</li>
            <li>Anime from Kitsu and other anime catalogs</li>
            <li>Automatic mapping for non-IMDb content</li>
            <li>Episode-specific ratings when available</li>
        </ul>
    </div>
    
    <p><strong>Manifest URL:</strong></p>
    <div class="url">${baseUrl}/manifest.json</div>
    <button onclick="window.location.href='stremio://${baseUrl}/manifest.json'" style="background:#4CAF50;color:white;border:none;padding:15px 25px;border-radius:4px;cursor:pointer;font-size:16px;">Install Addon</button>
</body>
</html>`;
                res.setHeader('Content-Type', 'text/html');
                return res.end(html);
            }
        }

        // 404
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'Not Found' }));

    } catch (error) {
        console.error('Error:', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
            error: 'Internal Server Error',
            message: error.message
        }));
    }
};

// Development server
if (require.main === module) {
    const port = process.env.PORT || 3000;
    const server = http.createServer(module.exports);
    
    server.listen(port, () => {
        console.log(`\nUniversal IMDb Ratings addon running on port ${port}`);
        console.log(`Configure: http://localhost:${port}/configure`);
        console.log(`Supports: Movies, TV Series, and Anime\n`);
    });
}