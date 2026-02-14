#!/bin/bash
# Wrapper script to start Montana Bot with clean environment

# Unset any shell environment variables that might override .env
unset DISCORD_BOT_TOKEN
unset BOT_TOKEN
unset DISCORD_ENABLED
unset DISCORD_CLIENT_ID
unset DISCORD_CLIENT_SECRET
unset DISCORD_GUILD_ID

echo "🧹 Cleared old environment variables"
echo "▶️  Starting Montana Helper Bot..."
echo ""

# Start the bot
npm run dev
