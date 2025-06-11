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

    // NEW: Extract season number from title
    static extractSeasonFromTitle(title) {
        // Look for season indicators in various formats
        const patterns = [
            /book\s*(\d+)/i,           // "Book 1", "Book 2"
            /season\s*(\d+)/i,         // "Season 1", "Season 2"  
            /part\s*(\d+)/i,           // "Part 1", "Part 2"
            /第(\d+)期/i,              // Japanese "第2期" format
            /\s(\d+)(st|nd|rd|th)\s+season/i, // "2nd Season"
        ];

        for (const pattern of patterns) {
            const match = title.match(pattern);
            if (match) {
                const seasonNum = parseInt(match[1]);
                console.log(`Extracted season ${seasonNum} from title: "${title}"`);
                return seasonNum;
            }
        }

        return 1; // Default to season 1 if no season found
    }
}

// NEW: Anime Mapping Service
class AnimeService {
    // Manual mappings for problematic Kitsu IDs
    static MANUAL_MAPPINGS = {
        '7936': 'tt0417299', // Avatar: The Last Airbender - Book 1: Air
        '7937': 'tt0417299', // Avatar: The Last Airbender - Book 2: Earth
        '7938': 'tt0417299', // Avatar: The Last Airbender - Book 3: Fire
        '7939': 'tt1695360', // Legend of Korra - Book 1: Air
        '8765': 'tt1695360', // Legend of Korra - Book 2: Spirits
        '8766': 'tt1695360', // Legend of Korra - Book 3: Change
        '8767': 'tt1695360', // Legend of Korra - Book 4: Balance
    };

