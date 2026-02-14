-- Migration: Add Discord change limit
-- Date: 2026-02-13
-- Description: Adds last_discord_change field to limit nickname changes to once per month

-- Add last_discord_change column to discord_links table
ALTER TABLE discord_links
ADD COLUMN IF NOT EXISTS last_discord_change TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

COMMENT ON COLUMN discord_links.last_discord_change IS 'Timestamp of last Discord nickname change (limited to once per month)';
