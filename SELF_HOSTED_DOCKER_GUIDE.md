# ABC Glance — Self-Hosted Docker Supabase Command Reference

> **Target environment**: Self-hosted Supabase (Docker Compose) at `/srv/supabase/` + React frontend at `/srv/abc-glance/`.
> This file is a quick-reference cheat sheet. For the full cloud-hosted guide, see `SELF_HOSTING.md`.

---

## Chat Continuation Reference (for AI)

**PROJECT CONTEXT:** ABC Glance running on self-hosted Docker Supabase (`/srv/supabase/`) with frontend at `/srv/abc-glance/`. Database is Postgres inside `supabase-db` container. Edge functions run in `supabase-edge-functions` container.

**Latest work (resume here):**
- Removed the audit trail feature entirely (table `event_audit_log` dropped, UI/components gone).
- Added per-NVR WhatsApp daily client reports (`frigate_instances.daily_broadcast_enabled` + `daily-offline-broadcast` edge function fans out per-NVR).
- Added NVR-unreachable WhatsApp alerts in `camera-watch`: new columns `frigate_instances.nvr_unreachable_since` and `nvr_unreachable_alerted_since`. Fires one WhatsApp message past `whatsapp_alert_minutes` (falls back to `offline_alert_minutes`), gated by `whatsapp_settings.include_nvr_unreachable` + per-NVR `whatsapp_alert_enabled`. Clears on recovery.
- Reworked the WhatsApp Alerts page to a two-pane layout (left sidebar nav, right content) with the inbox merged in.

---

## 0. After-Pull Sync Checklist (run this every time you `git pull`)

```bash
# 1. Frontend
cd /srv/abc-glance/Glance       # or wherever your repo lives
bun install
bun run build

# 2. New/changed DB columns (idempotent — safe to re-run)
docker exec -i supabase-db psql -U postgres -d postgres <<'SQL'
ALTER TABLE public.frigate_instances
  ADD COLUMN IF NOT EXISTS daily_broadcast_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nvr_unreachable_since timestamptz,
  ADD COLUMN IF NOT EXISTS nvr_unreachable_alerted_since timestamptz;

DROP TABLE IF EXISTS public.event_audit_log CASCADE;
SQL

# 3. Edge functions changed in the last batch
supabase functions deploy camera-watch              --no-verify-jwt
supabase functions deploy daily-offline-broadcast   --no-verify-jwt
supabase functions deploy escalate-offline-whatsapp --no-verify-jwt
supabase functions deploy whatsapp-heartbeat        --no-verify-jwt
supabase functions deploy whatsapp-incoming        # JWT required ON
supabase functions deploy admin-users               --no-verify-jwt

# 4. Reload nginx if you changed nginx config
sudo nginx -t && sudo systemctl reload nginx
```

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

## 9. WhatsApp Alert Pipeline — How it actually runs

### 9.1 Moving parts

| Piece | Where | Role |
|---|---|---|
| `whatsapp_settings` (table) | Postgres | Per-org Mudslide URL, token, defaults, quiet hours, daily broadcast config |
| `frigate_instances` (table) | Postgres | Per-NVR `whatsapp_alert_enabled`, `whatsapp_recipients`, `whatsapp_alert_minutes`, `multi_client`, `camera_whatsapp_recipients`, `daily_broadcast_enabled`, `nvr_unreachable_since`, `nvr_unreachable_alerted_since` |
| `camera_status` (table) | Postgres | Latest online/offline state per camera with `since` timestamp |
| `camera_offline_alerts` (table) | Postgres | Dedupes per-camera alerts so the same offline streak doesn't repeat |
| `camera-watch` (edge fn, every minute via pg_cron) | Edge | Polls each NVR's `/api/stats`, reconciles `camera_status`, fires email + WhatsApp |
| `escalate-offline-whatsapp` (edge fn) | Edge | Sends one message via Mudslide; quiet hours + rate limit + retry |
| `daily-offline-broadcast` (edge fn, every minute) | Edge | Once-per-day org summary + per-NVR client summaries |
| `whatsapp-heartbeat` (edge fn, every 5 min) | Edge | `GET /me` on Mudslide to keep the session warm |
| `whatsapp-incoming` (edge fn) | Edge | Mudslide webhook → `whatsapp_incoming_messages` (Reply inbox) |
| Mudslide | Container | WhatsApp Web bridge |

### 9.2 Thresholds — when does an alert fire?

- **Per-camera offline alert (WhatsApp):** when a camera has been offline ≥ `frigate_instances.whatsapp_alert_minutes` (NULL → falls back to `offline_alert_minutes`). One message per streak, deduped via `camera_offline_alerts`.
- **NVR unreachable alert (WhatsApp):** when `/api/stats` has failed ≥ the same threshold. Tracked via `nvr_unreachable_since`; only fires once per streak (`nvr_unreachable_alerted_since`). Requires `whatsapp_settings.include_nvr_unreachable = true` AND that NVR's `whatsapp_alert_enabled = true` AND it has recipients.
- **Disarmed cameras** (via `camera_armed_state.armed = false`) are skipped.
- **Quiet hours** suppress everything except `{"test": true}` calls.
- **Rate limit:** `whatsapp_settings.max_alerts_per_hour` (0 = unlimited).

### 9.3 Cron jobs you should have

