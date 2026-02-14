#!/bin/bash

# Montana Bot - Quick Update Script
# Usage: ./update.sh [commit message]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SERVER_USER="root"
SERVER_HOST="104.248.139.159"
SERVER_PATH="/var/www/montana-bot"

echo -e "${BLUE}🚀 Montana Bot Quick Update${NC}"
echo ""

# Get commit message from argument or prompt
if [ -z "$1" ]; then
    echo -e "${YELLOW}Enter commit message:${NC}"
    read -r COMMIT_MSG
else
    COMMIT_MSG="$1"
fi

if [ -z "$COMMIT_MSG" ]; then
    echo -e "${RED}❌ Commit message required${NC}"
    exit 1
fi

# Check git status
echo -e "${BLUE}📝 Checking git status...${NC}"
if [ -z "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️  No changes to commit${NC}"
    echo ""
    read -p "Continue with deployment anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Deployment cancelled${NC}"
        exit 1
    fi
else
    # Commit and push changes
    echo -e "${BLUE}💾 Committing changes...${NC}"
    git add .
    git commit -m "$COMMIT_MSG"

    echo -e "${BLUE}📤 Pushing to GitHub...${NC}"
    git push origin main
    echo -e "${GREEN}✅ Changes pushed to GitHub${NC}"
fi

echo ""

# Deploy to server
echo -e "${BLUE}🌐 Deploying to server...${NC}"
echo ""

ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_HOST} "$(cat <<REMOTE_SCRIPT
set -e
cd ${SERVER_PATH}

echo "📥 Pulling latest changes..."
git pull origin main

echo "📦 Installing dependencies..."
npm install --production=false

echo "🔨 Building TypeScript..."
npm run build

echo "🗄️  Applying database migrations..."
source .env
for file in migrations/*.sql; do
    echo "  - Applying \$file..."
    PGPASSWORD="\${DB_PASSWORD}" psql -h "\${DB_HOST}" -p "\${DB_PORT}" -U "\${DB_USER}" -d "\${DB_NAME}" -f "\$file" 2>&1 || true
done

echo "🔄 Restarting PM2..."
pm2 restart montana-bot-prod

echo ""
echo "✅ Deployment complete!"
echo ""

pm2 status
REMOTE_SCRIPT
)"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║    ✅ Update Successful! 🚀            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📋 View logs:${NC}"
echo -e "  ${GREEN}ssh ${SERVER_USER}@${SERVER_HOST} 'cd ${SERVER_PATH} && pm2 logs montana-bot-prod'${NC}"
echo ""
