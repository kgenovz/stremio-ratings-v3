const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Constants
const RATINGS_API_URL = process.env.RATINGS_API_URL || 'http://localhost:3001';
const DEFAULT_CONFIG = {
    showVotes: true,
    format: 'multiline',
    streamName: 'IMDb Rating'
};

// Utility Functions
class Utils {
    static parseConfig(configStr) {
        if (!configStr) return DEFAULT_CONFIG;
        
        try {
            const parsed = JSON.parse(configStr);
            return { ...DEFAULT_CONFIG, ...parsed };
        } catch (e) {
            console.error('Error parsing config:', e);
            return DEFAULT_CONFIG;
        }
    }

    static setCORSHeaders(res) {
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'X-Requested-With, Content-Type, Accept, Authorization, X-API-Key',
            'Access-Control-Max-Age': '86400',
            'Cache-Control': 'public, max-age=3600',
            'Vary': 'Origin'
        };

        Object.entries(headers).forEach(([key, value]) => {
            res.setHeader(key, value);
        });
    }

    static makeRequest(url) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https:') ? https : http;
            
            protocol.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(null);
                    }
                });
            }).on('error', reject);
        });
    }

    static parseUrl(req) {
        const host = req.headers['x-forwarded-host'] || req.headers.host || 
                     process.env.VERCEL_URL || 'localhost:3000';
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const baseUrl = `${protocol}://${host}`;

        try {
            const url = new URL(req.url, baseUrl);
            return {
                url,
                pathname: url.pathname,
                searchParams: url.searchParams,
                baseUrl
            };
        } catch (e) {
            console.error('Error parsing URL:', e);
            const [path, query = ''] = req.url.split('?');
            return {
                pathname: path,
                searchParams: new URLSearchParams(query),
                baseUrl
            };
        }
    }

    static cleanPathname(pathname) {
        const cleaned = pathname.replace(/^\/(api|stremio)/, '');
        return cleaned.startsWith('/') ? cleaned : '/' + cleaned;
    }
}

// Rating Service
class RatingService {
    static async getRating(imdbId) {
        try {
            const url = `${RATINGS_API_URL}/api/rating/${imdbId}`;
            console.log(`Fetching rating from local dataset:`, url);
            
            const data = await Utils.makeRequest(url);
            console.log('Local API response:', data);
            
            if (data?.rating && !data.error) {
                return {
                    rating: data.rating,
                    votes: data.votes || '0',
                    id: data.id,
                    type: data.type || 'direct'
                };
            }
            
            console.log('⚠️ No rating found in local dataset');
            return null;
        } catch (error) {
            console.error('Error fetching from local dataset:', error);
            return null;
        }
    }

    static async getEpisodeRating(seriesId, season, episode) {
        try {
            const url = `${RATINGS_API_URL}/api/episode/${seriesId}/${season}/${episode}`;
            console.log(`Fetching episode rating from local dataset:`, url);
            
            const data = await Utils.makeRequest(url);
            console.log('Episode API response:', data);
            
            if (data?.rating && !data.error) {
                return {
                    rating: data.rating,
                    votes: data.votes || '0',
                    episodeId: data.episodeId,
                    type: 'episode'
                };
            }
            
            console.log('⚠️ No episode rating found in local dataset');
            return null;
        } catch (error) {
            console.error('Error fetching episode from local dataset:', error);
            return null;
        }
    }
}

// Manifest Service
class ManifestService {
    static generate(config = DEFAULT_CONFIG) {
        return {
            id: 'imdb.ratings.local',
            version: '2.0.0',
            name: 'IMDb Ratings',
            description: 'Shows IMDb ratings for movies and individual TV episodes',
            resources: ['stream'],
            types: ['movie', 'series'],
            catalogs: [],
            idPrefixes: ['tt'],
            behaviorHints: {
                configurable: true,
                configurationRequired: false
            }
        };
    }
}

