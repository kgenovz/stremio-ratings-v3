# 🎬 IMDb Ratings for Stremio

A complete solution for displaying IMDb ratings in Stremio, consisting of a ratings API service and a Stremio addon that provides ratings for movies and TV show episodes with full anime support.

## 🚀 Quick Deploy (Render, etc.)

### Required Environment Variables
Set these in your hosting platform's environment variables section:

```bash
# REQUIRED - Get free API key from themoviedb.org
TMDB_API_KEY=your_tmdb_api_key_here

# OPTIONAL - Custom ports (platform will auto-assign if not set)
PORT=3000
```

**Note**: This is a single Docker Compose application that runs both the Stremio addon and ratings API together.

### Platform-Specific Setup

**Render**
1. Connect your GitHub repository
2. Create a new "Web Service" 
3. Set environment: `TMDB_API_KEY=your_key_here`
4. Render will automatically use `docker-compose.yml`
5. Access your addon at: `https://your-app.onrender.com`

**DigitalOcean App Platform**
1. Create new app from GitHub repository
2. Platform auto-detects Docker Compose
3. Set `TMDB_API_KEY` in environment variables
4. Both services run in one application

**Other Docker-compatible platforms**
- Any platform supporting Docker Compose will work
- Just set `TMDB_API_KEY` environment variable
- Platform handles the rest automatically

## 📋 Features

- **Complete IMDb Rating Database**: Downloads and processes the full IMDb ratings dataset
- **Movie & Episode Ratings**: Supports both movies and individual TV show episodes
- **Anime Support**: Advanced Kitsu→IMDb mapping with TMDB integration for anime content
- **MPAA Ratings**: Optional content rating display (G, PG, PG-13, R, etc.)
- **Optimized Storage**: Compressed database with intelligent filtering (only stores episodes that have ratings)
- **Advanced Caching**: Persistent API response caching with automatic cleanup
- **Configurable Display**: Customizable rating format, vote display, and layout options
- **Stremio Integration**: Easy-to-install Stremio addon with configuration interface
- **Docker Support**: Containerized for easy deployment

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐
│  Stremio Addon  │───▶│  Ratings API     │
│  (Port 3000)    │    │  (Port 3001)     │
└─────────────────┘    └──────────────────┘
        │                       │
        │                       ▼
        │               ┌──────────────────┐
        │               │   SQLite DB      │
        │               │  ~100-150MB      │
        └──────────────▶│  + Caching       │
                        │  + Mappings      │
                        └──────────────────┘
```

## 🐳 Docker Deployment (Recommended)

### Quick Start
```bash
# Clone the repository
git clone <your-repo-url>
cd imdb-ratings-stremio

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env

# Start both services
docker-compose up -d

# Check status
docker-compose ps
```

### Services
- **Stremio Addon**: http://localhost:3000
- **Ratings API**: http://localhost:3001
- **Configuration Page**: http://localhost:3000/configure

## ⚙️ Environment Variables

### Required Variables

Create a `.env` file in the project root:

```bash
# TMDB API Key (REQUIRED for anime support and MPAA ratings)
TMDB_API_KEY=your_tmdb_api_key_here

# Service URLs (adjust for your deployment)
RATINGS_API_URL=http://localhost:3001

# Optional: Custom ports
STREMIO_PORT=3000
API_PORT=3001

# Optional: Node environment
NODE_ENV=production
```

### Getting TMDB API Key

1. Create a free account at [TMDB](https://www.themoviedb.org/signup)
2. Go to Settings → API → Create API Key
3. Choose "Developer" and fill out the form
4. Copy your API key to the `.env` file

**Note**: Without a TMDB API key, anime mapping and MPAA ratings will be disabled, but basic IMDb ratings will still work.

### Environment Files by Service

#### Stremio Addon (.env)
```bash
RATINGS_API_URL=http://localhost:3001
PORT=3000
TMDB_API_KEY=your_key_here
```

#### Ratings API (.env)
```bash
PORT=3001
TMDB_API_KEY=your_key_here
NODE_ENV=production
```

## 🛠️ Manual Installation

### Prerequisites
- Node.js 18+ 
- ~500MB free disk space (for initial download)
- ~150MB for final optimized database
- TMDB API key (free, for anime support)

### Setup

1. **Clone and Install**
   ```bash
   git clone <your-repo-url>
   cd imdb-ratings-stremio
   
   # Create environment file
   cp .env.example .env
   # Edit .env with your TMDB API key
   
   # Install API dependencies
   cd imdb-ratings-api
   npm install
   
   # Install addon dependencies  
   cd ../stremio-ratings
   npm install
   ```

2. **Start the Ratings API**
   ```bash
   cd imdb-ratings-api
   npm start
   ```
   
   **First Run**: The API will automatically download and process IMDb datasets (~400MB download, 15-20 minutes)

3. **Start the Stremio Addon**
   ```bash
   cd stremio-ratings
   npm start
   ```

## 📱 Adding to Stremio

### Method 1: Configuration Page
1. Open http://localhost:3000/configure (or your deployed URL)
2. Customize your settings (vote display, format, MPAA ratings, etc.)
3. Click "Install in Stremio" for your preferred configuration

### Method 2: Manual Installation
1. Copy the manifest URL: `http://localhost:3000/manifest.json`
2. In Stremio, go to Add-ons → Install from URL
3. Paste the URL and click Install

