# ABC Glance — Maintenance Runbook

Routine maintenance for the self-hosted stack. Run top-to-bottom monthly, or à-la-carte when needed.

Servers (see `ref.dev`):
- **Frontend:** `10.7.11.15` — user `glance` — `/srv/abc-glance/Glance`
- **Backend:** `10.7.14.147` — user `charl` — `~/supabase-project` (Docker Supabase)

---

## 1. Pre-flight (both hosts)

```bash
# Disk + memory
df -h /
free -h
uptime

# Docker health (backend)
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

Bail out and investigate first if:
- Root disk > 85% full
- Any Supabase container in `Restarting` / `Exited`
- Load average sustained > CPU count

---

## 2. Frontend maintenance (`10.7.11.15`)

```bash
cd /srv/abc-glance/Glance

# 2.1 Pull latest code
git status
git pull

# 2.2 Refresh deps + rebuild
bun install
bun run build

# 2.3 Verify build output
ls -lh dist/ | head
du -sh dist/

# 2.4 Reload nginx (only if nginx config changed)
sudo nginx -t && sudo systemctl reload nginx

# 2.5 Prune old bun / npm caches (quarterly)
bun pm cache rm || true
```

Smoke-test in browser:
- Log in
- Live Wall loads (default filter = person + license_plate)
- WhatsApp Alerts page opens, per-NVR overrides visible
- Sites page: create + delete a throwaway site works

---

## 3. Backend maintenance (`10.7.14.147`)

### 3.1 Apply pending DB migrations

```bash
cd ~/supabase-project

# List migrations shipped in the repo that aren't applied yet
ls /srv/abc-glance/Glance/self-hosted-migrations/

