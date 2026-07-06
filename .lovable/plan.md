
# Dispatch & Response Tracking

Operators create a dispatch (from an alert or manually), assign a vehicle + driver, and the driver's phone streams GPS. When the phone enters the site's geofence, arrival is auto-stamped and response time is calculated.

## What we're building

### 1. Data model (self-hosted Supabase — cloud mirrored on request)

- `vehicles` — call sign, registration, org, active driver (nullable FK to profiles), status (`available` / `dispatched` / `on_site` / `offline`), last known lat/lng/heading/speed/updated_at.
- `responders` — links a profile to an org as a responder, current vehicle_id, on_duty flag, device push token (for future notifications).
- `sites` — physical location per org: name, address, lat, lng, geofence_radius_m (default 100), linked NVR/instance id (nullable). Sites are what get dispatched to.
- `dispatches` — org, site_id, vehicle_id, responder_id, source (`manual` | `unifi_offline` | `hikvision_event`), source_ref (nullable id of the triggering alert/event), status (`pending` | `en_route` | `on_site` | `completed` | `cancelled`), priority, notes, created_by, dispatched_at, acknowledged_at, arrived_at, completed_at, response_seconds (generated).
- `dispatch_location_pings` — dispatch_id, lat, lng, accuracy_m, speed, heading, recorded_at. Append-only breadcrumb trail.
- `dispatch_events` — dispatch_id, kind (`created` | `acknowledged` | `geofence_entered` | `geofence_exited` | `arrived` | `completed` | `cancelled` | `note`), payload, at.

RLS: standard org-boundary via `can_read_org` / `can_admin_org`; responders can read/update only their own active dispatches.

### 2. Mobile responder app (Capacitor)

New Capacitor build of the existing app with a dedicated `/responder` route stack:

- Login → shows the current on-duty vehicle assignment.
- Toggle "On duty" → registers push token, starts background location.
- Active dispatch screen: site name, address, map with route line, ETA, big Acknowledge / Arrived / Complete buttons (Arrived auto-fires from geofence but stays tappable as fallback).
- Uses `@capacitor/geolocation` for foreground and `@capacitor-community/background-geolocation` for background tracking (screen off).
- Ping cadence: 5s while `en_route`, 30s idle, stops on `completed`/`cancelled`.
- Pings post to a new edge function `dispatch-ping` (validates responder owns the dispatch, appends to `dispatch_location_pings`, updates `vehicles.last_*`).
- Geofence handled server-side: `dispatch-ping` checks distance to site; on entry it stamps `arrived_at`, sets status `on_site`, emits `dispatch_events` row, sends WhatsApp confirmation to ops.

### 3. Operator dispatch console (web)

- New `/dispatch` page: split view — left: live list of active dispatches with status chips + response timer; right: Google Maps view with vehicle markers (using existing Google Maps connector) and site pins.
- **Create dispatch (manual):** pick site → pick available vehicle → optional priority/notes → send. Responder gets a push + the dispatch shows in their app.
- **Create dispatch (from alert):** on the UniFi offline alerts view and Hikvision events view, add a "Dispatch" button that opens the create-dispatch dialog pre-filled with the linked site (via `unifi_instances.site_id` / `hikvision_instances.site_id` — new nullable FKs).
- Realtime updates via Supabase Realtime on `dispatches` and `dispatch_location_pings`.
- Completed dispatch drawer: timeline of events, breadcrumb trail on map, response time.

### 4. Reporting

- `/dispatch/reports`: response-time averages per site / vehicle / responder, count of dispatches, and a leaderboard. CSV export.

## Technical notes

- Capacitor setup uses the existing `appID: app.lovable.4f9bcc9958834392b282343ada7ada87` / `appName: abc-glance` — after this ships you'll `git pull`, `npm i`, `npx cap add ios/android`, `npx cap sync`, then `npx cap run`.
- Background geolocation requires `ACCESS_BACKGROUND_LOCATION` (Android) and `NSLocationAlwaysAndWhenInUseUsageDescription` (iOS) — added to `capacitor.config.ts` and native manifests.
- New edge functions: `dispatch-create`, `dispatch-ping`, `dispatch-update-status`, `dispatch-notify` (WhatsApp using existing `whatsapp_settings` + Mudslide, same pattern as `unifi-offline-check`).
- Geofence check is server-side (haversine) — trusting client-declared arrival is trivially spoofable. Client can *suggest* arrival for UX responsiveness but the authoritative `arrived_at` is stamped by `dispatch-ping`.
- No Traccar for now — reuses the phones you already deploy.
- Migrations, RLS, GRANTs, and updated_at triggers included in the first migration.

## Rollout order

1. Migration + types.
2. Sites CRUD + link existing NVRs to sites.
3. Vehicles + responders CRUD.
4. Operator `/dispatch` console (manual creation) + realtime map.
5. Capacitor responder route + `dispatch-ping` + geofence auto-arrival.
6. "Dispatch" buttons on UniFi/Hikvision alerts.
7. Reports page.
8. WhatsApp notifications on dispatch lifecycle.

Say "go" and I'll start with step 1 (migration). If you want anything renamed, cut, or reordered first, tell me now.
