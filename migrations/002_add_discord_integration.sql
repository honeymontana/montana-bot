-- Migration: Add Discord integration
-- Date: 2026-02-07
-- Description: Adds discord_links table for linking Telegram accounts with Discord accounts

-- Discord account links
CREATE TABLE IF NOT EXISTS discord_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id BIGINT NOT NULL UNIQUE,
    discord_id VARCHAR(255) NOT NULL UNIQUE,
    discord_username VARCHAR(255),
    discord_discriminator VARCHAR(10),
    discord_avatar VARCHAR(255),
    guild_id VARCHAR(255) NOT NULL,
    linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (telegram_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX idx_discord_links_telegram_id ON discord_links(telegram_id);
CREATE INDEX idx_discord_links_discord_id ON discord_links(discord_id);
CREATE INDEX idx_discord_links_guild_id ON discord_links(guild_id);

-- Add trigger for updated_at
CREATE TRIGGER update_discord_links_updated_at BEFORE UPDATE ON discord_links
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add Discord-related settings to bot_settings
INSERT INTO bot_settings (key, value, description)
VALUES
    ('discord_enabled', 'false', 'Enable Discord integration'),
    ('discord_sync_interval', '5', 'Minutes between Discord role sync'),
    ('discord_member_role_id', '', 'Discord role ID for Montana members')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE discord_links IS 'Links Telegram accounts with Discord accounts for access management';
COMMENT ON COLUMN discord_links.telegram_id IS 'Telegram user ID';
COMMENT ON COLUMN discord_links.discord_id IS 'Discord user ID (snowflake)';
COMMENT ON COLUMN discord_links.guild_id IS 'Discord guild/server ID where the user has access';
