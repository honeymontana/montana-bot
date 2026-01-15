# Database Migrations

This directory contains SQL migration files for updating the Montana Bot database schema.

## Migration Files

- `001_add_group_access_features.sql` - Adds `is_permanent` and `access_duration_hours` columns to groups table

## How to Apply Migrations

### For Docker deployments:

```bash
# Apply a specific migration
docker-compose exec postgres psql -U montana montana_bot -f /migrations/001_add_group_access_features.sql

# Or connect to the database and run manually
docker-compose exec postgres psql -U montana montana_bot
```

### For local deployments:

```bash
# Apply a specific migration
psql -U montana -d montana_bot -f migrations/001_add_group_access_features.sql
```

## Migration Naming Convention

Migrations are named with a sequential number prefix:
- `001_description.sql`
- `002_description.sql`
- etc.

## Important Notes

- Migrations use `ADD COLUMN IF NOT EXISTS` to be idempotent (safe to run multiple times)
- Always backup your database before running migrations
- Migrations should be run in sequential order
- For new deployments, use `init-db.sql` which already includes all schema changes
