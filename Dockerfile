# Single Dockerfile for Railway - Runs Both Services
FROM node:18-alpine

# Install curl and process manager
RUN apk add --no-cache curl

# Install PM2 globally for process management
RUN npm install -g pm2

# Set working directory
WORKDIR /app

# Copy all package.json files first for better caching
COPY imdb-ratings-api/package*.json ./api/
COPY stremio-ratings/package*.json ./addon/

# Install dependencies for both services
WORKDIR /app/api
RUN rm -f package-lock.json && npm install --only=production

WORKDIR /app/addon  
RUN rm -f package-lock.json && npm install --only=production

# Copy source code
WORKDIR /app
COPY imdb-ratings-api/ ./api/
COPY stremio-ratings/ ./addon/
COPY start-services.sh ./

# Create necessary directories
RUN mkdir -p api/data api/db

# Make start script executable
RUN chmod +x start-services.sh

# Set proper permissions
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Expose both ports
EXPOSE 3000 3001

# Health check for the addon (main service)
HEALTHCHECK --interval=60s --timeout=30s --start-period=300s --retries=5 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start both services with PM2
CMD ["./start-services.sh"]