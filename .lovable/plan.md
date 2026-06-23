
# Hikvision frontend integration

## Goal

Make Hikvision NVRs first-class citizens alongside Frigate: managed from the same NVRs page, monitored on NVR Status, alerting into the same Live Wall, and selectable in schedules + customer assignments.

## Architectural decisions

1. **Rename "Frigate NVR" → "NVRs"** in the sidebar; keep the route `/frigate` so existing links don't break.
2. **Mirror Hikvision events into `webhook_events`** (and snapshots into `media_items`) at ingest time, in addition to writing the typed `hikvision_events` row. This means the Live Wall, Media page, auto-read rules, WhatsApp alerts, daily reports, and customer events all work automatically with zero UI changes for that part.
3. **One auto-paired `webhook_source` per Hikvision instance**, same pattern as UniFi already uses (`ensure_unifi_webhook_source` trigger). The instance row carries `source_id`; the ingest writes events scoped to that source.
4. **Snapshots**: store under `camera-snapshots/{org}/hikvision/...` (already done) and ALSO insert a `media_items` row with the public URL so the Wall and Media page render them like Frigate snapshots.

## Migration (small, one new SQL block)

- Add `source_id uuid references webhook_sources` to `hikvision_instances`.
- Add `ensure_hikvision_webhook_source` trigger mirroring the UniFi one (creates a `webhook_sources` row on insert, syncs name/color/enabled on update).
- GRANTs already covered by previous migration.

## Edge function update

- `hikvision-ingest/index.ts`: in addition to current writes, insert:
  - one `webhook_events` row (`source_id`, `topic = eventType`, `camera = finalCameraName`, `label = targetType ?? eventType`, `kind = "hikvision"`, `payload = { event, channel, targets, raw_excerpt }`)
  - if a snapshot was uploaded, one `media_items` row (`kind = "snapshot"`, `url = public URL`, `camera`, `topic`, `instance_id = inst.id`)

## Frontend changes

### Store — `src/lib/webhookStore.ts`
- New `HikvisionInstance` + `HikvisionChannel` types.
- `hikvisions: HikvisionInstance[]` and `hikvisionChannels: HikvisionChannel[]` fields.
- Load + realtime subscription for both tables.
- CRUD: `createHikvision`, `updateHikvision`, `deleteHikvision`, `discoverHikvisionChannels(id)`, `pollHikvisionNow(id)` (calls `hikvision-watch` for a single instance).

### Sidebar — `src/components/AppSidebar.tsx`
- Label "Frigate NVR" → "NVRs". Sites list shows both Frigate + Hikvision (sorted together).

### NVRs page — `src/pages/Frigate.tsx`
- Title "NVRs", subtitle covers both types.
- New "Add" dropdown: "Add Frigate" / "Add Hikvision".
- Hikvision dialog: name, base URL, username, password, verify TLS toggle, color, offline-alert settings.
- Hikvision card (collapsible, same visual language as Frigate cards):
  - Status badge (healthy / unreachable / error), enable toggle, last poll/last event.
  - **Webhook URL + secret panel** — copy button, with paste-into-NVR instructions (links to `HIKVISION_SETUP.md` summary).
  - **Discover channels** button (calls `hikvision-discover`, refreshes channel list).
  - Channels list with snapshot thumbnail (via `hikvision-proxy`), online badge, last event time.
  - Delete button.

### NVR Status — `src/pages/NvrStatus.tsx`
- Iterate `[...frigates, ...hikvisions]`. For Hikvision cards, source the channel list + online status from `camera_status` (already populated by `hikvision-watch`) and render snapshots via `hikvision-proxy`.

### Schedules — `src/components/CameraScheduleDialog.tsx`
- Camera picker currently lists Frigate cameras only. Extend it to also list Hikvision channels (instance name + channel name), keyed the same way (instance_id + camera name) so `camera_arm_schedules` works unchanged.

### Customer assignments — `src/pages/Customer.tsx` (+ any picker components)
- Add Hikvision instances + channels to the assignment dropdowns (`customer_nvr_assignments` + `customer_camera_assignments`). Keys are already polymorphic on `instance_id`.

### Wall + Media + WhatsApp alerts + Daily reports + Auto-read
- **No code changes** — they read from `webhook_events` / `media_items`, which are now populated by the Hikvision ingest mirror.

## Out of scope this turn

- Two-way ISAPI control (arm/disarm pushed back to NVR). Glance-side arming via `camera_arm_schedules` still works because it gates alerts in the app, not on the NVR.
- RTSP / recordings / playback.

## Suggested apply order

1. Backend: migration + ingest function update (1 migration approval).
2. Frontend: store extensions.
3. Frontend: sidebar rename + NVRs page Hikvision section.
4. Frontend: NVR Status page.
5. Frontend: schedule + customer assignment pickers.

You'll need to re-run the new migration on self-hosted + redeploy `hikvision-ingest` after step 1.

Approve and I'll start with step 1.
