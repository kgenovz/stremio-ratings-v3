#!/bin/sh
# start-services.sh - Starts both services with PM2

echo "🚀 Starting IMDb Ratings Services..."

# Kill any existing PM2 processes to avoid conflicts
pm2 kill

# Start the API service first (internal port 3001)
echo "📊 Starting Ratings API on port 3001..."
cd /app/api
pm2 start ratings-api-server.js --name "ratings-api" --no-daemon=false -- --port=3001

# Wait for API to be ready
echo "⏳ Waiting for API to be ready..."
sleep 15

# Start the Stremio addon with explicit port
echo "🎬 Starting Stremio Addon on port 3000..."
cd /app/addon

# Create a PM2 ecosystem file for better control
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'stremio-addon',
    script: 'index.js',
    env: {
      PORT: 3000,
      RATINGS_API_URL: 'http://localhost:3001',
      NODE_ENV: 'production'
    }
  }]
}
EOF

pm2 start ecosystem.config.js --no-daemon=false

# Wait a moment for addon to start
sleep 10

# Show status
echo "📋 Service Status:"
pm2 list

# Test internal connectivity with retries
echo "🔍 Testing internal connectivity..."
for i in 1 2 3 4 5; do
  if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ API ready on port 3001"
    break
  else
    echo "⏳ API not ready yet (attempt $i/5)..."
    sleep 5
  fi
done

for i in 1 2 3 4 5; do
  if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Addon ready on port 3000"
    break
  else
    echo "⏳ Addon not ready yet (attempt $i/5)..."
    sleep 5
  fi
done

echo "🌐 Railway should expose port 3000 (Stremio Addon)"
echo "📊 API accessible internally at localhost:3001"

# Keep container alive by following logs
echo "📝 Following service logs..."
pm2 logs