## ⚙️ Configuration Options

The addon supports extensive customization:

```json
{
  "showVotes": true,              // Show vote counts
  "format": "multiline",          // "multiline" or "singleline"  
  "streamName": "IMDb Rating",    // Custom stream name
  "voteFormat": "comma",          // "comma" or "rounded" (1.2k, 1.5M)
  "ratingFormat": "withMax",      // "withMax" (8.5/10) or "simple" (8.5)
  "showLines": true,              // Show decorative lines
  "showSeriesRating": false,      // Show series rating alongside episode rating
  "showMpaaRating": false,        // Show MPAA content ratings (requires TMDB key)
  "enableForMovies": true         // Enable ratings for movies
}
```

### Example Configurations

**Minimal Display**
```
http://localhost:3000/c_showVotes-false_format-singleline_showLines-false/manifest.json
```

**Full Featured**  
```
http://localhost:3000/c_showSeriesRating-true_showMpaaRating-true_voteFormat-rounded/manifest.json
```

**Anime Focused**
```
http://localhost:3000/c_showSeriesRating-true_format-multiline/manifest.json
```

## 🎌 Anime Support

This addon includes advanced anime support with:

- **Kitsu Integration**: Direct support for `kitsu:anime123:45` format IDs
- **Smart Season Detection**: Automatically detects seasons from anime titles
- **TMDB Mapping**: Uses TMDB for accurate anime→IMDb mapping
- **Manual Mappings**: Hardcoded mappings for problematic series (Avatar, Attack on Titan, etc.)
- **Persistent Caching**: Stores successful mappings for future use

### Supported Anime ID Formats
- `kitsu:12345` - Anime movie/series
- `kitsu:12345:8` - Specific episode  
- `kitsu:anime12345:8` - Explicit anime type

## 📊 API Endpoints

### Ratings API (Port 3001)
- `GET /` - Service status and comprehensive information
- `GET /health` - Health check with database statistics
- `GET /api/rating/{imdb_id}` - Get movie/show rating
- `GET /api/episode/{series_id}/{season}/{episode}` - Get episode rating
- `GET /api/episode/id/{episode_id}` - Get rating by episode IMDb ID
- `GET /api/kitsu-mapping/{kitsu_id}` - Get Kitsu→IMDb mapping
- `POST /api/kitsu-mapping` - Store new Kitsu→IMDb mapping
- `GET /api/mpaa-rating/{imdb_id}` - Get MPAA content rating
- `POST /api/mpaa-rating` - Store MPAA content rating
- `GET /api/cache/{key}` - Get cached API response
- `POST /api/cache` - Store cached API response
- `GET /api/stats/cache` - Cache and mapping statistics
- `DELETE /api/cache/cleanup` - Clean expired cache entries

### Stremio Addon (Port 3000)
- `GET /` - Welcome page
- `GET /configure` - Interactive configuration interface
- `GET /manifest.json` - Default Stremio manifest
- `GET /c_{config}/manifest.json` - Configured manifest
- `GET /stream/{type}/{id}` - Stream data with ratings
- `GET /health` - Health check

## 🔧 Development

### Project Structure
```
imdb-ratings-stremio/
├── docker-compose.yml          # Multi-service Docker setup
├── .env.example               # Environment template
├── README.md                  # This file
├── imdb-ratings-api/          # Ratings API service
│   ├── Dockerfile
│   ├── package.json
│   ├── ratings-api-server.js  # Main API server with caching
│   └── .gitignore
└── stremio-ratings/           # Stremio addon
    ├── Dockerfile
    ├── package.json
    ├── index.js               # Enhanced addon server
    ├── config.html            # Interactive configuration page
    └── .gitignore
```