# Apply any new ones (idempotent — safe to re-run)
for f in /srv/abc-glance/Glance/self-hosted-migrations/*.sql; do
  echo "==> $f"
  docker exec -i supabase-db psql -U postgres -d postgres < "$f"
done
```

### 3.2 Ensure the delete-site FK cascades

```bash
docker exec -i supabase-db psql -U postgres -d postgres <<'SQL'
ALTER TABLE public.dispatches
  DROP CONSTRAINT IF EXISTS dispatches_site_id_fkey,
  ADD CONSTRAINT dispatches_site_id_fkey
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;
SQL
```

### 3.3 Re-deploy edge functions

```bash
cd /srv/abc-glance/Glance
for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  [ "$name" = "_shared" ] && continue
  [ "$name" = "whatsapp-incoming" ] && supabase functions deploy "$name" && continue
  supabase functions deploy "$name" --no-verify-jwt
done
```

### 3.4 Verify cron jobs are alive

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "
  select jobname, schedule, active from cron.job order by jobname;
"

docker exec -i supabase-db psql -U postgres -d postgres -c "
  select j.jobname, d.status, d.start_time, d.return_message
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where d.start_time > now() - interval '1 hour'
  order by d.start_time desc limit 30;
"
```

Expected active jobs: `camera-watch`, `daily-offline-broadcast`, `whatsapp-heartbeat`, `cleanup-old-alerts` (if scheduled).

### 3.5 Data retention cleanup

The `cleanup-old-alerts` function trims `media_items`, `webhook_events`, `unifi_events` older than `RETENTION_DAYS` (default 60). Kick it manually:

```bash
curl -sk -X POST https://<host>/functions/v1/cleanup-old-alerts \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'content-type: application/json' -d '{}' | jq
```

### 3.6 Postgres housekeeping

```bash
docker exec -i supabase-db psql -U postgres -d postgres <<'SQL'
-- Reclaim space + refresh planner stats
VACUUM (ANALYZE);

-- Table sizes (spot runaway growth)
SELECT relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 15;

-- Bloat / dead tuples
SELECT relname, n_live_tup, n_dead_tup,
       CASE WHEN n_live_tup > 0
            THEN round(100.0 * n_dead_tup / n_live_tup, 1)
            ELSE 0 END AS dead_pct
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC LIMIT 10;
SQL
```

If `dead_pct` > 20 on a hot table, run `VACUUM FULL <table>` in a maintenance window (locks the table).

### 3.7 Storage buckets

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "
  select bucket_id, count(*) as objects,
         pg_size_pretty(sum((metadata->>'size')::bigint)) as total
  from storage.objects group by bucket_id order by 2 desc;
"
```

If `camera-snapshots` is huge, confirm `cleanup-old-alerts` is deleting the referencing `media_items` rows.

### 3.8 Backups

```bash
# Nightly dump — verify the last one exists and isn't empty
ls -lh ~/backups/ | tail

# Manual dump on demand
docker exec supabase-db pg_dump -U postgres -d postgres \
  | gzip > ~/backups/pg-$(date +%F).sql.gz
```

Keep 14 daily + 3 monthly. Test-restore into a scratch DB quarterly.

### 3.9 Docker upkeep

```bash
cd ~/supabase-project

# Pull latest images (only if you intend to update — read release notes first)
# docker compose pull && docker compose up -d

# Reclaim disk from dangling layers
docker system df
docker system prune -f
docker image prune -f
```

---

## 4. WhatsApp / Mudslide health

```bash
# Container alive?
docker ps --filter name=mudslide

# Heartbeat status
docker exec -i supabase-db psql -U postgres -d postgres -c "
  select enabled, last_heartbeat_at, last_heartbeat_status from public.whatsapp_settings;
"

# Force a heartbeat
curl -sk -X POST https://<host>/functions/v1/whatsapp-heartbeat \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'content-type: application/json' -d '{}' | jq

# If red: restart Mudslide and re-pair if needed
docker restart mudslide
docker logs --tail 100 mudslide
```

---

## 5. End-to-end verification

```bash
cd /srv/abc-glance/Glance
export SUPABASE_URL=https://supabase.abcglance.co.za
export ANON_KEY=... ADMIN_PASS=... ORG_SLUG=abc-2026
bash help/verify-stack.sh
```

All 8 checks should pass.

---

## 6. Log review

```bash
# Edge functions (last hour of errors)
docker logs --since 1h supabase-edge-functions 2>&1 | grep -iE 'error|fail' | tail -50

# Postgres
docker logs --since 1h supabase-db 2>&1 | grep -iE 'error|fatal' | tail -50

# Nginx (frontend host)
sudo tail -n 100 /var/log/nginx/error.log
```

---

## 7. Security spot-check (quarterly)

- Rotate `SERVICE_ROLE_KEY` and re-set edge function secrets if leaked risk suspected.
- Confirm no new tables in `public` are missing RLS + GRANTs:
  ```sql
  SELECT c.relname, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false;
  ```
- Review `user_roles` — no unexpected `super_admin` rows.
- Review new `webhook_sources` and disable stale ones.

---

## 8. Cadence

| Task | Frequency |
|---|---|
| Section 1 pre-flight | Weekly |
| Frontend rebuild (§2) | On code push |
| Migrations + edge deploy (§3.1–3.3) | On code push |
| Cron + retention check (§3.4–3.5) | Weekly |
| VACUUM ANALYZE + size review (§3.6–3.7) | Monthly |
| Backup restore drill (§3.8) | Quarterly |
| Docker prune (§3.9) | Monthly |
| WhatsApp health (§4) | Weekly |
| verify-stack.sh (§5) | After every maintenance run |
| Security spot-check (§7) | Quarterly |

---

## 9. Rollback

If a release breaks prod:

```bash
# Frontend
cd /srv/abc-glance/Glance
git log --oneline -5
git checkout <previous-sha>
bun install && bun run build

# Edge functions — re-deploy from the previous sha
# DB — restore from latest dump into a scratch DB, diff, then apply corrective SQL
```

Never `git reset --hard` on the deployed checkout without a backup of `dist/`.