// Stream Service
class StreamService {
    static formatRatingDisplay(ratingData, config, type = 'episode') {
        const { rating, votes } = ratingData;
        const { showVotes, format, streamName } = config;
        
        const votesText = showVotes && votes ? ` (${votes} votes)` : '';
        
        if (format === 'singleline') {
            return {
                name: streamName,
                description: `⭐ IMDb: ${rating}/10${votesText}`,
            };
        }
        
        const lines = [
            "───────────────",
            `⭐ IMDb        : ${rating}/10`,
            `${votesText}`,
            "───────────────"
        ];
        
        const typeIndicators = {
            episode: "(Episode Rating)",
            series_fallback: "(Series Rating)"
        };
        
        if (typeIndicators[type]) {
            lines.splice(2, 0, typeIndicators[type]);
        }
        
        return {
            name: streamName,
            description: lines.join('\n')
        };
    }

    static createStream(displayConfig, imdbId, id, ratingData = null) {
        return {
            name: displayConfig.name,
            description: displayConfig.description,
            externalUrl: `https://www.imdb.com/title/${ratingData?.episodeId || imdbId}/`,
            behaviorHints: {
                notWebReady: true,
                bingeGroup: `ratings-${id}`
            },
            type: "other"
        };
    }

    static async handleSeriesStreams(imdbId, season, episode, id, config) {
        console.log(`Processing episode ${season}x${episode} for series ${imdbId}`);
        
        // Try episode-specific rating first
        let ratingData = await RatingService.getEpisodeRating(imdbId, season, episode);
        
        // Fallback to series rating
        if (!ratingData) {
            console.log('No episode rating found, trying series rating as fallback...');
            ratingData = await RatingService.getRating(imdbId);
            if (ratingData) {
                ratingData.type = 'series_fallback';
            }
        }

        if (ratingData) {
            const displayConfig = this.formatRatingDisplay(ratingData, config, ratingData.type);
            const stream = this.createStream(displayConfig, imdbId, id, ratingData);
            console.log(`✅ Added ${ratingData.type} rating stream: ${ratingData.rating}/10`);
            return [stream];
        }

        // No rating available
        const displayConfig = this.formatRatingDisplay(
            { rating: 'Not Available', votes: '' }, 
            config
        );
        
        const stream = this.createStream({
            name: displayConfig.name,
            description: displayConfig.description.replace(/⭐.*/, '⭐ IMDb Rating: Not Available')
        }, imdbId, id);
        
        console.log('❌ Added "no rating" stream');
        return [stream];
    }

    static async handleMovieStreams(id, config) {
        console.log(`Processing movie: ${id}`);
        
        const ratingData = await RatingService.getRating(id);
        
        if (ratingData) {
            const displayConfig = this.formatRatingDisplay(ratingData, config, 'movie');
            const stream = this.createStream(displayConfig, id, id, ratingData);
            console.log(`✅ Added movie rating stream: ${ratingData.rating}/10`);
            return [stream];
        }

        // No rating available
        const displayConfig = this.formatRatingDisplay(
            { rating: 'Not Available', votes: '' }, 
            config
        );
        
        const stream = this.createStream({
            name: displayConfig.name,
            description: displayConfig.description.replace(/⭐.*/, '⭐ IMDb Rating: Not Available')
        }, id, id);
        
        console.log('❌ Added "no rating" stream for movie');
        return [stream];
    }

    static async getStreams(type, id, config) {
        const decodedId = decodeURIComponent(id);
        console.log('Decoded ID:', decodedId);
        
        if (!['series', 'movie'].includes(type)) {
            return [];
        }

        try {
            if (type === 'series') {
                const [imdbId, season, episode] = decodedId.split(':');
                
                if (!imdbId || !season || !episode) {
                    console.log('Invalid series ID format:', decodedId);
                    return [];
                }
                
                return await this.handleSeriesStreams(imdbId, season, episode, decodedId, config);
            } else {
                return await this.handleMovieStreams(decodedId, config);
            }
        } catch (error) {
            console.error('Error getting streams:', error);
            return [];
        }
    }
}

// HTML Service
class HtmlService {
    static getConfigTemplate() {
        try {
            const templatePath = path.join(__dirname, 'config.html');
            return fs.readFileSync(templatePath, 'utf8');
        } catch (error) {
            console.error('Error reading config template:', error);
            // Fallback to basic template if file not found
            return this.getBasicTemplate();
        }
    }

