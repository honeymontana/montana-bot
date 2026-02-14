#!/bin/bash

# Montana Bot - Server Setup & Deploy Script
# Server: root@104.248.139.159

set -e

SERVER_USER="root"
SERVER_HOST="104.248.139.159"
SERVER_PATH="/var/www/montana-bot"
REPO_URL="https://github.com/honeymontana/montana-bot.git"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Montana Bot - Server Setup & Deploy  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Function to run commands on server
run_on_server() {
    ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_HOST} "$1"
}

# Check SSH connection
echo -e "${YELLOW}🔑 Checking SSH connection...${NC}"
if ! ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_HOST} 'exit' 2>/dev/null; then
    echo -e "${RED}❌ Cannot connect to server${NC}"
    echo ""
    echo "Please ensure:"
    echo "1. Your SSH key is added to the server"
    echo "2. Or run this command first:"
    echo "   ssh-copy-id ${SERVER_USER}@${SERVER_HOST}"
    exit 1
fi
echo -e "${GREEN}✅ SSH connection successful${NC}"
echo ""

# Setup server environment
echo -e "${BLUE}📦 Setting up server environment...${NC}"

run_on_server "$(cat <<'REMOTE_SCRIPT'
set -e

# Update system
echo "Updating system packages..."
apt-get update -qq

# Install Node.js 20.x if not installed
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# Install PM2 globally if not installed
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Install PostgreSQL client if not installed
if ! command -v psql &> /dev/null; then
    echo "Installing PostgreSQL client..."
    apt-get install -y postgresql-client
fi

# Install git if not installed
if ! command -v git &> /dev/null; then
    echo "Installing git..."
    apt-get install -y git
fi

echo ""
echo "✅ Environment setup complete"
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"
echo "PM2 version: $(pm2 -v)"
REMOTE_SCRIPT
)"

echo -e "${GREEN}✅ Server environment ready${NC}"
echo ""

# Clone or update repository
echo -e "${BLUE}📥 Deploying code to server...${NC}"

run_on_server "$(cat <<REMOTE_SCRIPT
set -e

# Create directory if doesn't exist
mkdir -p ${SERVER_PATH}
cd ${SERVER_PATH}

# Clone or pull repository
if [ -d ".git" ]; then
    echo "Repository exists, pulling latest changes..."
    git pull origin main
else
    echo "Cloning repository..."
    git clone ${REPO_URL} .
fi

echo "✅ Code deployed"
REMOTE_SCRIPT
)"

echo -e "${GREEN}✅ Code deployed to server${NC}"
echo ""

# Setup .env file
echo -e "${YELLOW}⚙️  .env file configuration${NC}"
echo ""
echo "The .env file needs to be created on the server with your credentials."
echo ""
echo "Options:"
echo "  1. Copy from local .env"
echo "  2. Create manually on server"
echo "  3. Skip (I'll do it later)"
echo ""
read -p "Choose option (1/2/3): " ENV_OPTION

case $ENV_OPTION in
    1)
        if [ -f .env ]; then
            echo "Copying local .env to server..."
            scp .env ${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/.env
            echo -e "${GREEN}✅ .env copied${NC}"
        else
            echo -e "${RED}❌ Local .env file not found${NC}"
            exit 1
        fi
        ;;
    2)
        echo ""
        echo "Run this command to edit .env on server:"
        echo -e "${BLUE}ssh ${SERVER_USER}@${SERVER_HOST} 'cd ${SERVER_PATH} && nano .env'${NC}"
        echo ""
        read -p "Press Enter when ready to continue..."
        ;;
    3)
        echo -e "${YELLOW}⚠️  Remember to create .env file before starting the bot${NC}"
        ;;
esac

echo ""

# Install dependencies and build
echo -e "${BLUE}🔨 Installing dependencies and building...${NC}"

run_on_server "$(cat <<REMOTE_SCRIPT
set -e
cd ${SERVER_PATH}

echo "Installing dependencies..."
npm install --production=false

echo "Building TypeScript..."
npm run build

echo "✅ Build complete"
REMOTE_SCRIPT
)"

echo -e "${GREEN}✅ Dependencies installed and built${NC}"
echo ""

# Start with PM2
echo -e "${BLUE}▶️  Starting bot with PM2...${NC}"

run_on_server "$(cat <<REMOTE_SCRIPT
set -e
cd ${SERVER_PATH}

# Stop if already running
pm2 stop montana-bot-prod 2>/dev/null || true
pm2 delete montana-bot-prod 2>/dev/null || true

# Start with PM2
pm2 start ecosystem.config.js --only montana-bot-prod

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup systemd -u ${SERVER_USER} --hp /root || true

echo ""
echo "✅ Bot started with PM2"
pm2 status
REMOTE_SCRIPT
)"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║    ✅ Deployment Successful! 🚀        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📋 Useful commands:${NC}"
echo ""
echo "  View logs:"
echo -e "    ${GREEN}ssh ${SERVER_USER}@${SERVER_HOST} 'cd ${SERVER_PATH} && pm2 logs montana-bot-prod'${NC}"
echo ""
echo "  Check status:"
echo -e "    ${GREEN}ssh ${SERVER_USER}@${SERVER_HOST} 'pm2 status'${NC}"
echo ""
echo "  Restart bot:"
echo -e "    ${GREEN}ssh ${SERVER_USER}@${SERVER_HOST} 'cd ${SERVER_PATH} && pm2 restart montana-bot-prod'${NC}"
echo ""
echo "  Monitor:"
echo -e "    ${GREEN}ssh ${SERVER_USER}@${SERVER_HOST} 'pm2 monit'${NC}"
echo ""
echo "  SSH to server:"
echo -e "    ${GREEN}ssh ${SERVER_USER}@${SERVER_HOST}${NC}"
echo ""
