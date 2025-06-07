.PHONY: help setup dev build start stop clean logs test deploy

help:
	@echo "🎬 IMDb Ratings for Stremio - Commands"
	@echo "======================================"
	@echo ""
	@echo "Setup Commands:"
	@echo "  make setup     - Quick setup with Docker Compose"
	@echo "  make dev       - Start development environment" 
	@echo ""
	@echo "Docker Commands:"
	@echo "  make build     - Build Docker images"
	@echo "  make start     - Start services"
	@echo "  make stop      - Stop services"
	@echo "  make restart   - Restart services"
	@echo "  make logs      - View logs"
	@echo "  make clean     - Clean up containers and volumes"
	@echo ""
	@echo "Deployment:"
	@echo "  make deploy    - Deploy to Railway"
	@echo ""
	@echo "Testing:"
	@echo "  make test      - Run health checks"

setup:
	@echo "🚀 Setting up with Docker Compose..."
	./setup.sh

dev:
	@echo "🛠️ Starting development environment..."
	./dev.sh

build:
	@echo "🔨 Building Docker images..."
	docker-compose build

start:
	@echo "▶️ Starting services..."
	docker-compose up -d

stop:
	@echo "⏹️ Stopping services..."
	docker-compose down

restart: stop start

logs:
	@echo "📋 Viewing logs..."
	docker-compose logs -f

clean:
	@echo "🧹 Cleaning up..."
	docker-compose down -v
	docker system prune -f

test:
	@echo "🔍 Running health checks..."
	@curl -f http://localhost:3001/health && echo "✅ API healthy"
	@curl -f http://localhost:3000/health && echo "✅ Addon healthy"

deploy:
	@echo "🚀 Deploying to Railway..."
	./railway-deploy.sh