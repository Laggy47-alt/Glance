# UniFi camera health + live view

Adds two things:

1. **Camera Status page** (`/unifi-status`) — live table of every Protect
   camera pushed from the on-site bridge every 30 s.
2. **Live View page** (`/unifi-live`) — grid of MJPEG snapshot streams
   proxied by the same bridge (no ffmpeg needed).
3. **WhatsApp alerts** when a camera stays offline past a per-NVR threshold,
   using the existing Mudslide edge function.

---

## 1. Apply the migration

```bash
cd ~/supabase
docker compose cp \
  /path/to/glance-repo/self-hosted-migrations/20260703_unifi_camera_health.sql \
  db:/tmp/m.sql
docker compose exec -T db psql -U postgres -d postgres -f /tmp/m.sql
```

Creates:

- `public.unifi_camera_status` (per-camera live state)
- `public.unifi_offline_alert_settings` (per-NVR alert config)
- Adds `bridge_public_url` and `live_token` columns to `public.unifi_instances`.

## 2. Deploy the new edge functions

Copy source into the functions volume:

```bash
docker compose cp /path/to/glance-repo/supabase/functions/unifi-status \
  functions:/home/deno/functions/unifi-status
docker compose cp /path/to/glance-repo/supabase/functions/unifi-offline-check \
  functions:/home/deno/functions/unifi-offline-check
docker compose restart functions
```

Run the offline check on a cron every minute (from the host):

```
* * * * * curl -s -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  https://supabase.example.com/functions/v1/unifi-offline-check > /dev/null
```

## 3. Update the bridge

```bash
cd /home/charl/functions/Glance
git pull
cd scripts/unifi-bridge
npm install    # no new deps but safe
# Edit .env — add HTTP_PORT, BRIDGE_LIVE_TOKEN, LIVE_FPS, STATUS_INTERVAL_SEC
systemctl restart glance-unifi-bridge     # or `docker compose restart`
```

The bridge will now:

- Poll `/proxy/protect/api/cameras` every `STATUS_INTERVAL_SEC` and POST to
  `/functions/v1/unifi-status`.
- If `HTTP_PORT>0`, serve `GET /snapshot/:instanceId/:cameraId` and
  `GET /stream/:instanceId/:cameraId` (multipart JPEG) — one animated
  snapshot every `1/LIVE_FPS` seconds. Requires `?token=<BRIDGE_LIVE_TOKEN>`.

## 4. Wire it up in the UI

1. Open **NVRs → Edit** on each UniFi NVR.
2. Set **Bridge public URL** to the URL clients will hit (e.g.
   `https://bridge.example.com:8787`) and **Live view token** to the same
   value as `BRIDGE_LIVE_TOKEN` on the bridge.
3. Click **Offline alerts** on the same NVR to enable WhatsApp alerts,
   set the threshold (default 5 min) and add recipients (phone numbers
   like `27821234567` or WhatsApp group IDs like `1203…@g.us`).

## 5. Where to look

- **Sidebar → UniFi Status** — grid of cameras (green = online, red = offline).
- **Sidebar → UniFi Live** — pick an NVR and see all online cameras as a
  live snapshot grid. Pause/resume with the button.
- **WhatsApp** — alerts arrive on the recipients when a camera stays
  offline past the threshold. Recovery messages when it comes back.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Camera Status is empty | Check bridge logs for `status HTTP` errors. Bridge must be restarted after adding `.env` values. |
| Live View shows broken images | Reverse-proxy in front of the bridge must allow `multipart/x-mixed-replace` and long-lived requests (nginx: `proxy_buffering off;`). |
| `401 unauthorized` on snapshots | `live_token` in Glance UI ≠ `BRIDGE_LIVE_TOKEN` in bridge `.env`. |
| No WhatsApp alerts | Verify `unifi-offline-check` cron is firing, recipients are non-empty, and `whatsapp-send` returns 200 from the same host. |
