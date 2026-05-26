## Goals
1. Snapshots: ensure they actually appear in daily reports.
2. Offline timer: stop showing "0s" — track real `since` continuously.
3. New: alert the customer assigned to an NVR when any camera is offline > N minutes (configurable per NVR).

## Root causes
- `camera_status.since` is only written inside `daily-report-send` once a day, so the duration is always ~0 at send time.
- For locally-hosted NVRs, the cloud function can't reach `/api/stats`, so cameras list and snapshots are empty. Snapshots rely on the browser hook `useSnapshotRefresher`, which only runs while a user has the app open.

## Changes

### Database
Add to `frigate_instances`:
- `offline_alert_enabled boolean default false`
- `offline_alert_minutes int default 5`
- `offline_alert_recipients text[] default '{}'` (extra recipients, in addition to assigned customers)

Add table `camera_offline_alerts` (`instance_id, camera, alerted_at`) to avoid spamming — one alert per offline streak.

### New edge function `camera-watch` (runs every 1 min via pg_cron)
For each enabled instance:
- Fetch `/api/stats` (best-effort; if unreachable, skip but still mark NVR-level offline).
- Upsert `camera_status` with proper `since` only changing on transition (same logic as today but run frequently).
- For each camera offline ≥ `offline_alert_minutes` AND no alert sent for this streak AND `offline_alert_enabled`:
  - Resolve recipients = `offline_alert_recipients` ∪ contact_emails of users in `customer_nvr_assignments` for this NVR.
  - Call `escalate-offline` with the camera list.
  - Insert into `camera_offline_alerts` keyed on `(instance_id, camera, since)`.
- When camera comes back online, clear the streak row.

Pg_cron: `*/1 * * * *` invoking `camera-watch`.

### `daily-report-send`
- Don't reset `since` — preserve transitions written by camera-watch (uses same upsert helper, just doesn't overwrite since when state unchanged — already true; we'll add a guard so it never overwrites a row's existing since if the row exists with same state).
- For local NVRs where stats fetch fails, fall back to reading current `camera_status` rather than wiping it.
- Snapshots: if no stored snapshots, attempt to fetch latest.jpg via the instance's base_url for each online camera, upload, then use them. (Still won't work for local-only NVRs from cloud — document.)

### UI
Add to NVR edit form on `src/pages/Frigate.tsx` (or wherever NVRs are managed):
- Toggle "Email assigned customer when camera offline"
- Minutes input
- Additional recipients (comma-separated)

## Technical notes
- `escalate-offline` already accepts a recipients array — reuse as-is.
- Profiles have `contact_email`; fallback to `auth.users.email` via service role.
- The plan only changes backend monitoring + a small NVR settings UI; no other UI redesign.
