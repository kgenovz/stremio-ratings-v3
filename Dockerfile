# Simplified Dockerfile for Railway - No PM2, just background + foreground processes
FROM node:18-alpine

# Install curl for healthchecks
RUN apk add --no-cache curl

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

# Expose ports
EXPOSE 8080 3001

# Health check for the main process (addon)
HEALTHCHECK --interval=60s --timeout=30s --start-period=300s --retries=5 \
  CMD curl -f http://localhost:8080/health || exit 1

# Start services (addon runs in foreground)
CMD ["./start-services.sh"]