### Local Development
```bash
# Terminal 1 - Start API with hot reload
cd imdb-ratings-api && npm run dev

# Terminal 2 - Start Addon with hot reload
cd stremio-ratings && npm run dev
```

### Testing Anime Support
```bash
# Test Kitsu mapping
curl http://localhost:3001/api/kitsu-mapping/7936

# Test anime episode rating
curl http://localhost:3000/stream/series/kitsu:7936:5

# Check TMDB functionality
curl "http://localhost:3001/api/rating/tt0417299"
```

## 🐛 Troubleshooting

### Common Issues

**TMDB API not working**
- Verify your TMDB API key is correct in `.env`
- Check API key permissions (should have read access)
- Anime mapping will fallback to IMDb search without TMDB

**Database not loading**
- Check disk space (~500MB needed)
- Verify internet connection for IMDb dataset download
- Check logs: `docker-compose logs ratings-api`

**Addon not connecting to API**
- Verify both services are running
- Check `RATINGS_API_URL` environment variable
- Ensure ports 3000 and 3001 are available

**Anime not working**
- Verify TMDB API key is configured
- Check addon logs for mapping attempts
- Some anime may require manual mappings

**MPAA ratings not showing**
- Ensure `showMpaaRating` is enabled in config
- Verify TMDB API key is working
- MPAA ratings are US-only and may not exist for all content

### Health Checks
```bash
# Check API health
curl http://localhost:3001/health

# Check addon health  
curl http://localhost:3000/health

# Test rating lookup
curl http://localhost:3001/api/rating/tt0111161

# Check cache statistics
curl http://localhost:3001/api/stats/cache
```

### Debug Mode
Set environment variable for verbose logging:
```bash
NODE_ENV=development
```

## 📈 Performance & Optimization

### Database Optimizations
- **Compressed IMDb IDs**: Integer storage instead of text (3x smaller)
- **Filtered Episodes**: Only stores episodes with ratings (~30% of total)
- **Optimized Indexes**: Fast lookups for common queries
- **Batch Processing**: Efficient data loading with transactions
- **Persistent Caching**: API responses cached to reduce external calls
- **Intelligent Mapping**: Stores successful anime mappings permanently

### Expected Performance
- **Database Size**: ~100-150MB (optimized from ~400MB source)
- **Memory Usage**: ~50-100MB per service
- **Response Time**: <50ms for rating lookups, <200ms for anime mapping
- **Storage Efficiency**: 30% of episode data stored (only rated episodes)
- **Cache Hit Rate**: >90% for repeated anime queries

### Cache Management
- **Automatic Cleanup**: Expired entries removed every 6 hours
- **TTL**: 1 hour for API responses, permanent for mappings
- **Manual Cleanup**: `curl -X DELETE http://localhost:3001/api/cache/cleanup`

## 🔄 Data Updates

### Automatic Updates
The ratings API automatically updates daily at 2 AM with fresh IMDb data.

### Manual Updates
```bash
# Docker
docker-compose restart ratings-api

# Manual
cd imdb-ratings-api
rm ratings.db  # Remove old database
npm start      # Will re-download data
```

### Cache Maintenance
```bash
# Check cache statistics
curl http://localhost:3001/api/stats/cache

# Force cache cleanup
curl -X DELETE http://localhost:3001/api/cache/cleanup
```

## 🚀 Deployment

### Docker Production
```bash
# Production build
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# With custom domain
DOMAIN=your-domain.com docker-compose up -d
```

### VPS Deployment
```bash
# Install dependencies
sudo apt update && sudo apt install nodejs npm docker.io docker-compose

# Clone and setup
git clone <your-repo-url>
cd imdb-ratings-stremio
cp .env.example .env
# Edit .env with your settings

# Start services
docker-compose up -d

# Setup reverse proxy (nginx/caddy)
# Point your domain to port 3000
```

### Environment-Specific Configs

**Development**
```bash
NODE_ENV=development
RATINGS_API_URL=http://localhost:3001
```

**Production**
```bash
NODE_ENV=production  
RATINGS_API_URL=https://your-api-domain.com
```

**Docker Internal**
```bash
RATINGS_API_URL=http://ratings-api:3001
```


## 💡 Support

- **Issues**: Use GitHub Issues for bug reports and feature requests
- **Anime Issues**: Include Kitsu ID and expected IMDb ID for mapping problems
- **Configuration Help**: Use the `/configure` page for easy setup
- **Performance Issues**: Check `/health` endpoints for diagnostics
