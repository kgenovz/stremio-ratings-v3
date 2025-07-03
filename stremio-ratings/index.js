const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Constants
const RATINGS_API_URL = process.env.RATINGS_API_URL || 'http://localhost:3001';
const DEFAULT_CONFIG = {
    showVotes: true,
    format: 'multiline',
    streamName: 'IMDb Rating',
    voteFormat: 'comma', // NEW: 'comma', 'rounded'
    ratingFormat: 'withMax' // NEW: 'withMax' (8/10), 'simple' (8)
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

    // Parse config from URL path instead of query params
    static parseConfigFromPath(pathname) {
        // Extract config segment from path like: /c_showVotes-true_format-multiline/manifest.json
        const configMatch = pathname.match(/\/c_([^\/]+)\//);

        if (!configMatch) {
            return DEFAULT_CONFIG;
        }

        const configStr = configMatch[1];
        const config = { ...DEFAULT_CONFIG };

        try {
            // Parse key-value pairs separated by underscores
            const pairs = configStr.split('_');

            for (const pair of pairs) {
                const [key, value] = pair.split('-');
                if (key && value !== undefined) {
                    // Convert string values to appropriate types
                    if (value === 'true') config[key] = true;
                    else if (value === 'false') config[key] = false;
                    else if (!isNaN(value) && value !== '') config[key] = Number(value);
                    else config[key] = decodeURIComponent(value); // Handle encoded values
                }
            }

            console.log('Parsed path config:', config);
            return config;
        } catch (e) {
            console.error('Error parsing path config:', e);
            return DEFAULT_CONFIG;
        }
    }

    // NEW: Generate config path segment
    static generateConfigPath(config) {
        const pairs = [];

        for (const [key, value] of Object.entries(config)) {
            if (value !== DEFAULT_CONFIG[key]) { // Only include non-default values
                const encodedValue = encodeURIComponent(value.toString());
                pairs.push(`${key}-${encodedValue}`);
            }
        }

        return pairs.length > 0 ? `c_${pairs.join('_')}` : '';
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
        // Remove both old /api and /stremio prefixes, and config segments
        const cleaned = pathname
            .replace(/^\/(api|stremio)/, '')
            .replace(/\/c_[^\/]+/, ''); // Remove config segment
        return cleaned.startsWith('/') ? cleaned : '/' + cleaned;
        }

    // NEW: Vote formatting utility
    static formatVotes(votes, format = 'comma') {
        if (!votes || votes === '0') return '';

        const num = parseInt(votes.toString().replace(/,/g, ''));
        if (isNaN(num)) return votes;

        if (format === 'rounded') {
            if (num >= 1000000) {
                return (num / 1000000).toFixed(1).replace('.0', '') + 'M';
            } else if (num >= 1000) {
                return (num / 1000).toFixed(1).replace('.0', '') + 'k';
            } else {
                return num.toString();
            }
        } else {
            // Default comma format
            return num.toLocaleString();
        }
    }

    // NEW: Rating formatting utility
    static formatRating(rating, format = 'withMax') {
        if (format === 'simple') {
            return rating.toString();
        } else {
            return `${rating}/10`;
        }
    }

    // NEW: Parse content ID for both IMDb and Kitsu formats
    static parseContentId(id) {
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
                season: episode ? 1 : null, // Will be adjusted based on title later
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

    // Extract season number from title
    static extractSeasonFromTitle(title) {
        console.log(`🔍 Extracting season from title: "${title}"`);

        // Look for season indicators in various formats (ordered by specificity)
        const patterns = [
            // MOST SPECIFIC PATTERNS FIRST (high confidence)

            // "Title Season 3" - explicit season keyword
            /season\s*(\d+)/i,           // "Season 1", "Season 2"
            /\bS(\d+)\b/i,               // "S1", "S2" (word boundaries)

            // "Title Part 3" - part indicators  
            /part\s*(\d+)/i,             // "Part 1", "Part 2"
            /\bP(\d+)\b/i,               // "P1", "P2" 

            // "Title Book 3" - book/chapter indicators
            /book\s*(\d+)/i,             // "Book 1", "Book 2"
            /chapter\s*(\d+)/i,          // "Chapter 1", "Chapter 2"

            // Japanese season indicators
            /第(\d+)期/i,                // "第2期" format (Japanese)
            /(\d+)期目/i,                // "2期目" format

            // Ordinal indicators
            /\s(\d+)(st|nd|rd|th)\s+season/i, // "2nd Season"
            /(\d+)(st|nd|rd|th)\s+series/i,   // "2nd Series"

            // CONTEXTUAL NUMBER PATTERNS (medium confidence)

            // "Title: 3" or "Title - 3" (with separators)
            /[:\-]\s*(\d+)$/,            // "Title: 3", "Title - 3"
        ];

        for (const pattern of patterns) {
            const match = title.match(pattern);
            if (match) {
                const seasonNum = parseInt(match[1]);

                if (seasonNum && seasonNum > 0 && seasonNum <= 50) { // Reasonable season range
                    console.log(`✅ Extracted season ${seasonNum} from title: "${title}" using pattern: ${pattern}`);
                    return seasonNum;
                }
            }
        }

        // SPECIAL CASE: Roman numerals (needs validation)
        const romanMatch = title.match(/\s(II|III|IV|V|VI|VII|VIII|IX|X)$/i);
        if (romanMatch) {
            const romanMap = {
                'II': 2, 'III': 3, 'IV': 4, 'V': 5,
                'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10
            };
            const seasonNum = romanMap[romanMatch[1].toUpperCase()];

            // ENHANCED: Validate if Roman numeral is likely a season
            if (this.isLikelySeasonRoman(title, romanMatch[1], seasonNum)) {
                console.log(`✅ Extracted season ${seasonNum} from title: "${title}" (Roman numeral validated)`);
                return seasonNum;
            } else {
                console.log(`⚠️ Rejected Roman numeral ${romanMatch[1]} from title: "${title}" (likely part of title)`);
            }
        }

        // SPECIAL CASE: Try the generic "Title Number" pattern with extra validation
        const genericNumberMatch = title.match(/\s(\d+)$/);
        if (genericNumberMatch) {
            const number = parseInt(genericNumberMatch[1]);

            // ENHANCED: Context-aware validation to avoid false positives
            if (this.isLikelySeasonNumber(title, number)) {
                console.log(`✅ Extracted season ${number} from title: "${title}" (validated as likely season)`);
                return number;
            } else {
                console.log(`⚠️ Rejected number ${number} from title: "${title}" (likely part of title, not season)`);
            }
        }

        console.log(`⚠️ No season found in title: "${title}", defaulting to season 1`);
        return 1; // Default to season 1 if no season found
    }

    static isLikelySeasonRoman(title, romanNumeral, seasonNumber) {
        const titleLower = title.toLowerCase();
        const roman = romanNumeral.toUpperCase();

        // REJECT if "X" appears to be part of a word/identifier (common patterns)
        const titleRomanPatterns = [
            /\w+\s*x$/i,                  // "Hero X", "Generation X", "Project X"
            /\bx$/i,                      // Just "X" at end after word boundary
        ];

        // Special handling for single "X" (most problematic)
        if (roman === 'X') {
            // Check for title-identifier patterns
            for (const pattern of titleRomanPatterns) {
                if (titleLower.match(pattern)) {
                    console.log(`🚫 Roman numeral X appears to be part of title (pattern: ${pattern})`);
                    return false;
                }
            }

            // Additional check for single-letter identifiers
            const singleLetterPatterns = [
                /\s[a-z]$/i,              // "Title A", "Title B", "Title X"
                /:\s*[a-z]$/i,            // "Title: X"
                /\-\s*[a-z]$/i,           // "Title - X"
            ];

            for (const pattern of singleLetterPatterns) {
                if (titleLower.match(pattern)) {
                    console.log(`🚫 Single letter X appears to be identifier, not season`);
                    return false;
                }
            }
        }

        // ACCEPT other Roman numerals (II, III, IV, etc.) - these are usually seasons
        if (roman !== 'X') {
            console.log(`✅ Roman numeral ${roman} likely a season (not single X)`);
            return true;
        }

        // For "X", only accept if there's strong sequel context
        const sequelKeywords = [
            'season', 'part', 'series', 'saga', 'chronicle', 'generation'
        ];

        const hasSequelContext = sequelKeywords.some(keyword =>
            titleLower.includes(keyword)
        );

        if (hasSequelContext) {
            console.log(`✅ Roman numeral X accepted (has sequel context)`);
            return true;
        }

        console.log(`❌ Roman numeral X rejected (no sequel context, likely identifier)`);
        return false;


        // REJECT if number is clearly part of the title (common patterns)
        const titleNumberPatterns = [
            /no\.?\s*\d+$/i,          // "Title No. 8", "Title No.8"
            /number\s*\d+$/i,         // "Title Number 8"
            /\b\d+$/,                 // Just check if preceded by word boundary
        ];

        // Check for title-number patterns
        for (const pattern of titleNumberPatterns) {
            if (titleLower.match(pattern)) {
                console.log(`🚫 Number ${number} appears to be part of title (pattern: ${pattern})`);
                return false;
            }
        }

        // ACCEPT if number looks like a reasonable season (2-10 are common sequel seasons)
        if (number >= 2 && number <= 10) {
            // Additional check: does the title contain known anime sequel keywords?
            const sequelKeywords = [
                'academia', 'hero', 'slayer', 'titan', 'piece', 'ball', 'naruto',
                'bleach', 'hunter', 'force', 'wars', 'saga', 'chronicle'
            ];

            const hasSequelKeyword = sequelKeywords.some(keyword =>
                titleLower.includes(keyword)
            );

            if (hasSequelKeyword) {
                console.log(`✅ Number ${number} likely a season (has sequel keyword + reasonable range)`);
                return true;
            }
        }

        // REJECT numbers outside reasonable season range or without context
        console.log(`❌ Number ${number} rejected (outside reasonable season range or no sequel context)`);
        return false;
    }

    // NEW: Smart validation to determine if a number is likely a season vs part of title
    static isLikelySeasonNumber(title, number) {
        const titleLower = title.toLowerCase();

        // REJECT if number is clearly part of the title (common patterns)
        const titleNumberPatterns = [
            /no\.?\s*\d+$/i,          // "Title No. 8", "Title No.8"
            /number\s*\d+$/i,         // "Title Number 8"
            /\b\d+$/,                 // Just check if preceded by word boundary
        ];

        // Check for title-number patterns
        for (const pattern of titleNumberPatterns) {
            if (titleLower.match(pattern)) {
                console.log(`🚫 Number ${number} appears to be part of title (pattern: ${pattern})`);
                return false;
            }
        }

        // ACCEPT if number looks like a reasonable season (2-10 are common sequel seasons)
        if (number >= 2 && number <= 10) {
            // Additional check: does the title contain known anime sequel keywords?
            const sequelKeywords = [
                'academia', 'hero', 'slayer', 'titan', 'piece', 'ball', 'naruto',
                'bleach', 'hunter', 'force', 'wars', 'saga', 'chronicle'
            ];

            const hasSequelKeyword = sequelKeywords.some(keyword =>
                titleLower.includes(keyword)
            );

            if (hasSequelKeyword) {
                console.log(`✅ Number ${number} likely a season (has sequel keyword + reasonable range)`);
                return true;
            }
        }

        // REJECT numbers outside reasonable season range or without context
        console.log(`❌ Number ${number} rejected (outside reasonable season range or no sequel context)`);
        return false;
    }

    // for common anime title patterns
    static normalizeAnimeTitle(title) {
        // Remove common suffixes that might interfere with season detection
        const normalizedTitle = title
            .replace(/\s*(TV|OVA|ONA|Movie|Film|Special)$/i, '') // Remove media type
            .replace(/\s*\(.*?\)$/, '') // Remove parenthetical info
            .trim();

        return normalizedTitle;
    }
}

// Anime Mapping Service
class AnimeService {
    // Configuration
    static TMDB_API_KEY = process.env.TMDB_API_KEY || '5fd1aac6c1a9e4f9fd594d187a701881';
    static TMDB_BASE_URL = 'https://api.themoviedb.org/3';
    static CACHE = new Map();
    static CACHE_TTL = 60 * 60 * 1000; // 1 hour TTL
    static REQUEST_QUEUE = [];
    static PROCESSING_QUEUE = false;
    static MAX_CONCURRENT_REQUESTS = 5;
    static REQUEST_DELAY = 200;
    static RATINGS_API_URL = process.env.RATINGS_API_URL || 'http://localhost:3001';

    // Manual mappings for known problematic cases (keep as ultimate fallback)
    static MANUAL_MAPPINGS = {
        // ===== AVATAR: THE LAST AIRBENDER =====
        '7936': {
            imdbId: 'tt0417299',
            season: 1,
            episodeOffset: 0,
            name: 'Avatar: The Last Airbender - Book 1: Air',
            maxEpisodes: 20
        },
        '7937': {
            imdbId: 'tt0417299',
            season: 2,
            episodeOffset: 0,
            name: 'Avatar: The Last Airbender - Book 2: Earth',
            maxEpisodes: 20
        },
        '7926': {
            imdbId: 'tt0417299',
            season: 3,
            episodeOffset: 0,
            name: 'Avatar: The Last Airbender - Book 3: Fire',
            maxEpisodes: 21
        },

        // ===== LEGEND OF KORRA =====
        '7939': {
            imdbId: 'tt1695360',
            season: 1,
            episodeOffset: 0,
            name: 'Legend of Korra - Book 1: Air',
            maxEpisodes: 12
        },
        '7938': {
            imdbId: 'tt1695360',
            season: 2,
            episodeOffset: 0,
            name: 'Legend of Korra - Book 2: Spirits',
            maxEpisodes: 14
        },
        '8077': {
            imdbId: 'tt1695360',
            season: 3,
            episodeOffset: 0,
            name: 'Legend of Korra - Book 3: Change',
            maxEpisodes: 13
        },
        '8706': {
            imdbId: 'tt1695360',
            season: 4,
            episodeOffset: 0,
            name: 'Legend of Korra - Book 4: Balance',
            maxEpisodes: 13
        },

        // ===== ARCANE =====
        '45515': {
            imdbId: 'tt11126994',
            season: 2,
            episodeOffset: 0,
            name: 'Arcane - Season 2',
            maxEpisodes: 9
        },

        // ===== ATTACK ON TITAN =====
        // Note: Replace these placeholder IDs with actual Kitsu IDs when found

        // Attack on Titan Season 3 Part 2 (Episodes 13-22 of Season 3)
        '41982': {
            imdbId: 'tt2560140',
            season: 3,
            episodeOffset: 12, // Part 2 Episode 1 = Season 3 Episode 13
            name: 'Attack on Titan - Season 3 Part 2',
            maxEpisodes: 10
        },
        /*
        // Attack on Titan Season 4 Part 1 (Episodes 1-16 of Season 4)
        'AOT_S4P1_KITSU_ID': {
            imdbId: 'tt2560140',
            season: 4,
            episodeOffset: 0,
            name: 'Attack on Titan - The Final Season Part 1',
            maxEpisodes: 16
        },

        // Attack on Titan Season 4 Part 2 (Episodes 17-28 of Season 4)
        'AOT_S4P2_KITSU_ID': {
            imdbId: 'tt2560140',
            season: 4,
            episodeOffset: 16, // Part 2 Episode 1 = Season 4 Episode 17
            name: 'Attack on Titan - The Final Season Part 2',
            maxEpisodes: 12
        },

        // Attack on Titan Final Chapters Part 1
        'AOT_FINAL_P1_KITSU_ID': {
            imdbId: 'tt2560140',
            season: 4,
            episodeOffset: 28, // Final Part 1 Episode 1 = Season 4 Episode 29
            name: 'Attack on Titan - The Final Season Final Chapters Part 1',
            maxEpisodes: 2
        },

        // Attack on Titan Final Chapters Part 2
        'AOT_FINAL_P2_KITSU_ID': {
            imdbId: 'tt2560140',
            season: 4,
            episodeOffset: 30, // Final Part 2 Episode 1 = Season 4 Episode 31
            name: 'Attack on Titan - The Final Season Final Chapters Part 2',
            maxEpisodes: 4
        },*/
    };

    // Cached request wrapper
    static async makeCachedRequest(url, options = {}) {
        const cacheKey = url;
        const cached = this.CACHE.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            console.log(`[CACHE] HIT: ${url}`);
            return cached.data;
        }

        console.log(`[CACHE] MISS: ${url}`);

        try {
            const response = await Utils.makeRequest(url);

            if (response) {
                this.CACHE.set(cacheKey, {
                    data: response,
                    timestamp: Date.now()
                });

                // Simple cache cleanup
                if (this.CACHE.size > 200) {
                    const oldestKey = this.CACHE.keys().next().value;
                    this.CACHE.delete(oldestKey);
                }
            }

            return response;
        } catch (error) {
            console.error(`Request failed for ${url}:`, error);
            return null;
        }
    }


    static async makeRateLimitedRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            this.REQUEST_QUEUE.push({ url, options, resolve, reject });
            this.processQueue();
        });
    }


    static async processQueue() {
        if (this.PROCESSING_QUEUE || this.REQUEST_QUEUE.length === 0) {
            return;
        }

        this.PROCESSING_QUEUE = true;

        while (this.REQUEST_QUEUE.length > 0) {
            const batch = this.REQUEST_QUEUE.splice(0, this.MAX_CONCURRENT_REQUESTS);

            const promises = batch.map(async ({ url, options, resolve, reject }) => {
                try {
                    const result = await this.makeCachedRequest(url, options);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });

            await Promise.all(promises);

            if (this.REQUEST_QUEUE.length > 0) {
                await new Promise(resolve => setTimeout(resolve, this.REQUEST_DELAY));
            }
        }

        this.PROCESSING_QUEUE = false;
    }


    static async getKitsuMappingFromDatabase(kitsuId) {
        try {
            const url = `${this.RATINGS_API_URL}/api/kitsu-mapping/${kitsuId}`;
            const response = await Utils.makeRequest(url);

            if (response && response.imdbId && !response.error) {
                return response.imdbId;
            }

            return null;
        } catch (error) {
            console.warn(`Failed to get Kitsu mapping from database:`, error);
            return null;
        }
    }


    static async saveKitsuMappingToDatabase(kitsuId, imdbId, source = 'api_discovery') {
        try {
            const url = `${this.RATINGS_API_URL}/api/kitsu-mapping`;
            const payload = {
                kitsuId: kitsuId,
                imdbId: imdbId,
                source: source,
                timestamp: new Date().toISOString()
            };

            await this.makePostRequest(url, payload);
            console.log(`💾 Saved mapping to database: ${kitsuId} → ${imdbId} (${source})`);
        } catch (error) {
            console.warn(`Failed to save Kitsu mapping to database:`, error);
        }
    }


    static makePostRequest(url, data) {
        return new Promise((resolve, reject) => {
            const https = require('https');
            const http = require('http');
            const urlParsed = new URL(url);
            const protocol = urlParsed.protocol === 'https:' ? https : http;

            const postData = JSON.stringify(data);
            const options = {
                hostname: urlParsed.hostname,
                port: urlParsed.port,
                path: urlParsed.pathname + urlParsed.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = protocol.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => responseData += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(responseData));
                    } catch (e) {
                        resolve(null);
                    }
                });
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    // Main mapping function with multi-API strategy
    static async getImdbFromKitsu(kitsuId) {
        try {
            console.log(`🎌 Auto-mapping Kitsu ID ${kitsuId} to IMDb...`);

            // 1. Check manual mappings first
            if (this.MANUAL_MAPPINGS[kitsuId]) {
                const imdbId = this.MANUAL_MAPPINGS[kitsuId];
                console.log(`✅ Using manual mapping: ${kitsuId} → ${imdbId}`);
                return imdbId;
            }

            // 2. Check database for existing mapping
            const dbMapping = await this.getKitsuMappingFromDatabase(kitsuId);
            if (dbMapping) {
                console.log(`✅ Using database mapping: ${kitsuId} → ${dbMapping}`);
                return dbMapping;
            }

            // 3. Get anime metadata from Kitsu
            const kitsuUrl = `https://kitsu.io/api/edge/anime/${kitsuId}`;
            const kitsuResponse = await this.makeRateLimitedRequest(kitsuUrl); // CHANGED: was makeCachedRequest

            if (!kitsuResponse?.data?.attributes) {
                console.log(`No Kitsu metadata found for ID: ${kitsuId}`);
                return null;
            }

            const attrs = kitsuResponse.data.attributes;
            const allTitles = [
                attrs.canonicalTitle,
                attrs.titles?.en,
                attrs.titles?.en_jp,
                attrs.titles?.en_us,
                attrs.titles?.ja_jp
            ].filter(Boolean);

            if (allTitles.length === 0) {
                console.log(`No titles found for Kitsu ID: ${kitsuId}`);
                return null;
            }

            console.log(`Found anime titles:`, allTitles);

            // 4. Try TMDB first
            if (this.TMDB_API_KEY && this.TMDB_API_KEY !== 'your_tmdb_api_key_here') {
                const kitsuData = {
                    titles: allTitles,
                    year: attrs.startDate ? new Date(attrs.startDate).getFullYear() : null,
                    subtype: attrs.subtype,
                    episodeCount: attrs.episodeCount
                };

                const tmdbResult = await this.searchTMDBForAnime(kitsuData);
                if (tmdbResult?.imdbId) {
                    console.log(`✅ Found via TMDB: ${kitsuId} → ${tmdbResult.imdbId}`);
                    await this.saveKitsuMappingToDatabase(kitsuId, tmdbResult.imdbId, 'tmdb');
                    return tmdbResult.imdbId;
                }
            }

            // 5. Fallback to IMDb search logic
            console.log(`⚠️ TMDB failed or unavailable, using IMDb fallback...`);

            // IMDb SEARCH LOGIC
            for (const title of allTitles) {
                const result = await this.searchImdbByTitle(title, {
                    subtype: attrs.subtype,
                    year: attrs.startDate ? new Date(attrs.startDate).getFullYear() : null
                });

                if (result) {
                    console.log(`✅ Found via IMDb fallback: ${kitsuId} → ${result}`);
                    await this.saveKitsuMappingToDatabase(kitsuId, result, 'imdb_fallback');
                    return result;
                }

                // Your existing title cleaning logic
                const cleaningPatterns = [
                    /\s+season\s+\d+/gi,
                    /[:\-]\s*season\s*\d+/gi,
                    /[:\-]\s*(part|vol|volume)\s*\d+/gi,
                    /[:\-]\s*第\d+期/gi,
                    /\s+\d+(st|nd|rd|th)\s+season/gi
                ];

                for (const pattern of cleaningPatterns) {
                    const cleanTitle = title.replace(pattern, '').trim();
                    if (cleanTitle !== title && cleanTitle.length > 0) {
                        console.log(`Trying clean title: "${cleanTitle}"`);
                        const cleanResult = await this.searchImdbByTitle(cleanTitle, {
                            subtype: attrs.subtype,
                            year: attrs.startDate ? new Date(attrs.startDate).getFullYear() : null
                        });
                        if (cleanResult) {
                            console.log(`✅ Found via cleaned IMDb search: ${kitsuId} → ${cleanResult}`);
                            await this.saveKitsuMappingToDatabase(kitsuId, cleanResult, 'imdb_fallback');
                            return cleanResult;
                        }
                    }
                }
            }

            console.log(`No IMDb mapping found for any title variants`);
            return null;

        } catch (error) {
            console.error(`Error auto-mapping Kitsu ID ${kitsuId}:`, error);
            return null;
        }
    }

    static async findEpisodeByTitle(seriesImdbId, season, episode) {
        try {
            console.log(`Trying episode title matching via IMDb suggestions for S${season}E${episode}...`);

            // First get the series title from IMDb suggestions
            const seriesData = await this.getSeriesTitleFromImdb(seriesImdbId);
            if (!seriesData) {
                console.log(`Could not get series title for ${seriesImdbId}`);
                return null;
            }

            console.log(`Series title: "${seriesData.title}"`);

            // Search for specific episode with multiple query formats
            const queries = [
                `${seriesData.title} season ${season} episode ${episode}`,
                `${seriesData.title} S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`,
                `${seriesData.title} ${season}x${episode}`
            ];

            for (const query of queries) {
                console.log(`Searching IMDb for: "${query}"`);
                const episodeId = await this.searchImdbByTitle(query);
                if (episodeId && episodeId !== seriesImdbId) {
                    console.log(`Found episode ID: ${episodeId} for "${query}"`);
                    return episodeId;
                }
            }

            console.log(`No episode found via title matching`);
            return null;

        } catch (error) {
            console.error(`Error finding episode by title:`, error);
            return null;
        }
    }

    static async getSeriesTitleFromImdb(imdbId) {
        try {
            const url = `https://v2.sg.media-imdb.com/suggestion/t/${imdbId}.json`;
            const response = await this.makeCachedRequest(url);

            if (response?.d?.length > 0) {
                return { title: response.d[0].l };
            }
            return null;
        } catch (error) {
            console.error(`Error getting series title for ${imdbId}:`, error);
            return null;
        }
    }

    static async getTMDBExternalIds(mediaType, tmdbId) {
        try {
            const params = new URLSearchParams({
                api_key: this.TMDB_API_KEY
            });
            const externalUrl = `${this.TMDB_BASE_URL}/${mediaType}/${tmdbId}/external_ids?${params.toString()}`;
            const externalData = await this.makeRateLimitedRequest(externalUrl);

            return externalData?.imdb_id || null;
        } catch (error) {
            console.error(`Error getting external IDs for TMDB ${mediaType}/${tmdbId}:`, error);
            return null;
        }
    }

    // Get enhanced metadata from Kitsu
    static async getKitsuMetadata(kitsuId) {
        const kitsuUrl = `https://kitsu.io/api/edge/anime/${kitsuId}`;
        const kitsuResponse = await this.makeCachedRequest(kitsuUrl);

        if (!kitsuResponse?.data?.attributes) {
            return null;
        }

        const attrs = kitsuResponse.data.attributes;
        return {
            titles: [
                attrs.canonicalTitle,
                attrs.titles?.en,
                attrs.titles?.en_jp,
                attrs.titles?.en_us,
                attrs.titles?.ja_jp
            ].filter(Boolean),
            year: attrs.startDate ? new Date(attrs.startDate).getFullYear() : null,
            subtype: attrs.subtype, // 'TV', 'Movie', 'OVA', 'ONA'
            episodeCount: attrs.episodeCount,
            status: attrs.status,
            synopsis: attrs.synopsis
        };
    }

    // TMDB search with anime-specific logic
    static async searchTMDBForAnime(kitsuData) {
        if (!this.TMDB_API_KEY || this.TMDB_API_KEY === 'your_tmdb_api_key_here') {
            console.warn(`⚠️ TMDB API key not configured, skipping TMDB search`);
            return null;
        }

        // SMART TITLE ORDERING: Try shorter, more common titles first
        const prioritizedTitles = this.prioritizeTitles(kitsuData.titles);

        for (const title of prioritizedTitles) {
            try {
                // STRATEGY 1: Try original title first
                console.log(`🎯 Strategy 1: Trying original title: "${title}"`);
                let result = await this.searchTMDBTitle(title, kitsuData);
                if (result) {
                    console.log(`✅ Found via original title: ${result.imdbId}`);
                    return result;
                }

                // STRATEGY 2: ALWAYS try cleaned title (remove season/sequel indicators)
                const cleanedTitle = this.removeSeasonFromTitle(title);
                if (cleanedTitle !== title && cleanedTitle.length > 2) {
                    console.log(`🧹 Strategy 2: Trying cleaned title: "${cleanedTitle}" (removed season from "${title}")`);
                    result = await this.searchTMDBTitle(cleanedTitle, kitsuData, true);
                    if (result) {
                        console.log(`✅ Found via cleaned title: ${result.imdbId}`);
                        return result;
                    }
                } else {
                    console.log(`⏭️ Cleaned title same as original or too short, skipping: "${cleanedTitle}"`);
                }

            } catch (error) {
                console.error(`Error searching TMDB for "${title}":`, error);
                continue;
            }
        }

        console.log(`❌ No TMDB results found for any title variant`);
        return null;
    }

    // NEW: Helper method to search a single title
    static async searchTMDBTitle(title, kitsuData, isCleaned = false) {
        const params = new URLSearchParams({
            api_key: this.TMDB_API_KEY,
            query: title
        });

        if (kitsuData.year && !isCleaned) {
            // Only add year for original titles, not cleaned ones
            params.append('year', kitsuData.year);
        }

        const searchUrl = `${this.TMDB_BASE_URL}/search/multi?${params.toString()}`;
        const yearNote = kitsuData.year && !isCleaned ? ` (${kitsuData.year})` : '';
        const cleanedNote = isCleaned ? ' [CLEANED]' : '';
        console.log(`🔍 Searching TMDB for: "${title}"${yearNote}${cleanedNote}`);

        const searchResults = await this.makeRateLimitedRequest(searchUrl);

        if (searchResults?.results?.length > 0) {
            console.log(`📊 Found ${searchResults.results.length} TMDB candidates, scoring...`);
            const scoredResults = await this.scoreTMDBCandidates(searchResults.results, kitsuData, title, isCleaned);

            // Show top 3 candidates with scores
            const topCandidates = scoredResults.slice(0, 3);
            console.log(`🏆 Top candidates:`, topCandidates.map(c =>
                `${c.title || c.name} (${c.id}) [${c.media_type}] Score: ${c.score.toFixed(1)}`
            ));

            for (const candidate of scoredResults) {
                // LOWERED thresholds to ensure we try cleaned titles
                const minScore = isCleaned ? 5 : 10; // Much lower thresholds
                console.log(`🎯 Checking candidate "${candidate.title || candidate.name}" - Score: ${candidate.score.toFixed(1)} (min: ${minScore})`);

                if (candidate.score >= minScore) {
                    const imdbId = await this.getTMDBExternalIds(candidate.media_type, candidate.id);
                    if (imdbId) {
                        const strategyNote = isCleaned ? ' (via cleaned title)' : ' (via original title)';
                        console.log(`🎯 TMDB match: "${title}"${strategyNote} → ${candidate.media_type}/${candidate.id} → ${imdbId} (Score: ${candidate.score.toFixed(1)})`);
                        return { imdbId, tmdbId: candidate.id, mediaType: candidate.media_type };
                    } else {
                        console.log(`❌ No IMDb ID found for TMDB ${candidate.media_type}/${candidate.id}`);
                    }
                } else {
                    console.log(`⏭️ Score too low (${candidate.score.toFixed(1)} < ${minScore}), trying next candidate`);
                }
            }
        } else {
            console.log(`❌ No TMDB results found for: "${title}"`);
        }

        return null;
    }

    // Remove season indicators from titles for better matching
    static removeSeasonFromTitle(title) {
        const seasonPatterns = [
            /\s+\d+$/, // "Title 2", "Title 3" ← REMOVES THE PROBLEMATIC NUMBERS
            /\s+season\s+\d+/gi,
            /[:\-]\s*season\s*\d+/gi,
            /[:\-]\s*(part|vol|volume)\s*\d+/gi,
            /[:\-]\s*第\d+期/gi,
            /\s+\d+(st|nd|rd|th)\s+season/gi,
            /[:\-]\s*(book|chapter)\s*\d+/gi,
            /\s+(II|III|IV|V|VI|VII|VIII|IX|X)$/i // Roman numerals
        ];

        let cleanedTitle = title;

        for (const pattern of seasonPatterns) {
            const newTitle = cleanedTitle.replace(pattern, '').trim();
            if (newTitle.length > 0 && newTitle !== cleanedTitle) {
                cleanedTitle = newTitle;
                break; // Only apply first matching pattern
            }
        }

        return cleanedTitle;
    }

    static prioritizeTitles(titles) {
        if (!titles || titles.length === 0) return [];

        // Create title objects with priority scores
        const scoredTitles = titles.map(title => {
            let score = 0;
            const titleLower = title.toLowerCase();

            // PREFER shorter titles (they're often more universal)
            score += Math.max(0, 50 - title.length); // Shorter = higher score

            // PREFER English titles
            if (/^[a-zA-Z0-9\s\-:!?.']+$/.test(title)) {
                score += 20;
            }

            // PREFER common/simplified names
            const commonPatterns = [
                /^[a-zA-Z\s]+$/, // Simple English words only
                /chan$/i,        // "Shin Chan" vs "Crayon Shin-chan"
                /ball$/i,        // "Dragon Ball" vs "Dragon Ball Z"
            ];

            for (const pattern of commonPatterns) {
                if (pattern.test(title)) {
                    score += 15;
                    break;
                }
            }

            // PENALIZE overly descriptive titles
            if (titleLower.includes('crayon') || titleLower.includes('detective') || titleLower.includes('adventures')) {
                score -= 10;
            }

            // SPECIAL CASES for known problematic titles
            if (titleLower === 'shin chan') score += 30; // Boost "Shin Chan"
            if (titleLower.includes('crayon shin-chan')) score -= 20; // Demote full title

            return { title, score };
        });

        // Sort by score (highest first) and return just the titles
        const prioritized = scoredTitles
            .sort((a, b) => b.score - a.score)
            .map(item => item.title);

        console.log(`📊 Title priority order:`, prioritized.map((title, i) =>
            `${i + 1}. "${title}" (${scoredTitles.find(t => t.title === title)?.score})`
        ));

        return prioritized;
    }


    // Helper method to search a single title
    static async searchTMDBTitle(title, kitsuData, isCleaned = false) {
        const params = new URLSearchParams({
            api_key: this.TMDB_API_KEY,
            query: title
        });

        if (kitsuData.year && !isCleaned) {
            // Only add year for original titles, not cleaned ones
            // (cleaned titles might match earlier seasons with different years)
            params.append('year', kitsuData.year);
        }

        const searchUrl = `${this.TMDB_BASE_URL}/search/multi?${params.toString()}`;
        console.log(`🔍 Searching TMDB for: "${title}"${kitsuData.year && !isCleaned ? ` (${kitsuData.year})` : ''}`);

        const searchResults = await this.makeRateLimitedRequest(searchUrl);

        if (searchResults?.results?.length > 0) {
            const scoredResults = await this.scoreTMDBCandidates(searchResults.results, kitsuData, title, isCleaned);

            for (const candidate of scoredResults) {
                const minScore = isCleaned ? 10 : 15; // Lower threshold for cleaned titles
                if (candidate.score >= minScore) {
                    const imdbId = await this.getTMDBExternalIds(candidate.media_type, candidate.id);
                    if (imdbId) {
                        const cleanedNote = isCleaned ? ' (cleaned title)' : '';
                        console.log(`🎯 TMDB match: "${title}"${cleanedNote} → ${candidate.media_type}/${candidate.id} → ${imdbId} (Score: ${candidate.score})`);
                        return { imdbId, tmdbId: candidate.id, mediaType: candidate.media_type };
                    }
                }
            }
        }

        return null;
    }

    // Remove season indicators from titles for better matching
    static removeSeasonFromTitle(title) {
        const seasonPatterns = [
            /\s+\d+$/, // "Title 2", "Title 3" ← REMOVES THE PROBLEMATIC NUMBERS
            /\s+season\s+\d+/gi,
            /[:\-]\s*season\s*\d+/gi,
            /[:\-]\s*(part|vol|volume)\s*\d+/gi,
            /[:\-]\s*第\d+期/gi,
            /\s+\d+(st|nd|rd|th)\s+season/gi,
            /[:\-]\s*(book|chapter)\s*\d+/gi,
            /\s+(II|III|IV|V|VI|VII|VIII|IX|X)$/i // Roman numerals
        ];

        let cleanedTitle = title;

        for (const pattern of seasonPatterns) {
            const newTitle = cleanedTitle.replace(pattern, '').trim();
            if (newTitle.length > 0 && newTitle !== cleanedTitle) {
                cleanedTitle = newTitle;
                break; // Only apply first matching pattern
            }
        }

        return cleanedTitle;
    }


    // Score TMDB candidates with anime-aware logic + episode count validation
    static async scoreTMDBCandidates(results, kitsuData, searchTitle, isCleaned = false) {
        const scoredResults = await Promise.all(results.map(async item => {
            let score = 0;
            const title = item.title || item.name || '';
            const titleLower = title.toLowerCase();
            const searchLower = searchTitle.toLowerCase();

            // Base score
            score += 1;

            // STRICT: For TV anime, REJECT movies unless it's a very specific match
            if (kitsuData.subtype === 'TV' && item.media_type === 'movie') {
                // Only allow movies if they have extremely high title similarity AND are animated
                const hasAnimation = item.genre_ids && item.genre_ids.includes(16);
                const isExactMatch = titleLower === searchLower;

                if (!isExactMatch || !hasAnimation) {
                    console.log(`🚫 REJECTING movie "${title}" for TV anime (not exact match or not animated)`);
                    return { ...item, score: -999 }; // Effectively reject
                } else {
                    console.log(`⚠️ Allowing movie "${title}" (exact animated match)`);
                    score -= 15; // Still penalize heavily
                }
            }

            // TV series gets MAJOR bonus for anime
            if (kitsuData.subtype === 'TV') {
                if (item.media_type === 'tv') {
                    score += 30;
                    console.log(`📺 TV series bonus: +30 for "${title}"`);
                }
            }

            // Title matching (adjusted for cleaned titles)
            if (titleLower === searchLower) {
                score += 25; // Exact match
            } else if (titleLower.includes(searchLower) || searchLower.includes(titleLower)) {
                score += 15; // Partial match
            } else if (titleLower.startsWith(searchLower) || searchLower.startsWith(titleLower)) {
                score += 10; // Prefix match
            }

            // Year matching (more lenient for cleaned titles)
            if (kitsuData.year && (item.release_date || item.first_air_date)) {
                const tmdbYear = new Date(item.release_date || item.first_air_date).getFullYear();
                const yearDiff = Math.abs(tmdbYear - kitsuData.year);

                if (isCleaned) {
                    // More lenient year matching for cleaned titles (base series might be older)
                    if (yearDiff <= 2) score += 15;
                    else if (yearDiff <= 5) score += 10;
                    else if (yearDiff <= 10) score += 5;
                } else {
                    // Strict year matching for original titles
                    if (yearDiff === 0) score += 20;
                    else if (yearDiff === 1) score += 15;
                    else if (yearDiff <= 2) score += 10;
                    else score -= 5;
                }
            }

            // Animation genre bonus (genre_ids: 16 = Animation)
            if (item.genre_ids && item.genre_ids.includes(16)) {
                score += 10;
            }

            // Origin country bonus for anime (Japan)
            if (item.origin_country && item.origin_country.includes('JP')) {
                score += 8;
            }

            // Original language bonus (Japanese)
            if (item.original_language === 'ja') {
                score += 8;
            }

            // Episode count validation for TV series (existing logic)
            if (kitsuData.subtype === 'TV' && item.media_type === 'tv' && kitsuData.episodeCount) {
                try {
                    const detailsUrl = `${this.TMDB_BASE_URL}/tv/${item.id}?api_key=${this.TMDB_API_KEY}`;
                    const details = await this.makeRateLimitedRequest(detailsUrl);

                    if (details?.number_of_episodes) {
                        const epDiff = Math.abs(kitsuData.episodeCount - details.number_of_episodes);
                        if (epDiff <= 2) {
                            score += 8;
                            console.log(`📊 Episode count bonus: Kitsu ${kitsuData.episodeCount} ≈ TMDB ${details.number_of_episodes} (+8)`);
                        } else if (epDiff <= 5) {
                            score += 4;
                            console.log(`📊 Episode count bonus: Kitsu ${kitsuData.episodeCount} ≈ TMDB ${details.number_of_episodes} (+4)`);
                        } else if (epDiff > 20) {
                            score -= 5;
                            console.log(`📊 Episode count penalty: Kitsu ${kitsuData.episodeCount} vs TMDB ${details.number_of_episodes} (-5)`);
                        }
                    }
                } catch (error) {
                    console.warn(`Could not fetch episode count for TMDB TV/${item.id}:`, error.message);
                }
            }

            // Popularity threshold
            if (item.popularity > 1) {
                score += Math.min(item.popularity / 10, 5);
            }

            // Exact base title matching with normalization
            const normalizeTitle = (title) => {
                return title
                    .replace(/boku no hero academia/gi, 'my hero academia')
                    .replace(/shingeki no kyojin/gi, 'attack on titan')
                    .replace(/kimetsu no yaiba/gi, 'demon slayer')
                    .replace(/arcane season/gi, 'arcane')
                    // Add more as needed
                    .trim();
            };

            const baseSearchTitle = normalizeTitle(searchLower.replace(/\s*(season\s*)?\d+\s*$/, ''));
            const baseTmdbTitle = normalizeTitle(titleLower.replace(/\s*(season\s*)?\d+\s*$/, ''));

            if (baseSearchTitle === baseTmdbTitle && baseSearchTitle.length > 3) {
                score += 20;
                console.log(`🎯 Exact base title match bonus: +20 for "${title}" (normalized match)`);
            }

            return { ...item, score };
        }));

        return scoredResults.sort((a, b) => b.score - a.score);
    }


    // Get IMDb ID from TMDB external IDs
    static async getTMDBExternalIds(mediaType, tmdbId) {
        try {
            const params = new URLSearchParams({
                api_key: this.TMDB_API_KEY
            });
            const externalUrl = `${this.TMDB_BASE_URL}/${mediaType}/${tmdbId}/external_ids?${params.toString()}`;
            const externalData = await this.makeCachedRequest(externalUrl);

            return externalData?.imdb_id || null;
        } catch (error) {
            console.error(`Error getting external IDs for TMDB ${mediaType}/${tmdbId}:`, error);
            return null;
        }
    }

    // Generate cleaned title variants
    static generateCleanedTitles(title) {
        const cleaningPatterns = [
            /\s+season\s+\d+$/gi,
            /[:\-]\s*season\s*\d+/gi,
            /[:\-]\s*(part|vol|volume)\s*\d+/gi,
            /[:\-]\s*第\d+期/gi,
            /\s+\d+(st|nd|rd|th)\s+season/gi,
            /[:\-]\s*(book|chapter)\s*\d+/gi
        ];

        const variants = [title];

        for (const pattern of cleaningPatterns) {
            const cleaned = title.replace(pattern, '').trim();
            if (cleaned !== title && cleaned.length > 0) {
                variants.push(cleaned);
            }
        }

        return [...new Set(variants)]; // Remove duplicates
    }

    // Fallback to IMDb search (legacy method, use sparingly)
    static async searchIMDbFallback(kitsuData) {
        console.warn(`⚠️ Using IMDb fallback search - this should be rare!`);

        for (const title of kitsuData.titles) {
            try {
                const result = await this.searchImdbByTitle(title, {
                    subtype: kitsuData.subtype,
                    year: kitsuData.year
                });
                if (result) {
                    return result;
                }
            } catch (error) {
                console.error(`IMDb fallback failed for "${title}":`, error);
                continue;
            }
        }

        return null;
    }

    // Legacy IMDb search method (keep for fallback)
    static async searchImdbByTitle(title, context = {}) {
        try {
            const letter = title.slice(0, 1).toLowerCase();
            const query = encodeURIComponent(title.trim());
            const imdbUrl = `https://v2.sg.media-imdb.com/suggestion/${letter}/${query}.json`;

            console.log(`🔍 [FALLBACK] Searching IMDb for: "${title}"`);
            const imdbResponse = await this.makeCachedRequest(imdbUrl);

            if (imdbResponse?.d?.length > 0) {
                let candidates = imdbResponse.d.map(item => {
                    let score = 1;

                    // Year matching
                    if (context.year && item.y) {
                        const yearDiff = Math.abs(item.y - context.year);
                        if (yearDiff === 0) score += 20;
                        else if (yearDiff === 1) score += 15;
                        else if (yearDiff <= 2) score += 10;
                        else score -= 5;
                    }

                    // Content type matching
                    if (context.subtype === 'TV' && item.q === 'TV series') {
                        score += 15;
                    } else if (context.subtype === 'Movie' && (item.q === 'movie' || item.q === 'TV movie')) {
                        score += 15;
                    }

                    // Title matching
                    const candidateTitle = item.l.toLowerCase();
                    const searchTitle = title.toLowerCase();

                    if (candidateTitle === searchTitle) {
                        score += 25;
                    } else if (candidateTitle.includes(searchTitle) || searchTitle.includes(candidateTitle)) {
                        score += 15;
                    }

                    // PENALTY for specials/episodes
                    if (candidateTitle.includes('special')) score -= 10;
                    if (candidateTitle.includes('episode')) score -= 10;
                    if (candidateTitle.includes('ova')) score -= 5;
                    if (candidateTitle.includes('movie') && context.subtype === 'TV') score -= 8;

                    // BONUS for main series indicators
                    if (item.q === 'TV series' && context.subtype === 'TV') score += 5;
                    if (candidateTitle === searchTitle && item.q === 'TV series') score += 10;

                    return { ...item, score };
                });

                candidates.sort((a, b) => b.score - a.score);

                console.log(`🏆 IMDb candidate scores:`, candidates.slice(0, 3).map(c =>
                    `${c.l} (${c.id}) [${c.q}] Score: ${c.score}`
                ));

                if (candidates.length > 0 && candidates[0].score >= 10) {
                    console.log(`✅ Selected IMDb candidate: ${candidates[0].l} (${candidates[0].id}) [Score: ${candidates[0].score}]`);
                    return candidates[0].id;
                }
            }

            return null;
        } catch (error) {
            console.error(`Error in IMDb fallback search for "${title}":`, error);
            return null;
        }
    }

    // Season handling
    static async getKitsuSeasonInfo(kitsuId, episode) {
        try {
            const kitsuUrl = `https://kitsu.io/api/edge/anime/${kitsuId}`;
            const kitsuResponse = await this.makeCachedRequest(kitsuUrl);

            if (!kitsuResponse?.data?.attributes) {
                return { season: 1, episode: episode };
            }

            const attrs = kitsuResponse.data.attributes;
            const title = attrs.canonicalTitle || attrs.titles?.en || '';

            // ENHANCED: Try multiple title variants for season extraction
            const titleVariants = [
                attrs.canonicalTitle,
                attrs.titles?.en,
                attrs.titles?.en_jp,
                attrs.titles?.ja_jp
            ].filter(Boolean);

            let detectedSeason = 1;

            // Try to extract season from any title variant
            for (const titleVariant of titleVariants) {
                const normalizedTitle = Utils.normalizeAnimeTitle(titleVariant);
                const extractedSeason = Utils.extractSeasonFromTitle(normalizedTitle);

                if (extractedSeason > 1) {
                    detectedSeason = extractedSeason;
                    console.log(`🎯 Season detected from "${titleVariant}": Season ${detectedSeason}`);
                    break; // Use first non-1 season found
                }
            }

            console.log(`📺 Final Kitsu season info: "${title}" -> Season ${detectedSeason}, Episode ${episode}`);
            return { season: detectedSeason, episode };

        } catch (error) {
            console.error(`Error getting Kitsu season info for ${kitsuId}:`, error);
            return { season: 1, episode: episode };
        }
    }


    static getHardcodedSeasonMapping(imdbId, season, episode) {

        const SEASON_MAPPINGS = {
            'tt0388629': {
                episodesPerSeason: [0, 8, 22, 17, 13, 9, 22, 39, 13, 52, 31, 99, 56, 100, 35, 62, 49, 118, 33, 98, 14, 194, 48],
            }
        };

        const mapping = SEASON_MAPPINGS[imdbId];
        if (!mapping) return null;

        let absoluteEpisode = 0;
        for (let s = 1; s < season; s++) {
            if (mapping.episodesPerSeason[s]) {
                absoluteEpisode += mapping.episodesPerSeason[s];
            }
        }
        absoluteEpisode += episode;

        console.log(`Hardcoded mapping for ${imdbId}: S${season}E${episode} → S1E${absoluteEpisode}`);
        return { season: 1, episode: absoluteEpisode };
    }

    // Helper for episode mapping
    static async processKitsuEpisodeMapping(parsedId) {
        console.log(`🎌 Processing Kitsu episode mapping for ${parsedId.kitsuId}, episode ${parsedId.episode}`);

        // Check for enhanced manual mapping first
        if (this.MANUAL_MAPPINGS[parsedId.kitsuId]) {
            const mapping = this.MANUAL_MAPPINGS[parsedId.kitsuId];

            // Validate episode range
            if (mapping.maxEpisodes && parsedId.episode > mapping.maxEpisodes) {
                console.warn(`⚠️ Episode ${parsedId.episode} exceeds max episodes (${mapping.maxEpisodes}) for ${mapping.name}`);
            }

            // Apply episode offset
            const adjustedEpisode = parsedId.episode + mapping.episodeOffset;

            console.log(`📋 Enhanced manual mapping found: ${mapping.name}`);
            console.log(`   Original: Episode ${parsedId.episode}`);
            console.log(`   Mapped to: Season ${mapping.season}, Episode ${adjustedEpisode}`);
            console.log(`   IMDb ID: ${mapping.imdbId}`);

            // Update parsedId with mapped values
            parsedId.season = mapping.season;
            parsedId.episode = adjustedEpisode;

            return mapping.imdbId;
        }

        // Fall back to existing auto-mapping logic
        const seasonInfo = await this.getKitsuSeasonInfo(parsedId.kitsuId, parsedId.episode);
        parsedId.season = seasonInfo.season;
        parsedId.episode = seasonInfo.episode;

        return await this.getImdbFromKitsu(parsedId.kitsuId);
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

    // NEW: Get episode rating by episode ID (for Cinemeta fix)
    static async getEpisodeRatingById(episodeId) {
        try {
            const url = `${RATINGS_API_URL}/api/episode/id/${episodeId}`;
            console.log(`Fetching episode rating by ID from local dataset:`, url);

            const data = await Utils.makeRequest(url);
            console.log('Episode by ID API response:', data);

            if (data?.rating && !data.error) {
                return {
                    rating: data.rating,
                    votes: data.votes || '0',
                    episodeId: data.episodeId || episodeId,
                    type: 'episode'
                };
            }

            console.log('⚠️ No episode rating found by ID in local dataset');
            return null;
        } catch (error) {
            console.error('Error fetching episode by ID from local dataset:', error);
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
            idPrefixes: ['tt', 'kitsu'],
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
        const { showVotes, format, streamName, voteFormat, ratingFormat } = config;

        // Handle "not available" case
        if (type === 'not_available') {
            return {
                name: streamName,
                description: '❌  Episode rating not available\n⭐  IMDb Series Rating:  Not Available'
            };
        }

        // Format votes and rating according to config
        const formattedVotes = Utils.formatVotes(votes, voteFormat);
        const formattedRating = Utils.formatRating(rating, ratingFormat);
        const votesText = showVotes && formattedVotes ? ` (${formattedVotes} votes)` : '';

        // Handle series fallback case
        if (type === 'series_fallback') {
            return {
                name: streamName,
                description: `❌  Episode rating not available\n⭐  IMDb Series Rating:  ${formattedRating} ${votesText}`
            };
        }

        if (format === 'singleline') {
            return {
                name: streamName,
                description: `⭐  IMDb:  ${formattedRating} ${votesText}`
            };
        }

        // ── MULTILINE (episode)
        const ratingLine = `⭐  IMDb:  ${formattedRating}`;
        const lines = [
            '─'.repeat(ratingLine.length),
            ratingLine
        ];
        if (showVotes && formattedVotes) {
            const firstDigitPos = ratingLine.search(/\d/) - 1;
            const indent = ' '.repeat(firstDigitPos);
            lines.push(`${indent}(${formattedVotes} votes)`);
        }
        lines.push('─'.repeat(ratingLine.length));

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

        // NEW: Smart fallback for season mismatches (like One Piece)
        // If no rating found and not season 1, try hardcoded mapping first
        if (!ratingData && season > 1) {
            console.log(`No rating found for S${season}E${episode}, trying hardcoded mapping...`);

            // Try hardcoded mapping for known problematic series
            const hardcodedMapping = AnimeService.getHardcodedSeasonMapping(imdbId, season, episode);
            if (hardcodedMapping) {
                console.log(`Using hardcoded mapping: S${season}E${episode} → S${hardcodedMapping.season}E${hardcodedMapping.episode}`);
                ratingData = await RatingService.getEpisodeRating(imdbId, hardcodedMapping.season, hardcodedMapping.episode);
                if (ratingData) {
                    console.log(`✅ Found rating via hardcoded mapping: ${ratingData.rating}/10`);
                }
            }

            // Fallback to static calculation if hardcoded mapping fails or doesn't exist
            if (!ratingData) {
                console.log(`Hardcoded mapping failed or doesn't exist, trying static calculation fallback...`);

                // Calculate absolute episode number assuming each season has ~25 episodes
                const estimatedAbsoluteEpisode = ((season - 1) * 25) + episode;
                console.log(`Trying Season 1, Episode ${estimatedAbsoluteEpisode} (estimated from S${season}E${episode})`);

                ratingData = await RatingService.getEpisodeRating(imdbId, 1, estimatedAbsoluteEpisode);

                // If that doesn't work, try a few episodes around it (±2)
                if (!ratingData) {
                    for (let offset of [-2, -1, 1, 2]) {
                        const tryEpisode = estimatedAbsoluteEpisode + offset;
                        if (tryEpisode > 0) {
                            console.log(`Trying Season 1, Episode ${tryEpisode} (offset ${offset})`);
                            ratingData = await RatingService.getEpisodeRating(imdbId, 1, tryEpisode);
                            if (ratingData) {
                                console.log(`✅ Found rating with offset ${offset}: Episode ${tryEpisode}`);
                                break;
                            }
                        }
                    }
                }
            }

            // Final fallback: episode title matching via IMDb search
            if (!ratingData) {
                console.log(`All other fallbacks failed, trying episode title matching...`);
                const episodeId = await AnimeService.findEpisodeByTitle(imdbId, season, episode);
                if (episodeId) {
                    ratingData = await RatingService.getEpisodeRatingById(episodeId);
                    if (ratingData) {
                        console.log(`✅ Found rating via episode title matching: ${episodeId}`);
                    }
                }
            }
        }

        if (ratingData) {
            // Explicitly set type for episode ratings
            ratingData.type = 'episode';
            const displayConfig = this.formatRatingDisplay(ratingData, config, ratingData.type);
            const stream = this.createStream(displayConfig, imdbId, id, ratingData);
            console.log(`✅ Added episode rating stream: ${ratingData.rating}/10`);
            return [stream];
        }

        // Fallback to series rating with clear indication
        console.log('No episode rating found, trying series rating as fallback...');
        ratingData = await RatingService.getRating(imdbId);

        if (ratingData) {
            ratingData.type = 'series_fallback';
            const displayConfig = this.formatRatingDisplay(ratingData, config, ratingData.type);
            const stream = this.createStream(displayConfig, imdbId, id, ratingData);
            console.log(`✅ Added series fallback rating stream: ${ratingData.rating}/10`);
            return [stream];
        }

        // No rating available at all
        const displayConfig = this.formatRatingDisplay(
            { rating: 'Not Available', votes: '' },
            config,
            'not_available'
        );

        const stream = this.createStream(displayConfig, imdbId, id);

        console.log('❌ Added "no rating" stream');
        return [stream];
    }

    static async handleMovieStreams(id, config) {
        console.log(`Processing movie: ${id}`);

        // 1️⃣ Try normal movie/series rating first
        let ratingData = await RatingService.getRating(id);

        // 2️⃣ If nothing came back AND the id looks like an IMDb tconst,
        //    treat it as a TV-episode id (FIX for Cinemeta)
        if (!ratingData && /^tt\d+$/.test(id)) {
            console.log(`No movie rating found for ${id}, trying as episode ID...`);
            ratingData = await RatingService.getEpisodeRatingById(id);
        }

        if (ratingData) {
            const displayConfig = this.formatRatingDisplay(ratingData, config, ratingData.type || 'movie');
            const stream = this.createStream(displayConfig, id, id, ratingData);
            console.log(`✅ Added ${ratingData.type || 'movie'} rating stream: ${ratingData.rating}/10`);
            return [stream];
        }

        // No rating available
        const displayConfig = this.formatRatingDisplay(
            { rating: 'Not Available', votes: '' },
            config
        );

        const stream = this.createStream({
            name: displayConfig.name,
            description: displayConfig.description.replace(/⭐.*/, '⭐  IMDb Movie Rating: Not Available')
        }, id, id);

        console.log('❌ Added "no rating" stream for movie');
        return [stream];
    }

    // getStreams method with anime support
    static async getStreams(type, id, config) {
        console.log(`🎬 StreamService.getStreams called with type="${type}", id="${id}"`);

        const parsedId = Utils.parseContentId(id);
        if (!parsedId) {
            console.log('❌ Could not parse content ID');
            return [];
        }

        console.log(`✅ Parsed ID:`, parsedId);

        if (!['series', 'movie'].includes(type)) {
            console.log(`❌ Unsupported type: ${type}`);
            return [];
        }

        try {
            let imdbId = null;

            // Handle Kitsu content
            if (parsedId.platform === 'kitsu') {
                console.log(`🎌 Processing Kitsu content: ${parsedId.kitsuId}`);

                if (parsedId.episode) {
                    // Use enhanced episode mapping - this handles EVERYTHING
                    imdbId = await AnimeService.processKitsuEpisodeMapping(parsedId);
                    // ✅ parsedId.season and parsedId.episode are now correctly set
                    console.log(`✅ Enhanced mapping complete: S${parsedId.season}E${parsedId.episode}`);
                } else {
                    imdbId = await AnimeService.getImdbFromKitsu(parsedId.kitsuId);
                }

                if (!imdbId) {
                    console.log('❌ Could not map Kitsu ID to IMDb');
                    return this.createNoRatingStream(config, parsedId.originalId);
                }
                console.log(`✅ Mapped to IMDb ID: ${imdbId}`);

            } else {
                console.log(`🎬 Processing IMDb content: ${parsedId.imdbId}`);
                imdbId = parsedId.imdbId;
            }

            // Get rating data
            if (parsedId.type === 'series' && parsedId.season && parsedId.episode) {
                console.log(`📺 Processing as series episode: S${parsedId.season}E${parsedId.episode}`);
                return await this.handleSeriesStreams(imdbId, parsedId.season, parsedId.episode, parsedId.originalId, config);
            } else {
                console.log(`🎞️ Processing as movie/single content`);
                return await this.handleMovieStreams(imdbId, config);
            }
        } catch (error) {
            console.error('❌ Error getting streams:', error);
            return [];
        }
    }

    // Helper method for no rating streams
    static createNoRatingStream(config, originalId, imdbId = null) {
        const displayConfig = this.formatRatingDisplay(
            { rating: 'Not Available', votes: '' },
            config
        );

        const stream = this.createStream({
            name: displayConfig.name,
            description: displayConfig.description.replace(/⭐.*/, '⭐  IMDb Rating: Not Available')
        }, imdbId, originalId);

        console.log('❌ Added "no rating" stream');
        return [stream];
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
    static async handleManifest(pathname, searchParams) {
        // Try path-based config first, fallback to query param for backward compatibility
        let config = Utils.parseConfigFromPath(pathname);

        // Fallback to old query param method if no path config found
        if (JSON.stringify(config) === JSON.stringify(DEFAULT_CONFIG)) {
            const configStr = searchParams.get?.('config') || null;
            config = Utils.parseConfig(configStr);
        }

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

        // Extract config from path
        let config = Utils.parseConfigFromPath(pathname);

        // Fallback to query param for backward compatibility
        if (JSON.stringify(config) === JSON.stringify(DEFAULT_CONFIG)) {
            const configStr = searchParams.get?.('config') || null;
            config = Utils.parseConfig(configStr);
        }

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

        // Handle configuration page (support both /configure and /c_*/configure)
        if (pathname.endsWith('/configure') || pathname === '/configure') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.end(HtmlService.generateConfigurePage(baseUrl));
        }

        // Handle health check
        if (pathname.endsWith('/health') || pathname === '/health') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            const result = RouteHandler.handleHealth();
            return res.end(JSON.stringify(result, null, 2));
        }

        // Handle addon routes
        res.setHeader('Content-Type', 'application/json; charset=utf-8');

        if (pathname.endsWith('/manifest.json')) {
            const result = await RouteHandler.handleManifest(pathname, searchParams);
            return res.end(JSON.stringify(result));
        }

        if (pathname.includes('/stream/')) {
            const result = await RouteHandler.handleStream(pathname, searchParams);
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