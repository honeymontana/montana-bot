#!/bin/bash

# Montana Bot Deployment Script
# Usage: ./deploy.sh [dev|staging|prod]

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Environment (default: dev)
ENV=${1:-dev}

echo -e "${BLUE}🚀 Montana Bot Deployment Script${NC}"
echo -e "${BLUE}Environment: ${ENV}${NC}"
echo ""

# Validate environment
if [[ ! "$ENV" =~ ^(dev|staging|prod)$ ]]; then
  echo -e "${RED}❌ Invalid environment: $ENV${NC}"
  echo "Usage: ./deploy.sh [dev|staging|prod]"
  exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
  echo -e "${RED}❌ .env file not found${NC}"
  echo "Please create .env file with required variables"
  exit 1
fi

# Check for uncommitted changes (only for production)
if [ "$ENV" = "prod" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes${NC}"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo -e "${RED}Deployment cancelled${NC}"
      exit 1
    fi
  fi
fi

# Stop current PM2 process if running
echo -e "${YELLOW}🛑 Stopping current instance...${NC}"
npm run pm2:stop:${ENV} 2>/dev/null || echo "No running instance found"

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm install

# Run database migrations
echo -e "${BLUE}🗄️  Running database migrations...${NC}"
npm run migration:run

# Build the project
echo -e "${BLUE}🔨 Building project...${NC}"
npm run build

# Run tests (skip for dev environment)
if [ "$ENV" != "dev" ]; then
  echo -e "${BLUE}🧪 Running tests...${NC}"
  npm test
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Start with PM2
echo -e "${GREEN}▶️  Starting bot with PM2...${NC}"
npm run pm2:${ENV}

# Wait a bit for the process to start
sleep 2

# Check PM2 status
echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
npm run pm2:status

echo ""
echo -e "${BLUE}📋 Useful commands:${NC}"
echo -e "  View logs:      ${GREEN}npm run pm2:logs:${ENV}${NC}"
echo -e "  Monitor:        ${GREEN}npm run pm2:monit${NC}"
echo -e "  Restart:        ${GREEN}npm run pm2:restart:${ENV}${NC}"
echo -e "  Stop:           ${GREEN}npm run pm2:stop:${ENV}${NC}"
echo ""
echo -e "${BLUE}📂 Log files:${NC}"
echo -e "  PM2 logs:       ${GREEN}./logs/pm2-${ENV}-*.log${NC}"
echo -e "  App errors:     ${GREEN}./logs/error.log${NC}"
echo -e "  App combined:   ${GREEN}./logs/combined.log${NC}"
