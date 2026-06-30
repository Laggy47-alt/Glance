# UniFi Protect — local WebSocket bridge → Glance

Push UniFi Protect events into Glance the same way Hikvision does today: a small Node.js bridge runs on-site, subscribes to the Protect WebSocket, and POSTs each event to a new `unifi-ingest` edge function authenticated with a per-ENVR webhook secret. Events land in `unifi_events` + are mirrored into `webhook_events`/`media_items` so they show up on the Live Wall, Media page, WhatsApp alerts, daily reports, and customer feeds with no extra UI wiring.

## What gets built

### 1. Edge function — `supabase/functions/unifi-ingest/index.ts`
- Public (`verify_jwt = false`).
- Auth: `X-Webhook-Secret` header must match `unifi_instances.webhook_secret` for the `instance_id` in the body. Service-role client used inside.
- Body shape (one event per POST):
  ```json
  {
    "instance_id": "<uuid>",
    "event": {
      "id": "...", "type": "motion|smartDetectZone|smartDetectLine|ring|...",
      "smartDetectTypes": ["person","vehicle"],
      "camera_id": "...", "camera_name": "Front Door",
      "start": 1730000000000, "end": 1730000004000,
      "score": 87,
      "thumbnail_b64": "<optional jpeg base64>"
    }
  }
  ```
- Actions:
  1. Upsert `unifi_events` keyed on `(instance_id, remote_event_id)`.
  2. If `thumbnail_b64`, upload to `camera-snapshots/{org}/unifi/{instance}/{event_id}.jpg` and insert a `media_items` row.
  3. Insert a `webhook_events` row (`source_id = inst.source_id`, `topic = event.type`, `camera = camera_name`, `label = smartDetectTypes.join(',') || type`, `kind = 'unifi'`, `payload = event`).
  4. Update `unifi_instances.last_event_ts` + `last_seen_at`.
- Returns `{ ok: true, event_id }`.

### 2. Bridge — `scripts/unifi-bridge/`
New folder, self-contained Node 20 service modelled on `scripts/mudslide-listener/`:
- `package.json` (deps: `ws`, `undici`, `dotenv`)
- `bridge.mjs`:
  - For each configured ENVR in `instances.json` (or `INSTANCES_JSON` env): log in to Protect (`/api/auth/login` with username/password, capture cookie + `x-csrf-token`), open WS to `wss://<host>/proxy/protect/ws/updates?lastUpdateId=...`, decode the binary action/data frame pair (header length + zlib-deflated JSON; standard Protect format).
  - On `add` of a `event` model with `type` in motion/smartDetect/ring set: fetch the thumbnail via `/proxy/protect/api/events/{id}/thumbnail?w=640` (jpeg), base64 it, POST to `${GLANCE_URL}/functions/v1/unifi-ingest` with `X-Webhook-Secret: <per-ENVR secret>` and `apikey: <anon key>`.
  - Auto-reconnect with backoff, re-login on 401, structured logs to stdout.
- `unifi-bridge.service` — systemd unit (same pattern as Mudslide).
- `README.md` — install, pair, config (`GLANCE_URL`, `GLANCE_ANON_KEY`, `INSTANCES_JSON` with `{id, host, username, password, webhook_secret, verify_tls}` per ENVR), troubleshooting.

### 3. Frontend
- `src/lib/webhookStore.ts`: add `unifis: UnifiInstance[]` (mirroring `frigates` / `hikvisions`) with CRUD: `createUnifi`, `updateUnifi`, `deleteUnifi`, plus realtime subscription. Already-present columns: `name`, `base_url`, `color`, `enabled`, `verify_tls`, `webhook_secret`, `source_id`, `last_seen_at`, `last_event_ts`.
- `src/components/UnifiSection.tsx`: new panel on `/frigate` (NVRs page) — list of UniFi ENVRs as cards. Each card shows status badge (healthy if `last_seen_at < 5 min`), last event time, **Copy webhook secret** + **Copy instance_id** buttons (these go into the bridge `instances.json`), enable toggle, edit/delete. New "Add UniFi" entry in the existing "Add NVR" dropdown.
- `src/pages/Frigate.tsx`: mount `<UnifiSection />` under the existing `<HikvisionSection />`.
- Sidebar already says "NVRs" — no change.

### 4. Wall / Media / Alerts / Daily reports / Auto-read
No code changes — they read from `webhook_events` + `media_items`, both populated by `unifi-ingest`.

## Out of scope
- Two-way control back to the ENVR (arm/disarm at the Protect side).
- Live RTSP / recordings playback.
- Auto-discovery of cameras from the bridge into a `unifi_channels` table (not needed for alerts; can add later if NVR Status should list UniFi cameras individually).

## Self-hosted apply order
1. Approve & run the (no-op) migration if any column needs added — current schema already has everything required, so no SQL migration is needed.
2. `git pull` on the app server, rebuild frontend.
3. `git pull` on the on-site bridge machine, `cd scripts/unifi-bridge && npm install`, fill `.env` + `instances.json`, enable the systemd unit.
4. In Glance → NVRs → Add UniFi: create one row per ENVR, copy its `instance_id` + `webhook_secret` into the bridge config, restart bridge.

Approve and I'll start with the edge function + bridge, then the frontend.
