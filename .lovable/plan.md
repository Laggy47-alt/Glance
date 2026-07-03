# UniFi Camera Health + Live View

Three additions, all built around the existing on-site UniFi bridge.

## 1. Camera status (bridge polls Protect every 30s)

**Bridge (`scripts/unifi-bridge/bridge.mjs`)**
- New poller per instance: every 30s hit `/proxy/protect/api/cameras`, extract `id, name, state, lastSeen, isConnected, wiredConnectionState, wifiConnectionState`.
- POST the full snapshot to a new edge function `unifi-status` (bulk upsert, one call per NVR).

**Backend**
- New table `unifi_camera_status` — per `(instance_id, camera_id)` row: `name`, `state`, `is_online bool`, `last_seen_at`, `last_offline_at`, `last_alert_sent_at`, `updated_at`.
- New table `unifi_offline_alert_settings` — per `unifi_instance_id`: `enabled bool`, `threshold_minutes int default 5`, `recipients jsonb` (list of `{type:'number'|'group', value}`), `cooldown_minutes int default 60`.
- Edge function `unifi-status` (bridge → cloud): validates `webhook_secret`, upserts rows, flips `is_online` based on `isConnected` + `lastSeen` age.
- Edge function `unifi-offline-check` (cron every minute): finds cameras where `is_online=false` AND `now - last_offline_at ≥ threshold` AND `now - last_alert_sent_at ≥ cooldown`, sends WhatsApp via existing `whatsapp-send`, stamps `last_alert_sent_at`. Runs 24/7.
- Second alert when a camera recovers ("Camera X back online").

**Frontend**
- New page `/unifi-status` mirroring `CameraStatus.tsx` but sourced from `unifi_camera_status` (realtime subscription). Groups by NVR, shows online/offline/last-seen, offline pill and count badges on the sidebar.
- Sidebar: add "UniFi Status" under NVRs, with `!` badge when any camera offline (reusing the pattern in `useOfflineStatus`).
- In `UnifiSection.tsx`, add a "Camera-down alerts" button per NVR that opens a dialog to toggle enable, set threshold (minutes), cooldown, and manage recipients (numbers + group JIDs, picker uses `/groups` from the Mudslide listener already wired).

## 2. Per-NVR WhatsApp recipients

- Recipients live on `unifi_offline_alert_settings.recipients` so each NVR has its own list.
- Dialog reuses existing WhatsApp settings client for the send path — no new secrets needed.
- Alerts bypass the nightly UniFi event schedule (that only gates event alerts, not health alerts).

## 3. Live view — bridge proxies RTSPS → HLS

**Bridge**
- Add `ffmpeg` requirement (documented in `UNIFI_BRIDGE.md`).
- New HTTP server on the bridge (localhost + optional LAN bind) exposing:
  - `GET /live/:instance/:camera/index.m3u8` — starts an on-demand `ffmpeg` transcode from `rtsps://<host>:7441/<streamName>?enableSrtp` to HLS (low-latency, 2s segments, 6-segment window) written to a tmp dir, streamed back.
  - Idle timeout: kills ffmpeg 15s after the last segment fetch.
  - Auth: shared bearer token (`LIVE_TOKEN` in bridge `.env`).
- Bridge fetches each camera's active `rtspAlias` from Protect bootstrap and caches it.

**Cloud proxy**
- New edge function `unifi-live-token` mints a short-lived signed URL (JWT, 5 min) that the frontend uses to hit the bridge through a user-supplied public bridge URL saved on `unifi_instances.bridge_public_url`.
- If `bridge_public_url` is empty the live view is hidden (LAN-only user just points at `http://bridge.local:8787` from browser).

**Frontend**
- New page `/cameras/live?site=…` using `hls.js`.
- On existing `/cameras` page, add a "Live view" action per site → opens grid of `<video>` elements, one per assigned camera, 2/3/4-column layout auto-fit.
- Add `bridge_public_url` field to the UniFi NVR edit form.

## Technical details

```text
unifi_camera_status (
  instance_id uuid, camera_id text, name text, state text,
  is_online bool, last_seen_at timestamptz,
  last_offline_at timestamptz, last_alert_sent_at timestamptz,
  updated_at timestamptz,
  PRIMARY KEY(instance_id, camera_id)
)

unifi_offline_alert_settings (
  unifi_instance_id uuid PRIMARY KEY,
  enabled bool default true,
  threshold_minutes int default 5,
  cooldown_minutes int default 60,
  recipients jsonb default '[]',
  notify_on_recovery bool default true
)

unifi_instances + bridge_public_url text null
```

New/changed files:
- `self-hosted-migrations/20260703_unifi_camera_health.sql`
- `supabase/functions/unifi-status/index.ts` (new)
- `supabase/functions/unifi-offline-check/index.ts` (new, cron)
- `supabase/functions/unifi-live-token/index.ts` (new)
- `scripts/unifi-bridge/bridge.mjs` (poller + HLS server)
- `scripts/unifi-bridge/package.json` (+ `hls-server` deps, ffmpeg docs)
- `scripts/unifi-bridge/.env.example` (+ `LIVE_TOKEN`, `LIVE_PORT`)
- `src/pages/UnifiStatus.tsx` (new)
- `src/pages/CamerasLive.tsx` (new)
- `src/components/UnifiOfflineAlertsDialog.tsx` (new)
- `src/components/UnifiSection.tsx` (+ button, + bridge URL field)
- `src/components/AppSidebar.tsx` (+ link + badge)
- `src/App.tsx` (+ routes)
- `help/UNIFI_BRIDGE_MACHINE.md` + `help/UNIFI_BRIDGE.md` (ffmpeg, new ports, tokens)

## Order of work
1. Migration + `unifi-status` function.
2. Bridge poller.
3. `UnifiStatus.tsx` + sidebar badge.
4. Offline-alerts dialog + `unifi-offline-check` cron + recovery message.
5. Bridge HLS server + `unifi-live-token` + `CamerasLive.tsx`.
6. Update help docs.

## Answer to "should we do it on the bridge?"
Yes — the bridge already holds an authenticated Protect session and sits on the LAN with the NVR, so polling for state and transcoding RTSPS are both cheapest and most reliable there. The cloud only receives status upserts and issues short-lived tokens for the live view.