    static getBasicTemplate() {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>IMDb Ratings Configuration</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #1a1a1a; color: white; }
        .config { background: #2a2a2a; padding: 20px; border-radius: 8px; margin: 20px 0; }
        button { background: #7b68ee; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin: 5px; }
        .url { background: #333; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; margin: 10px 0; }
    </style>
</head>
<body>
    <h1>🎬 IMDb Ratings Configuration</h1>
    <div class="config">
        <h3>Default Installation</h3>
        <div class="url">{{BASE_URL}}/manifest.json</div>
        <button onclick="window.open('stremio://{{BASE_URL}}/manifest.json', '_blank')">Install</button>
    </div>
    <script>console.log('Basic template loaded - place config.html in the same directory for full features');</script>
</body>
</html>`;
    }

    static generateConfigurePage(baseUrl) {
        const template = this.getConfigTemplate();
        return template.replace(/\{\{BASE_URL\}\}/g, baseUrl);
    }
}

// Route Handlers
class RouteHandler {
    static async handleManifest(searchParams) {
        const configStr = searchParams.get?.('config') || null;
        const config = Utils.parseConfig(configStr);
        return ManifestService.generate(config);
    }

    static async handleStream(pathname, searchParams) {
        const pathParts = pathname.split('/').filter(Boolean);
        const streamIndex = pathParts.indexOf('stream');
        
        if (streamIndex === -1 || pathParts.length < streamIndex + 3) {
            throw new Error('Invalid stream request format');
        }

        const type = pathParts[streamIndex + 1];
        let id = pathParts[streamIndex + 2];
        
        if (id.endsWith('.json')) {
            id = id.slice(0, -5);
        }
        
        const configStr = searchParams.get?.('config') || null;
        const config = Utils.parseConfig(configStr);
        
        console.log('Stream request with config:', config);
        
        const streams = await StreamService.getStreams(type, id, config);
        console.log(`Returning ${streams.length} streams`);
        
        return { streams };
    }

    static handleHealth() {
        return { 
            status: 'OK', 
            time: new Date().toISOString(),
            version: '2.0.0',
            ratingsAPI: RATINGS_API_URL
        };
    }

    static handle404(pathname) {
        return {
            error: 'Not Found',
            path: pathname,
            availableEndpoints: [
                '/manifest.json',
                '/stream/{type}/{id}',
                '/configure',
                '/health'
            ]
        };
    }
}

// Main Handler
module.exports = async (req, res) => {
    try {
        Utils.setCORSHeaders(res);

        if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            return res.end();
        }

        const { pathname, searchParams, baseUrl } = Utils.parseUrl(req);
        const cleanPath = Utils.cleanPathname(pathname);
        
        console.log(`Processing request: ${req.method} ${cleanPath}`);

        // Handle configuration page
        if (cleanPath === '/configure') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.end(HtmlService.generateConfigurePage(baseUrl));
        }

        // Handle health check
        if (cleanPath === '/health') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            const result = RouteHandler.handleHealth();
            return res.end(JSON.stringify(result, null, 2));
        }

        // Handle addon routes
        res.setHeader('Content-Type', 'application/json; charset=utf-8');

        if (cleanPath === '/manifest.json') {
            const result = await RouteHandler.handleManifest(searchParams);
            return res.end(JSON.stringify(result));
        }

        if (cleanPath.includes('/stream/')) {
            const result = await RouteHandler.handleStream(cleanPath, searchParams);
            return res.end(JSON.stringify(result));
        }

        // 404 handler
        res.statusCode = 404;
        const result = RouteHandler.handle404(cleanPath);
        return res.end(JSON.stringify(result));

    } catch (error) {
        Utils.setCORSHeaders(res);
        console.error('Uncaught error:', error);
        
        res.statusCode = error.message === 'Invalid stream request format' ? 404 : 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({
            error: res.statusCode === 404 ? 'Not Found' : 'Server Error',
            message: error.message
        }));
    }
};

// Development server
if (require.main === module) {
    const port = process.env.PORT || 3000;
    
    const server = http.createServer(module.exports);
    
    server.listen(port, () => {
        console.log(`🎬 IMDb Ratings addon running on port ${port}`);
        console.log(`📋 Configuration page: http://localhost:${port}/configure`);
        console.log(`📄 Default manifest: http://localhost:${port}/manifest.json`);
        console.log(`🔗 Ratings API: ${RATINGS_API_URL}`);
    });
}