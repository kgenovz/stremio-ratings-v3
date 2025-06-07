#!/bin/bash
# setup.sh - Quick setup script

echo "🎬 Setting up IMDb Ratings for Stremio"
echo "======================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose found"

# Create necessary directories
echo "📁 Creating project structure..."
mkdir -p imdb-ratings-api
mkdir -p stremio-ratings

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ docker-compose.yml not found. Make sure you're in the project root."
    exit 1
fi

echo "🚀 Starting services with Docker Compose..."
docker-compose up -d

echo "⏳ Waiting for services to start..."
sleep 10

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    echo "✅ Services are starting up!"
    echo ""
    echo "📊 Service URLs:"
    echo "   Stremio Addon: http://localhost:3000"
    echo "   Configuration: http://localhost:3000/configure"
    echo "   Ratings API:   http://localhost:3001"
    echo "   API Status:    http://localhost:3001/health"
    echo ""
    echo "⚠️  Note: The first run will download ~400MB of IMDb data."
    echo "   This process takes 15-20 minutes. You can monitor progress with:"
    echo "   docker-compose logs -f ratings-api"
    echo ""
    echo "🎯 To add to Stremio:"
    echo "   1. Open http://localhost:3000/configure"
    echo "   2. Click 'Install in Stremio'"
    echo "   3. Or manually add: http://localhost:3000/manifest.json"
else
    echo "❌ Services failed to start. Check logs:"
    echo "   docker-compose logs"
fi