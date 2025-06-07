#!/bin/bash
# dev.sh - Development setup

echo "🛠️ Starting development environment"
echo "==================================="

# Install dependencies
echo "📦 Installing dependencies..."

echo "   Installing API dependencies..."
cd imdb-ratings-api
npm install
cd ..

echo "   Installing addon dependencies..."
cd stremio-ratings  
npm install
cd ..

echo "✅ Dependencies installed"

# Start development servers
echo "🚀 Starting development servers..."
echo "   Press Ctrl+C to stop all services"

# Function to handle cleanup
cleanup() {
    echo "🛑 Stopping development servers..."
    kill $API_PID $ADDON_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start API server
cd imdb-ratings-api
npm run dev &
API_PID=$!
cd ..

# Wait a bit for API to start
sleep 5

# Start addon server
cd stremio-ratings
RATINGS_API_URL=http://localhost:3001 npm run dev &
ADDON_PID=$!
cd ..

echo "✅ Development servers started!"
echo ""
echo "📊 Service URLs:"
echo "   Stremio Addon: http://localhost:3000"
echo "   Configuration: http://localhost:3000/configure"  
echo "   Ratings API:   http://localhost:3001"
echo "   API Status:    http://localhost:3001/health"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for background processes
wait