-- Migration: Add Discord pending invites
-- Date: 2026-02-14
-- Description: Adds table for tracking pending Discord invite codes linked to Telegram users

-- Discord pending invites (one-time invite codes)
CREATE TABLE IF NOT EXISTS discord_pending_invites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id BIGINT NOT NULL,
    invite_code VARCHAR(50) NOT NULL UNIQUE,
    invite_url TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    used_at TIMESTAMP,
    FOREIGN KEY (telegram_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX idx_pending_invites_telegram_id ON discord_pending_invites(telegram_id);
CREATE INDEX idx_pending_invites_code ON discord_pending_invites(invite_code);
CREATE INDEX idx_pending_invites_used ON discord_pending_invites(used);

COMMENT ON TABLE discord_pending_invites IS 'Pending Discord invite codes linked to Telegram users (max 1 use)';
COMMENT ON COLUMN discord_pending_invites.invite_code IS 'Unique Discord invite code';
COMMENT ON COLUMN discord_pending_invites.used IS 'Whether the invite has been used';
