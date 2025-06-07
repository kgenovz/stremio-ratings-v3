#!/bin/bash
# railway-deploy.sh - Deploy to Railway

echo "🚀 Deploying to Railway"
echo "======================"

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "📦 Installing Railway CLI..."
    npm install -g @railway/cli
fi

echo "🔐 Please login to Railway..."
railway login

echo "📝 Creating new Railway project..."
railway project new

echo "🔗 Linking current directory..."
railway link

echo "⚙️ Setting up services..."

# Deploy ratings API first
echo "📊 Deploying Ratings API..."
railway service create ratings-api
railway service link ratings-api

# Set environment variables for ratings API
railway variables set NODE_ENV=production
railway variables set PORT=3001

# Deploy the ratings API
railway up --service ratings-api

# Deploy Stremio addon
echo "🎬 Deploying Stremio Addon..."
railway service create stremio-addon  
railway service link stremio-addon

# Set environment variables for addon
railway variables set NODE_ENV=production
railway variables set PORT=3000
# Note: RATINGS_API_URL will be set automatically by Railway

# Deploy the addon
railway up --service stremio-addon

echo "✅ Deployment complete!"
echo ""
echo "🔗 Your services will be available at:"
echo "   Check 'railway status' for URLs"
echo ""
echo "⚠️  Note: Initial deployment takes 15-20 minutes due to data download"