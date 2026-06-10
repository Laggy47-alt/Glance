# Self-Hosted Supabase DB Migration Guide

This guide covers how to push database migrations to a self-hosted Supabase instance running in Docker.

## Prerequisites

- Docker running with Supabase containers (`supabase-db`, `supabase-pooler`)
- SQL migration files located in `supabase/migrations/`
- The Postgres password (check your `.env` file or Docker config)

## The Problem

Supavisor (the connection pooler) listens on port `5432` and requires a tenant identifier. You cannot connect to port `5432` directly using `psql` because of the `ENOIDENTIFIER` error:

```
FATAL: (ENOIDENTIFIER) no tenant identifier provided
```

## The Solution

Bypass the pooler and connect directly to the `supabase-db` container using `docker exec`.

## Applying Migrations

### Option 1: Apply all migrations in order

Run from inside the project directory:

```bash
cd supabase/migrations
for f in $(ls *.sql | sort); do
  echo "Applying $f..."
  docker exec -i supabase-db psql -U postgres -d postgres < "$f" || break
done
```

The `|| break` stops on the first error so you can review it. If you want to skip over errors (e.g., "already exists" from a partially applied migration), remove `|| break`.

### Option 2: Apply a single migration

```bash
docker exec -i supabase-db psql -U postgres -d postgres < supabase/migrations/YOUR_MIGRATION_FILE.sql
```

### Option 3: Direct Docker exec from anywhere

If your migrations live at `/srv/abc-glance/Glance/supabase/migrations/`:

```bash
for f in $(ls /srv/abc-glance/Glance/supabase/migrations/*.sql | sort); do
  echo "Applying $f..."
  docker exec -i supabase-db psql -U postgres -d postgres < "$f" || break
done
```

## Verifying the Connection

Check which Supabase containers are running:

```bash
docker ps | grep -E "supabase-db|supabase-pooler"
```

You should see:
- `supabase-pooler` — maps ports `5432` and `6543` to the host
- `supabase-db` — exposes Postgres on port `5432` **only inside the Docker network**

Because `supabase-db` is not published to the host, `docker exec` is the most reliable way to run `psql`.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `FATAL: password authentication failed` | Ensure `-U postgres` is correct; set the password via `PGPASSWORD` env var or check your `.env` |
| `relation ... already exists` | Migration was already applied — safe to ignore if skipping ahead |
| Container not found | Use `docker ps` to confirm the exact container name; it may be `supabase-db-1` in some compose setups |

## One-Liner for New Servers

If you are setting up a fresh self-hosted instance and want to copy migration files into the Postgres init directory (runs **once** on first start):

```bash
# Copy only .sql files, not the entire supabase/ folder
cp supabase/migrations/*.sql /path/to/supabase/volumes/db/init/
```

This only works before the database is initialized for the first time. For an already-running database, use `docker exec` with `psql` instead.
