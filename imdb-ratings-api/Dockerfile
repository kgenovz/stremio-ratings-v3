# Simplified Dockerfile for IMDb Ratings API (using better-sqlite3)
FROM node:18-alpine

# Install curl for healthchecks
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Remove old lock file and install fresh dependencies
RUN rm -f package-lock.json && npm install --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p data db

# Set proper permissions
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=60s --timeout=30s --start-period=180s --retries=5 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start the application
CMD ["node", "ratings-api-server.js"]