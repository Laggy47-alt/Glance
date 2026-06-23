## Hikvision AcuSense NVR Integration — Plan

Bring Hikvision NVRs into Glance as a first-class NVR type alongside Frigate and UniFi, with their own ingest path, status monitoring, schedules, and UI.

### 1. Database (new `hikvision_*` tables)

**`hikvision_instances`** — one row per NVR. Mirrors the useful fields from `frigate_instances` so the rest of the app can treat it uniformly:
- Connection: `name`, `base_url`, `is_local`, `verify_tls`, `auth_username`, `auth_password` (ISAPI Digest), `webhook_secret` (uuid path token), `color`, `enabled`
- Polling: `poll_enabled`, `last_polled_at`, `last_error`, `last_event_ts`, `last_seen_at`
- Offline alerting (same shape as Frigate): `offline_alert_enabled/minutes/recipients`, `whatsapp_alert_enabled/minutes/recipients`, `master_alert_recipients`, `multi_client`, `camera_whatsapp_recipients`, `nvr_unreachable_since/_alerted_since`
- NVR-unreachable + per-channel arm reuse existing tables (`camera_status`, `camera_armed_state`, `camera_arm_schedules`, `camera_offline_alerts`) keyed by `instance_id` — these are already generic uuid+camera, so no schema change needed there.

**`hikvision_events`** — alert rows pushed by the NVR:
- `instance_id`, `organization_id`, `channel_id` (ISAPI channelID), `camera_name`
- `event_type` (lineDetection, fieldDetection, regionEntrance, regionExiting, loitering, objectRemoval, attendedBaggage, unattendedBaggage, etc. — full AcuSense set ingested raw)
- `target_type` (human / vehicle / null), `detection_target` array
- `event_time`, `thumbnail_path` (camera-snapshots bucket), `raw` jsonb, `read`, `archived`

**`hikvision_channels`** — discovered channels per NVR (id, name, enabled, last snapshot path). Populated by the poll function from `/ISAPI/ContentMgmt/InputProxy/channels` or `/ISAPI/System/Video/inputs/channels`.

RLS: organization-scoped, same pattern as `unifi_*` / `frigate_instances`. GRANTs to `authenticated` + `service_role`.

### 2. Edge functions

**`hikvision-ingest`** (new, `verify_jwt = false`, public endpoint)
- URL: `/functions/v1/hikvision-ingest/{instance_id}/{webhook_secret}`
- Accepts `multipart/form-data` from Hikvision HTTP Host Notification:
  - First part: `application/xml` with `<EventNotificationAlert>` (channelID, eventType, dateTime, DetectionRegionList, targetType for AcuSense)
  - Subsequent parts: `image/jpeg` snapshot(s)
- Parses XML, uploads JPEG to `camera-snapshots/{org}/hikvision/{instance}/{channel}/{ts}.jpg`, inserts `hikvision_events` row, updates `camera_status` to online, bumps `last_event_ts` + `last_seen_at`.
- Validates secret; rejects mismatched instance/secret combos with 401.

**`hikvision-watch`** (new, cron every minute, mirrors `camera-watch`)
- For each enabled instance: poll `/ISAPI/System/status` (ISAPI Digest auth) to verify reachability; poll channel list to refresh `hikvision_channels` and `camera_status`.
- Uses `last_event_ts` per channel + heartbeat to flip channels offline after configured minutes.
- Reuses `escalate-offline` / `escalate-offline-whatsapp` and the same NVR-unreachable + recovery logic already in `camera-watch`.
- Added to `daily-offline-broadcast` so Hikvision channels appear in the 8am summary.

**`hikvision-proxy`** (new, authed)
- Mirrors `frigate-proxy`: streams ISAPI live snapshots `/ISAPI/Streaming/channels/{channelID}/picture` for the status page and event lightbox, using stored Digest credentials. Keeps NVR credentials server-side.

**`hikvision-discover`** (new, authed admin-only one-shot)
- Called from the NVR edit dialog: hits ISAPI to enumerate channels and populate `hikvision_channels`. Returns model/firmware for display.

### 3. Frontend

**Settings / NVRs page** — extend the existing `Frigate.tsx` / NVR settings flow:
- "Add NVR" gets a type selector: Frigate / Hikvision.
- Hikvision form: name, base URL, username, password, verify TLS, color, enabled. Shows the generated webhook URL + setup instructions for Hikvision Event > Notification > HTTP Listening.
- Reuse the multi-client camera→WhatsApp recipient editor against `hikvision_channels`.

**NVR Status page** — `NvrStatus.tsx` extended to render Hikvision instances and channels next to Frigate, using `hikvision-proxy` for snapshots. Same offline indicator + last-event timestamp.

**Events / Wall / Media** — `webhookStore` gains a `hikvision` event source. Rows render in the existing event feed with the AcuSense event type, target type chip (human/vehicle), and snapshot. Auto-read rules and archive work via the same UI.

**Arm schedules** — `camera_arm_schedules` already keys on `(instance_id, camera)`, so the existing schedule UI (`NvrSchedulesPanel`, `CameraScheduleDialog`) just needs Hikvision channels added to its camera picker — no logic change.

**Customer assignments** — `customer_nvr_assignments` and `customer_camera_assignments` already use generic `instance_id`. Add Hikvision instances to the picker dropdowns.

### 4. Public setup helper

A short markdown doc + on-screen instructions explaining how to point a Hikvision NVR's HTTP Listening at the generated webhook URL (Configuration → Network → Advanced → HTTP Listening, plus per-channel Event → Smart Event → enable Notify Surveillance Center).

### 5. Out of scope (call out for later)

- Two-way control (arm/disarm Hikvision channels via ISAPI) — only Glance-side arming for now.
- Recording playback / RTSP streaming.
- Cloud P2P / Hik-Connect; LAN/VPN reachable NVRs only.

### Technical notes

- All Hikvision functions live under `supabase/functions/hikvision-*/` mirroring the Frigate layout, with a `supabase/functions/_shared/hikvisionAuth.ts` helper for ISAPI Digest auth (the protocol Hikvision uses for ISAPI; not Basic).
- Ingest function is registered with `verify_jwt = false` in `supabase/config.toml`.
- `pg_cron` job invokes `hikvision-watch` every minute, registered via the insert tool (not migration) since it embeds the project URL + anon key — same pattern as `camera-watch`.
- Both backends (self-hosted `ragpwpshriqnieniaapx` and Lovable Cloud `bgczubehzofjvjenozof`) will get the migration + functions on confirmation; default target is self-hosted per your standing rule.
