# UniFi Camera Health + Live View — Rollout (3 machines)

Three machines are involved. Do the steps in this order.

- **Machine A — App / Frontend host** (Vite build, nginx). Where the Glance repo lives, e.g. `/home/charl/functions/Glance`.
- **Machine B — Self-hosted Supabase Docker host** (the `supabase` docker-compose stack: `db`, `functions`, `kong`, …).
- **Machine C — On-site UniFi bridge** (Node service on the LAN with the ENVR), e.g. `/opt/glance-unifi-bridge` or `/home/charl/.../scripts/unifi-bridge`.

Feature summary:
1. `unifi_camera_status` table populated by the bridge every 30 s.
2. `/unifi-status` page = grid of every camera (green/red).
3. `/unifi-live` page = MJPEG snapshot grid proxied by the bridge.
4. WhatsApp alerts via existing Mudslide when a camera stays offline past a threshold.

---

## 0. Pull the latest code (Machine A + Machine C)

Both the app host and the bridge host need the new files. On each:

```bash
cd /home/charl/functions/Glance   # adjust to your repo path
git pull
```

Files added by this feature:

- `self-hosted-migrations/20260703_unifi_camera_health.sql`
- `supabase/functions/unifi-status/index.ts`
- `supabase/functions/unifi-offline-check/index.ts`
- `scripts/unifi-bridge/bridge.mjs` (updated — status polling + MJPEG server)
- `src/pages/UnifiCameraStatus.tsx`, `src/pages/UnifiLive.tsx`
- `src/lib/unifiHealthStore.ts`
- `src/components/UnifiOfflineAlertsDialog.tsx`
- Updated `src/components/UnifiSection.tsx`, `src/components/AppSidebar.tsx`, `src/App.tsx`

---

## 1. Machine B — Apply the DB migration

SSH to the Supabase Docker host, `cd` to the compose directory (the one with `docker-compose.yml` for Supabase), then:

```bash
# 1a. Copy the migration into the db container.
# If the repo isn't on this host, scp it from Machine A first, or:
scp user@machineA:/home/charl/functions/Glance/self-hosted-migrations/20260703_unifi_camera_health.sql /tmp/

docker compose cp /tmp/20260703_unifi_camera_health.sql db:/tmp/m.sql

# 1b. Apply it.
docker compose exec -T db psql -U postgres -d postgres -f /tmp/m.sql

# 1c. Verify.
docker compose exec -T db psql -U postgres -d postgres -c \
  "\d public.unifi_camera_status" 
docker compose exec -T db psql -U postgres -d postgres -c \
  "\d public.unifi_offline_alert_settings"
docker compose exec -T db psql -U postgres -d postgres -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='unifi_instances' AND column_name IN ('bridge_public_url','live_token');"
```

You should see the two new tables and both new columns on `unifi_instances`.

---

## 2. Machine B — Deploy the two new edge functions

The self-hosted stack reads functions from the `functions` container's mounted volume. Two functions to copy:

```bash
# From the Supabase compose directory:

# Copy from Machine A → this host first if needed, or reuse /tmp above.
scp -r user@machineA:/home/charl/functions/Glance/supabase/functions/unifi-status /tmp/
scp -r user@machineA:/home/charl/functions/Glance/supabase/functions/unifi-offline-check /tmp/

docker compose cp /tmp/unifi-status         functions:/home/deno/functions/unifi-status
docker compose cp /tmp/unifi-offline-check  functions:/home/deno/functions/unifi-offline-check

docker compose restart functions

# Quick smoke test — should return 401 (missing secret), NOT 404.
curl -i https://supabase.your-domain.com/functions/v1/unifi-status
curl -i https://supabase.your-domain.com/functions/v1/unifi-offline-check
```

If you get **404**, the copy landed in the wrong path. Confirm with:

```bash
docker compose exec functions ls /home/deno/functions | grep unifi
```

Expected: `unifi-ingest`, `unifi-status`, `unifi-offline-check`.

---

## 3. Machine B — Cron the offline check (every minute)

Add to root's crontab on the Supabase host (`sudo crontab -e`):

```
* * * * * curl -s -X POST \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  https://supabase.your-domain.com/functions/v1/unifi-offline-check > /dev/null 2>&1
```

Replace `<SERVICE_ROLE_KEY>` with the `service_role` JWT (same one your other cron jobs already use — e.g. the daily report cron). Test manually first:

```bash
curl -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  https://supabase.your-domain.com/functions/v1/unifi-offline-check
# → {"ok":true,"checked":N,"alerted":0,"recovered":0}
```

---

## 4. Machine C — Update and restart the bridge

The bridge source is in `/Glance` on this box, but the service runs from `/opt/glance-unifi-bridge`.

```bash
cd /Glance
git pull

cd /Glance/scripts/unifi-bridge
npm install --omit=dev            # no new deps but safe
```