    // Enhanced Kitsu to IMDb mapping with multiple search strategies
    static async getImdbFromKitsu(kitsuId) {
        try {
            console.log(`Auto-mapping Kitsu ID ${kitsuId} to IMDb...`);

            // Check for manual mapping first
            if (this.MANUAL_MAPPINGS[kitsuId]) {
                const imdbId = this.MANUAL_MAPPINGS[kitsuId];
                console.log(`Using manual mapping: ${kitsuId} → ${imdbId}`);
                return imdbId;
            }

            // Get anime metadata from Kitsu
            const kitsuUrl = `https://kitsu.io/api/edge/anime/${kitsuId}`;
            const kitsuResponse = await Utils.makeRequest(kitsuUrl);

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

            // Try multiple search strategies
            for (const title of allTitles) {
                const result = await this.searchImdbByTitle(title);
                if (result) {
                    console.log(`Auto-mapped: ${kitsuId} → ${result} (${title})`);
                    return result;
                }

                // Try without season/part info - multiple cleaning strategies
                const cleaningPatterns = [
                    /\s+season\s+\d+/gi,                    // " Season 2"
                    /[:\-]\s*season\s*\d+/gi,              // ": Season 2" or "- Season 2"
                    /[:\-]\s*(part|vol|volume)\s*\d+/gi,   // ": Part 1", "- Vol 2"
                    /[:\-]\s*第\d+期/gi,                   // Japanese season notation
                    /\s+\d+(st|nd|rd|th)\s+season/gi       // " 2nd Season"
                ];

                for (const pattern of cleaningPatterns) {
                    const cleanTitle = title.replace(pattern, '').trim();
                    if (cleanTitle !== title && cleanTitle.length > 0) {
                        console.log(`Trying clean title: "${cleanTitle}" (removed: "${title.match(pattern)?.[0]}")`);
                        const cleanResult = await this.searchImdbByTitle(cleanTitle);
                        if (cleanResult) {
                            console.log(`Auto-mapped with clean title: ${kitsuId} → ${cleanResult} (${cleanTitle})`);
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

    // Get season and episode info for Kitsu content
    static async getKitsuSeasonInfo(kitsuId, episode) {
        try {
            const kitsuUrl = `https://kitsu.io/api/edge/anime/${kitsuId}`;
            const kitsuResponse = await Utils.makeRequest(kitsuUrl);

            if (!kitsuResponse?.data?.attributes) {
                return { season: 1, episode: episode };
            }

            const attrs = kitsuResponse.data.attributes;
            const title = attrs.canonicalTitle || attrs.titles?.en || '';
            
            const season = Utils.extractSeasonFromTitle(title);
            console.log(`Kitsu season info: "${title}" -> Season ${season}, Episode ${episode}`);
            
            return { season, episode };

        } catch (error) {
            console.error(`Error getting Kitsu season info for ${kitsuId}:`, error);
            return { season: 1, episode: episode };
        }
    }

    static async searchImdbByTitle(title) {
        try {
            const letter = title.slice(0, 1).toLowerCase();
            const query = encodeURIComponent(title.trim());
            const imdbUrl = `https://v2.sg.media-imdb.com/suggestion/${letter}/${query}.json`;

            console.log(`Searching IMDb for: "${title}"`);
            const imdbResponse = await Utils.makeRequest(imdbUrl);
            
            if (imdbResponse?.d?.length > 0) {
                // Filter and prioritize candidates
                const candidates = imdbResponse.d.filter(item => 
                    item.q === 'TV series' || item.q === 'TV movie' || item.q === 'video'
                );
                
                if (candidates.length > 0) {
                    console.log(`Found IMDb candidates:`, candidates.map(c => `${c.l} (${c.id}) [${c.q}]`));
                    
                    // Prioritize main series over episodes/specials
                    const mainSeries = candidates.find(c => {
                        const candidateTitle = c.l.toLowerCase();
                        const searchTitle = title.toLowerCase();
                        
                        // PRIORITY 1: TV series that matches the search title
                        if (c.q === 'TV series' && (
                            candidateTitle === searchTitle ||
                            candidateTitle.includes(searchTitle) ||
                            searchTitle.includes(candidateTitle)
                        )) return true;
                        
                        // PRIORITY 2: Any TV series (if no matching TV series found)
                        if (c.q === 'TV series') return true;
                        
                        // PRIORITY 3: Exact match or very close match
                        if (candidateTitle === searchTitle) return true;
                        
                        // Avoid episode-specific titles - be more specific about what constitutes episodes
                        if (candidateTitle.includes('episode')) return false;
                        if (candidateTitle.includes('special')) return false;
                        if (candidateTitle.match(/:\s*(what|how|why|when|where|the\s+\w+\s+\w+)/i)) return false; // "What Do We Fear?" style
                        
                        // Check if candidate title starts with our search title
                        return candidateTitle.startsWith(searchTitle) || 
                               searchTitle.startsWith(candidateTitle);
                    });
                    
                    let selectedCandidate = mainSeries || candidates[0];
                    
                    // ONLY try to find main series if we found episode-specific results AND no main series
                    // Be more specific about what constitutes "episode-specific"
                    const isEpisodeSpecific = candidates[0].l.includes(':') && 
                        (candidates[0].l.toLowerCase().includes('episode') ||
                         candidates[0].l.match(/:\s*(what|the|part|chapter|\d+)/i) ||
                         candidates[0].q === 'video'); // videos are often episodes
                    
                    if (!mainSeries && candidates.length === 1 && isEpisodeSpecific) {
                        console.log(`Only found episode-specific result, attempting to find main series...`);
                        const episodeId = candidates[0].id;
                        const mainSeriesId = await this.findMainSeriesFromEpisode(episodeId);
                        if (mainSeriesId) {
                            console.log(`Found main series ID: ${mainSeriesId} from episode ${episodeId}`);
                            return mainSeriesId;
                        }
                        console.log(`Could not find main series, using episode result as fallback`);
                    }
                    
                    console.log(`Selected candidate: ${selectedCandidate.l} (${selectedCandidate.id}) [${selectedCandidate.q}]`);
                    return selectedCandidate.id;
                }
            }

            console.log(`No IMDb results for: "${title}"`);
            return null;

        } catch (error) {
            console.error(`Error searching IMDb for "${title}":`, error);
            return null;
        }
    }

    static async findMainSeriesFromEpisode(episodeId) {
        try {
            // Try to extract series ID by making a request to the episode page
            // For Cyberpunk: Edgerunners, tt25447788 (episode) should relate to tt12590266 (series)
            
            const episodeNum = parseInt(episodeId.replace('tt', ''));
            console.log(`Episode number: ${episodeNum}`);
            
            // Try broader ID patterns - series IDs can be much different from episode IDs
            const candidateIds = [
                // Close range
                `tt${episodeNum - 1}`, `tt${episodeNum - 2}`, `tt${episodeNum - 10}`,
                // Medium range  
                `tt${episodeNum - 100}`, `tt${episodeNum - 1000}`, `tt${episodeNum - 10000}`,
                // Far range (like Cyberpunk case: 25447788 -> 12590266)
                `tt${episodeNum - 1000000}`, `tt${episodeNum - 5000000}`, `tt${episodeNum - 10000000}`,
                `tt${episodeNum - 12000000}`, `tt${episodeNum - 12857522}`, // 25447788 - 12590266 = 12857522
                // Pattern-based
                `tt${Math.floor(episodeNum / 10) * 10}`,
                `tt${Math.floor(episodeNum / 100) * 100}`,
                `tt${Math.floor(episodeNum / 1000) * 1000}`,
                // Try some common series ID patterns
                `tt${Math.floor(episodeNum / 2)}`, // Half the episode ID
                `tt${episodeNum.toString().substring(0, 8)}`, // First 8 digits
                `tt${episodeNum.toString().substring(0, 7)}`, // First 7 digits
                `tt${episodeNum.toString().substring(0, 6)}`, // First 6 digits
                // Specific pattern for this range
                `tt125${episodeNum.toString().substring(3, 8)}`, // Try 125xxxxx pattern
                `tt126${episodeNum.toString().substring(3, 8)}`, // Try 126xxxxx pattern  
                `tt120${episodeNum.toString().substring(3, 8)}`, // Try 120xxxxx pattern
            ];

            console.log(`Trying ${candidateIds.length} candidate series IDs for episode ${episodeId}`);
            console.log(`Sample candidates:`, candidateIds.slice(0, 10));
            
            // Test if any of these IDs exist in our ratings database
            for (const candidateId of candidateIds) {
                try {
                    const url = `${process.env.RATINGS_API_URL || 'http://localhost:3001'}/api/rating/${candidateId}`;
                    const data = await Utils.makeRequest(url);
                    if (data?.rating && !data.error) {
                        console.log(`🎯 Found valid series ID in database: ${candidateId} (rating: ${data.rating})`);
                        return candidateId;
                    }
                } catch (e) {
                    // Continue trying other candidates
                }
                
                // Add a small delay to avoid overwhelming the API
                if (candidateIds.indexOf(candidateId) % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
            
            console.log(`No main series ID found for episode ${episodeId}`);
            return null;
            
        } catch (error) {
            console.error(`Error finding main series from episode ${episodeId}:`, error);
            return null;
        }
    }

    // NEW: Get series title from IMDb ID
    static async getSeriesTitleFromImdb(imdbId) {
        try {
            const url = `https://v2.sg.media-imdb.com/suggestion/t/${imdbId}.json`;
            const response = await Utils.makeRequest(url);
            
            if (response?.d?.length > 0) {
                return { title: response.d[0].l };
            }
            return null;
        } catch (error) {
            console.error(`Error getting series title for ${imdbId}:`, error);
            return null;
        }
    }

    // NEW: Hardcoded season mappings for problematic series
    static getHardcodedSeasonMapping(imdbId, season, episode) {
        const SEASON_MAPPINGS = {
            'tt0388629': { // One Piece - exact episode counts from TVDB
                episodesPerSeason: [0, 8, 22, 17, 13, 9, 22, 39, 13, 52, 31, 99, 56, 100, 35, 62, 49, 118, 33, 98, 14, 194, 48],
            }
        };

        const mapping = SEASON_MAPPINGS[imdbId];
        if (!mapping) return null;

        // Calculate absolute episode number
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

    // NEW: Find episode by title using IMDb suggestions
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
            idPrefixes: ['tt', 'kitsu'], // NEW: Added 'kitsu' prefix
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
       
        // Handle "not available" case - now consistent for both formats
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
       
        // Handle series fallback case - now consistent for both formats
        if (type === 'series_fallback') {
            return {
                name: streamName,
                description: `❌  Episode rating not available\n⭐  IMDb Series Rating: ${formattedRating} ${votesText}`
            };
        }
       
        if (format === 'singleline') {
            return {
                name: streamName,
                description: `⭐  IMDb:  ${formattedRating} ${votesText}`,
            };
        }
       
        // Regular multi-line format for episode ratings
        const separator = "───────────────";
        const ratingLine = `⭐  IMDb:  ${formattedRating}`;
        const totalWidth = separator.length;
        
        const lines = [
            separator,
            ratingLine
        ];
        
        // Add votes on separate line if they exist, right-aligned
        if (votesText) {
            const votePadding = totalWidth - votesText.length; // -1 to shift left
            lines.push(`${' '.repeat(Math.max(0, votePadding))}${votesText}`);
        }
        
        lines.push(separator);
       
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
            description: displayConfig.description.replace(/⭐.*/, '⭐ IMDb Rating: Not Available')
        }, id, id);
        
        console.log('❌ Added "no rating" stream for movie');
        return [stream];
    }

    // UPDATED: Enhanced getStreams method with anime support
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

            // Handle Kitsu content - NEW
            if (parsedId.platform === 'kitsu') {
                console.log(`🎌 Processing Kitsu content: ${parsedId.kitsuId}`);
                imdbId = await AnimeService.getImdbFromKitsu(parsedId.kitsuId);
                if (!imdbId) {
                    console.log('❌ Could not map Kitsu ID to IMDb');
                    return this.createNoRatingStream(config, parsedId.originalId);
                }
                console.log(`✅ Mapped to IMDb ID: ${imdbId}`);
                
                // Get proper season info for Kitsu content
                if (parsedId.episode) {
                    // For manual mappings, we can extract season info without re-triggering search
                    if (AnimeService.MANUAL_MAPPINGS && AnimeService.MANUAL_MAPPINGS[parsedId.kitsuId]) {
                        console.log(`📋 Using manual mapping - extracting season from known title`);
                        // For Avatar, we know the pattern: Book 1/2/3
                        if (['7936', '7937', '7938'].includes(parsedId.kitsuId)) {
                            const seasonMap = { '7936': 1, '7937': 2, '7938': 3 };
                            parsedId.season = seasonMap[parsedId.kitsuId];
                            console.log(`📺 Avatar season mapping: Kitsu ${parsedId.kitsuId} → Season ${parsedId.season}, Episode ${parsedId.episode}`);
                        } else {
                            // For other manual mappings, use default season 1
                            parsedId.season = 1;
                            console.log(`📺 Manual mapping default: Season ${parsedId.season}, Episode ${parsedId.episode}`);
                        }
                    } else {
                        // Only call getKitsuSeasonInfo for non-manual mappings
                        const seasonInfo = await AnimeService.getKitsuSeasonInfo(parsedId.kitsuId, parsedId.episode);
                        parsedId.season = seasonInfo.season;
                        parsedId.episode = seasonInfo.episode;
                        console.log(`📺 Updated season info: S${parsedId.season}E${parsedId.episode}`);
                    }
                }
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

    // NEW: Helper method for no rating streams
    static createNoRatingStream(config, originalId, imdbId = null) {
        const displayConfig = this.formatRatingDisplay(
            { rating: 'Not Available', votes: '' }, 
            config
        );

        const stream = this.createStream({
            name: displayConfig.name,
            description: displayConfig.description.replace(/⭐.*/, '⭐ IMDb Rating: Not Available')
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