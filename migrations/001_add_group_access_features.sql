-- Migration: Add access control features to groups table
-- Date: 2026-01-15
-- Description: Adds is_permanent and access_duration_hours columns for time-limited group access

-- Add is_permanent column if it doesn't exist
ALTER TABLE groups
ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN DEFAULT FALSE;

-- Add access_duration_hours column if it doesn't exist
ALTER TABLE groups
ADD COLUMN IF NOT EXISTS access_duration_hours INTEGER DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN groups.is_permanent IS 'If true, users are never removed from this group even if they leave the main group';
COMMENT ON COLUMN groups.access_duration_hours IS 'Number of hours from group creation during which join requests are accepted. NULL means no time limit';