```sql
-- camera-watch (every minute)
SELECT cron.schedule('camera-watch', '* * * * *', $$
  SELECT net.http_post(
    url     := 'https://<your-host>/functions/v1/camera-watch',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- daily-offline-broadcast (every minute; fn checks the configured time itself)
SELECT cron.schedule('daily-offline-broadcast', '* * * * *', $$
  SELECT net.http_post(
    url     := 'https://<your-host>/functions/v1/daily-offline-broadcast',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- whatsapp-heartbeat (every 5 min)
SELECT cron.schedule('whatsapp-heartbeat', '*/5 * * * *', $$
  SELECT net.http_post(
    url     := 'https://<your-host>/functions/v1/whatsapp-heartbeat',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);
```

Inspect / unschedule / view runs:

```sql
SELECT jobid, jobname, schedule, active FROM cron.job;
SELECT cron.unschedule('camera-watch');

SELECT start_time, status, return_message
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname = 'camera-watch'
ORDER BY start_time DESC LIMIT 20;
```

### 9.4 Configuring an NVR for 5-minute alerts

In **WhatsApp Alerts → Per-NVR overrides**:
1. Toggle **WhatsApp alerts on**.
2. **Alert after (minutes):** `5` (leave blank to inherit the email threshold).
3. Add **Recipients** (`+27821234567` or group JIDs like `12345-67890@g.us`).
4. (Optional) Toggle **Send daily report** for the per-NVR daily summary.
5. (Optional) **Multi-client NVR** for per-camera recipient routing.

In **Templates**, enable **Alert on NVR unreachable** to also get NVR-down WhatsApp alerts (same threshold as cameras).

### 9.5 Smoke-test commands

```bash
# Force camera-watch right now
curl -s -X POST https://<your-host>/functions/v1/camera-watch \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{}' | jq

# Force the daily broadcast regardless of configured time
curl -s -X POST "https://<your-host>/functions/v1/daily-offline-broadcast?force=1" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{}' | jq

# One-off WhatsApp test (bypasses quiet hours / rate limit)
curl -s -X POST https://<your-host>/functions/v1/escalate-offline-whatsapp \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"organization_id":"<ORG_UUID>","recipients":["+27821234567"],"message":"test","test":true}' | jq

# Heartbeat
curl -s -X POST https://<your-host>/functions/v1/whatsapp-heartbeat \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{}' | jq
```

### 9.6 Debug queries

```sql
-- NVRs currently flagged unreachable
SELECT name,
       nvr_unreachable_since,
       EXTRACT(EPOCH FROM (now() - nvr_unreachable_since))/60 AS minutes_down,
       nvr_unreachable_alerted_since IS NOT NULL AS already_alerted
FROM public.frigate_instances
WHERE nvr_unreachable_since IS NOT NULL
ORDER BY nvr_unreachable_since;

-- Cameras currently offline (excluding disarmed)
SELECT fi.name AS nvr, cs.camera,
       EXTRACT(EPOCH FROM (now() - cs.since))/60 AS minutes_offline
FROM public.camera_status cs
JOIN public.frigate_instances fi ON fi.id = cs.instance_id
LEFT JOIN public.camera_armed_state a ON a.instance_id = cs.instance_id AND a.camera = cs.camera
WHERE cs.online = false AND COALESCE(a.armed, true) = true
ORDER BY cs.since;

-- WhatsApp settings sanity check
SELECT enabled, mudslide_url, include_nvr_unreachable,
       daily_broadcast_enabled, daily_broadcast_time, quiet_timezone,
       array_length(default_recipients,1) AS default_recip_count,
       last_heartbeat_at, last_heartbeat_status
FROM public.whatsapp_settings;

-- Reset an NVR's unreachable streak (forces re-alert next time it goes down)
UPDATE public.frigate_instances
SET nvr_unreachable_since = NULL, nvr_unreachable_alerted_since = NULL
WHERE name = 'YOUR_NVR_NAME';

-- Clear stuck per-camera dedupe (forces re-alert on next poll)
DELETE FROM public.camera_offline_alerts
WHERE instance_id = (SELECT id FROM public.frigate_instances WHERE name = 'YOUR_NVR')
  AND camera = 'YOUR_CAM';
```

### 9.7 Edge function logs

```bash
docker logs --tail 200 -f supabase-edge-functions
docker logs --tail 200 -f supabase-edge-functions 2>&1 | grep -E "camera-watch|whatsapp"
```

---

## 10. Mudslide container — quick reference

```bash
docker ps --filter "name=mudslide"
docker logs --tail 100 -f mudslide

# Pair WhatsApp (scan QR from logs)
docker exec -it mudslide mudslide login

# List groups (use the printed JID like 12345-67890@g.us)
docker exec -it mudslide mudslide groups

# Restart if session goes stale
docker restart mudslide
```

UI sidebar heartbeat red? Restart Mudslide and re-pair if needed:

```sql
SELECT last_heartbeat_at, last_heartbeat_status FROM public.whatsapp_settings;
```

---

## 11. Security notes (self-hosted single-tenant)

The Lovable scanner flags cross-org RLS holes (most policies just check `auth.uid() IS NOT NULL`, the `frigate_instances.api_key` is readable, the `camera-snapshots` bucket is public, etc.). On a single-tenant self-hosted box where only trusted operators sign in, these are accepted risks. If you ever multi-tenant this DB, harden:

- Functions: `can_admin_org`, `can_read_org`, `is_org_admin`, `is_org_member`, `user_has_instance`, `user_has_camera` (currently stubs).
- RLS on: `frigate_instances`, `whatsapp_settings`, `daily_report_settings`, `webhook_sources`, `profiles`, `user_roles`, `organization_members`.
- Make `camera-snapshots` bucket private and serve via a signed-URL edge function.

---
