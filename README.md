# 🎬 IMDb Ratings for Stremio

A complete solution for displaying IMDb ratings in Stremio, consisting of a ratings API service and a Stremio addon that provides ratings for movies and TV show episodes.

## 🚀 Quick Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/your-template-id)

## 📋 Features

- **Complete IMDb Rating Database**: Downloads and processes the full IMDb ratings dataset
- **Movie & Episode Ratings**: Supports both movies and individual TV show episodes
- **Optimized Storage**: Compressed database with intelligent filtering (only stores episodes that have ratings)
- **Stremio Integration**: Easy-to-install Stremio addon
- **Docker Support**: Containerized for easy deployment
- **Railway Ready**: One-click deployment to Railway cloud platform

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
        └──────────────▶│  Optimized       │
                        └──────────────────┘
```

## 🐳 Docker Deployment (Recommended)

### Quick Start
```bash
# Clone the repository
git clone <your-repo-url>
cd imdb-ratings-stremio

# Start both services
docker-compose up -d

# Check status
docker-compose ps
```

### Services
- **Stremio Addon**: http://localhost:3000
- **Ratings API**: http://localhost:3001
- **Configuration Page**: http://localhost:3000/configure

## ☁️ Railway Deployment

### Option 1: One-Click Deploy
1. Click the "Deploy on Railway" button above
2. Connect your GitHub account
3. Wait for deployment (15-20 minutes for initial data download)
4. Access your addon at the provided Railway URL

### Option 2: Manual Deploy
1. Fork this repository
2. Create a new Railway project
3. Connect your GitHub repository
4. Railway will automatically detect and deploy both services

### Railway Configuration
The project includes Railway-specific configuration:
- `railway.json`: Multi-service deployment configuration
- Health checks and proper startup commands
- Environment variable management

## 🛠️ Manual Installation

### Prerequisites
- Node.js 18+ 
- ~500MB free disk space (for initial download)
- ~150MB for final optimized database

### Setup

1. **Clone and Install**
   ```bash
   git clone <your-repo-url>
   cd imdb-ratings-stremio
   
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
1. Open http://localhost:3000/configure (or your Railway URL)
2. Click "Install in Stremio"

### Method 2: Manual Installation
1. Copy the manifest URL: `http://localhost:3000/manifest.json`
2. In Stremio, go to Add-ons → Install from URL
3. Paste the URL and click Install

## ⚙️ Configuration Options

The addon supports customization via URL parameters:

```json
{
  "showVotes": true,           // Show vote counts
  "format": "multiline",       // "multiline" or "singleline"
  "streamName": "IMDb Rating"  // Custom stream name
}
```

### Example URLs
- Default: `http://localhost:3000/manifest.json`
- Hide votes: `http://localhost:3000/manifest.json?config={"showVotes":false}`
- Single line: `http://localhost:3000/manifest.json?config={"format":"singleline"}`

## 📊 API Endpoints

### Ratings API (Port 3001)
- `GET /` - Service status and information
- `GET /health` - Health check
- `GET /api/rating/{imdb_id}` - Get movie/show rating
- `GET /api/episode/{series_id}/{season}/{episode}` - Get episode rating

### Stremio Addon (Port 3000)
- `GET /` - Welcome page
- `GET /configure` - Configuration interface
- `GET /manifest.json` - Stremio manifest
- `GET /stream/{type}/{id}` - Stream data with ratings
- `GET /health` - Health check

## 🔧 Development

### Project Structure
```
imdb-ratings-stremio/
├── docker-compose.yml          # Multi-service Docker setup
├── railway.json               # Railway deployment config
├── README.md                  # This file
├── imdb-ratings-api/          # Ratings API service
│   ├── Dockerfile
│   ├── package.json
│   ├── ratings-api-server.js  # Main API server
│   └── .gitignore
└── stremio-ratings/           # Stremio addon
    ├── Dockerfile
    ├── package.json
    ├── index.js               # Addon server
    ├── config.html            # Configuration page
    └── .gitignore
```

### Environment Variables

#### Ratings API
- `PORT`: Server port (default: 3001)
- `NODE_ENV`: Environment mode

#### Stremio Addon  
- `PORT`: Server port (default: 3000)
- `RATINGS_API_URL`: API service URL (default: http://localhost:3001)
- `NODE_ENV`: Environment mode

### Local Development
```bash
# Terminal 1 - Start API
cd imdb-ratings-api && npm run dev

# Terminal 2 - Start Addon
cd stremio-ratings && npm run dev
```

## 🐛 Troubleshooting

### Common Issues

**Database not loading**
- Check disk space (~500MB needed)
- Verify internet connection for IMDb dataset download
- Check logs: `docker-compose logs ratings-api`

**Addon not connecting to API**
- Verify both services are running
- Check `RATINGS_API_URL` environment variable
- Ensure ports 3000 and 3001 are available

**Railway deployment timeout**
- Railway free plan has build time limits
- The initial data download takes 15-20 minutes
- Consider upgrading to Railway Pro for longer build times

### Health Checks
```bash
# Check API health
curl http://localhost:3001/health

# Check addon health  
curl http://localhost:3000/health

# Test rating lookup
curl http://localhost:3001/api/rating/tt0111161
```

## 📈 Performance & Optimization

### Database Optimizations
- **Compressed IMDb IDs**: Integer storage instead of text
- **Filtered Episodes**: Only stores episodes with ratings (~30% of total)
- **Optimized Indexes**: Fast lookups for common queries
- **Batch Processing**: Efficient data loading with transactions

### Expected Performance
- **Database Size**: ~100-150MB (optimized from ~400MB source)
- **Memory Usage**: ~50-100MB per service
- **Response Time**: <50ms for rating lookups
- **Storage Efficiency**: 30% of episode data stored (only rated episodes)

## 🔄 Data Updates

The ratings API automatically updates daily at 2 AM with fresh IMDb data. For manual updates:

```bash
# Docker
docker-compose restart ratings-api

# Manual
cd imdb-ratings-api
rm ratings.db  # Remove old database
npm start      # Will re-download data
```

## 📄 License

MIT License - feel free to modify and distribute.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes  
4. Test with Docker Compose
5. Submit a pull request

## 💡 Support

- **Issues**: Use GitHub Issues for bug reports
- **Features**: Create feature requests in Issues
- **Discord**: Join the Stremio community
- **Railway**: Check Railway documentation for deployment issues

