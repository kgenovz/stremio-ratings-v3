#!/bin/sh
# start-services.sh - Starts both services with PM2

echo "🚀 Starting IMDb Ratings Services..."

# Start the API service first
echo "📊 Starting Ratings API..."
cd /app/api
pm2 start ratings-api-server.js --name "ratings-api" --no-daemon=false

# Wait a moment for API to start
sleep 5

# Start the Stremio addon
echo "🎬 Starting Stremio Addon..."
cd /app/addon
export RATINGS_API_URL=http://localhost:3001
pm2 start index.js --name "stremio-addon" --no-daemon=false

# Show status
pm2 list

# Keep container alive by following logs
echo "✅ Both services started! Following logs..."
pm2 logs