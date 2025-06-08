#!/bin/sh
# start-services.sh - Simplified: Start API in background, addon in foreground

echo "🚀 Starting IMDb Ratings Services..."

# Start API in background
echo "📊 Starting Ratings API on port 3001..."
cd /app/api
PORT=3001 node ratings-api-server.js &
API_PID=$!

# Wait for API to be ready
echo "⏳ Waiting for API to be ready..."
sleep 20

# Test API readiness
for i in 1 2 3 4 5; do
  if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ API ready on port 3001"
    break
  else
    echo "⏳ API not ready yet (attempt $i/5)..."
    sleep 10
  fi
done

# Start addon in foreground (main process for Railway)
echo "🎬 Starting Stremio Addon on port 8080..."
cd /app/addon
export PORT=8080
export RATINGS_API_URL=http://localhost:3001
export NODE_ENV=production

# Function to cleanup on exit
cleanup() {
    echo "🛑 Shutting down services..."
    kill $API_PID 2>/dev/null
    exit 0
}

# Set trap for cleanup
trap cleanup SIGTERM SIGINT

echo "🌐 Addon will be available on port 8080"
echo "📊 API running in background on port 3001"

# Run addon in foreground (Railway monitors this process)
exec node index.js