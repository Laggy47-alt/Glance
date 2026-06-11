# ABC Glance — Self-Hosted Docker Supabase Command Reference

> **Target environment**: Self-hosted Supabase (Docker Compose) at `/srv/supabase/` + React frontend at `/srv/abc-glance/`.
> This file is a quick-reference cheat sheet. For the full cloud-hosted guide, see `SELF_HOSTING.md`.

---

## Chat Continuation Reference (for AI)

**PROJECT CONTEXT:** ABC Glance running on self-hosted Docker Supabase (`/srv/supabase/`) with frontend at `/srv/abc-glance/`. Database is Postgres inside `supabase-db` container. Edge functions run in `supabase-edge-functions` container. Last work was on per-NVR WhatsApp daily broadcast reports (`daily-offline-broadcast` edge function + `daily_broadcast_enabled` toggle on `frigate_instances`).

---

## 1. Frontend Build

Run from `/srv/abc-glance/` (or wherever the frontend repo lives):

```bash
cd /srv/abc-glance

# Install dependencies
bun install

# Dev server
bun run dev

# Production build (outputs to ./dist)
bun run build
```

Serve `./dist` via NGINX (see `SELF_HOSTING.md` §6 for NGINX config).

---

## 2. Database Migrations

### 2.1 Apply a migration file manually

Place your `.sql` migration in `supabase/migrations/` (or anywhere on the server), then run:

```bash
cd /srv/supabase

# Apply a single migration file
docker exec -i supabase-db psql -U postgres -d postgres < /path/to/migration.sql

# Or copy-paste the SQL inline
docker exec -i supabase-db psql -U postgres -d postgres -c "YOUR_SQL_HERE"
```

### 2.2 Verify a migration applied

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "\dt public.*"
docker exec -i supabase-db psql -U postgres -d postgres -c "select * from supabase_migrations.schema_migrations order by version desc limit 10;"
```

### 2.3 Fix permissions after table changes

If a new table is inaccessible from the app, grant access:

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.your_table TO authenticated;
  GRANT ALL ON public.your_table TO service_role;
"
```

---

## 3. Edge Functions (Self-Hosted)

### 3.1 Deploy a single function

```bash
cd /srv/abc-glance

# Using Supabase CLI (if linked to your self-hosted project)
supabase functions deploy function-name --no-verify-jwt
```

### 3.2 Deploy all functions at once

```bash
cd /srv/abc-glance
for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  [ "$name" = "_shared" ] && continue
  supabase functions deploy "$name" --no-verify-jwt
done
```

### 3.3 Check edge function logs

```bash
cd /srv/supabase
docker logs --tail=200 supabase-edge-functions 2>&1 | grep -i "function-name"
```

### 3.4 Set edge function secrets

```bash
cd /srv/abc-glance

# Set one secret
supabase secrets set SECRET_NAME=value

# Or set multiple
supabase secrets set \
  SUPABASE_URL=http://kong:8000 \
  SUPABASE_ANON_KEY=eyJ... \
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  RESEND_API_KEY=re_...
```

> **Note**: On self-hosted Docker, the `SUPABASE_URL` for edge functions calling the DB is typically `http://kong:8000` (internal Docker network), not the public URL.

---

## 4. Scheduled Cron Jobs (pg_cron)

### 4.1 Schedule an edge function to run on a timer

```bash
cd /srv/supabase

# Example: run camera-watch every minute
docker exec -i supabase-db psql -U postgres -d postgres -c "
select cron.schedule('camera-watch-every-minute', '* * * * *', \$\$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/camera-watch',
    headers := '{\"Content-Type\":\"application/json\",\"Authorization\":\"Bearer YOUR_SERVICE_ROLE_KEY\"}'::jsonb,
    body := '{}'::jsonb
  );
\$\$);
"
```

### 4.2 List active cron jobs

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "
  select jobid, jobname, schedule, active from cron.job order by jobname;
"
```

### 4.3 Unschedule a job

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "
  select cron.unschedule('job-name-here');
"
```

### 4.4 Check cron run history

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "
  select * from cron.job_run_details order by start_time desc limit 20;
"
```

---

## 5. Database Queries (Quick Checks)

### 5.1 Check camera status

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "
  select instance_id, camera, online, since
  from public.camera_status
  order by since desc nulls last limit 50;
"
```

### 5.2 Check NVR instances

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "
  select id, name, url, whatsapp_recipients, daily_broadcast_enabled
  from public.frigate_instances
  order by name;
"
```

### 5.3 Check organizations / app settings

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "
  select id, name, daily_broadcast_time, timezone, daily_broadcast_recipients
  from public.organizations;
"

```

### 5.4 Check offline alerts log

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "
  select instance, camera, event_type, created_at
  from public.camera_events
  where event_type = 'offline'
  order by created_at desc limit 20;
"
```

---

## 6. Docker Maintenance

### 6.1 Restart containers

```bash
cd /srv/supabase
docker compose restart

# Or restart just one service
docker compose restart supabase-db
docker compose restart supabase-edge-functions
```

### 6.2 View container status

```bash
cd /srv/supabase
docker compose ps
```

### 6.3 Pull latest images (if using `latest` tag)

```bash
cd /srv/supabase
docker compose pull
docker compose up -d
```

---

## 7. Full Update Workflow

Typical end-to-end update after pulling new code:

```bash
# 1. Update frontend
cd /srv/abc-glance
git pull
bun install
bun run build

# 2. Apply any new DB migrations
cd /srv/supabase
docker exec -i supabase-db psql -U postgres -d postgres < /srv/abc-glance/supabase/migrations/YOUR_NEW_MIGRATION.sql

# 3. Deploy updated edge functions
cd /srv/abc-glance
for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  [ "$name" = "_shared" ] && continue
  supabase functions deploy "$name" --no-verify-jwt
done

# 4. Reload NGINX (if frontend config changed)
sudo systemctl reload nginx
```

---

## 8. Emergency / Recovery

### 8.1 Reset admin password via emergency endpoint

```bash
curl -X POST http://kong:8000/functions/v1/admin-users/emergency-reset \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"NEW_PASSWORD","emergency_user":"admin","emergency_pass":"YOUR_EMERGENCY_PASS"}'
```

### 8.2 Access psql directly inside the DB container

```bash
docker exec -it supabase-db psql -U postgres -d postgres
```

### 8.3 Export a table to CSV

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "
  COPY (SELECT * FROM public.camera_status WHERE online = false) TO STDOUT WITH CSV HEADER;
" > /tmp/offline_cameras.csv
```

---

> **Tip**: Keep this file in the repo root (`/srv/abc-glance/SELF_HOSTED_DOCKER_GUIDE.md`) so it travels with the code. Update it whenever you add a new cron job, edge function, or migration pattern.