Edit `.env` (in the working dir the bridge runs from, e.g. `/opt/glance-unifi-bridge/.env`) and add:

```ini
# existing
GLANCE_URL=https://supabase.your-domain.com
GLANCE_ANON_KEY=eyJhbGciOi...
INSTANCES_FILE=/opt/glance-unifi-bridge/instances.json
LOG_LEVEL=info
PERSON_ONLY=true

# NEW — camera health polling
STATUS_INTERVAL_SEC=30

# NEW — MJPEG live view server
HTTP_PORT=8787
BRIDGE_LIVE_TOKEN=change-me-long-random-string
LIVE_FPS=2
```

Then:

```bash
# Copy fresh bridge.mjs to the deployment dir:
sudo cp /Glance/scripts/unifi-bridge/bridge.mjs /opt/glance-unifi-bridge/bridge.mjs
sudo chown unifi-bridge:unifi-bridge /opt/glance-unifi-bridge/bridge.mjs

sudo systemctl restart unifi-bridge
sudo journalctl -u unifi-bridge -f
```

Healthy log lines to look for:

```
[<id>] status pushed 8 cameras
http server listening on 0.0.0.0:8787
```

### 4a. Open the MJPEG port

Browsers need to reach `HTTP_PORT` on Machine C. Two options:

- **Reverse proxy (recommended).** Put nginx/Caddy in front with a public URL, e.g. `https://bridge.your-domain.com`. Nginx must allow long-lived multipart responses:
  ```
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_buffering off;
    proxy_read_timeout 3600s;
  }
  ```
- **Direct port.** Open `8787/tcp` on the firewall and use `https://bridge-ip:8787` (better: put TLS in front).

Sanity check from your laptop:

```bash
curl -I "https://bridge.your-domain.com/snapshot/<instance-id>/<camera-id>?token=<BRIDGE_LIVE_TOKEN>"
# → 200 image/jpeg
```

---

## 5. Machine A — Build & deploy the frontend

```bash
cd /home/charl/functions/Glance
npm install
npm run build
# copy dist/ into your nginx webroot as you already do, e.g.:
sudo rsync -a --delete dist/ /var/www/glance/
```

Refresh the app in the browser — you'll see two new sidebar entries under UniFi: **Camera Status** and **Live View**.

---

## 6. Wire it up in the UI (one-time per NVR)

1. **NVRs → UniFi → Edit** on each ENVR:
   - **Bridge public URL** = the URL from step 4a (e.g. `https://bridge.your-domain.com`).
   - **Live view token** = exact same value as `BRIDGE_LIVE_TOKEN` in `.env` on Machine C.
   - Save.
2. **NVRs → UniFi → Offline alerts** on each ENVR:
   - Enable, set threshold (default 5 min), cooldown (default 60 min).
   - Add recipients:
     - Phone: `27821234567` (no `+`, no spaces).
     - Group: `1203xxxxxxxxxx@g.us` (get via `docker compose exec mudslide-listener node -e "..."` or the `/groups` endpoint from `help/MUDSLIDE_WHATSAPP_COMMANDS.md`).
   - Save.

---

## 7. Verify end-to-end

```bash
# On Machine B — status rows arriving?
docker compose exec -T db psql -U postgres -d postgres -c \
  "SELECT name, is_online, last_status_at FROM public.unifi_camera_status ORDER BY last_status_at DESC LIMIT 20;"

# On Machine C — status pushes and (later) offline transitions
sudo journalctl -u unifi-bridge -f | grep -E "status|offline|online"
```

In the app:
- **Sidebar → UniFi Status** shows every camera with a green/red dot and last-seen time.
- **Sidebar → UniFi Live** — pick an NVR → snapshot grid animates.
- Unplug a test camera → after `threshold_minutes` the WhatsApp alert fires. Plug it back in → recovery WhatsApp (if enabled).

---

## Troubleshooting quick table

| Symptom | Where | Fix |
|---|---|---|
| `unifi_camera_status` stays empty | Machine C logs | `.env` missing `STATUS_INTERVAL_SEC` / bridge not restarted / `unifi-status` returning 404 → recheck step 2. |
| `status HTTP 401` in bridge log | Machine C ↔ B | `webhook_secret` mismatch — reuse the same UUID as `unifi-ingest`. |
| Live View shows broken images | Browser ↔ Machine C | Reverse proxy buffering enabled — set `proxy_buffering off`. Or wrong `live_token` on the NVR row. |
| `401 unauthorized` on `/snapshot/...` | Browser ↔ Machine C | `live_token` in Glance ≠ `BRIDGE_LIVE_TOKEN` in `.env`. |
| No WhatsApp alerts | Machine B cron | Run the cron command manually; check `unifi-offline-check` response. Confirm recipients list isn't `[]` and Mudslide `/health` returns `connected:true`. |
| Cron 401 | Machine B | Wrong `SERVICE_ROLE_KEY` — reuse the one already working for `daily-report-send` cron. |
