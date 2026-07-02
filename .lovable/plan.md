# Plan — Sites, Clips, User-Create

## 1. Sites per UniFi NVR

**Database**
- New table `unifi_sites` — id, organization_id, unifi_instance_id, name, color, notes.
- Add `site_id uuid` column to `unifi_events` (for stamping the site on incoming events).
- Cameras are identified by `unifi_instance_id + camera_id`. Instead of a separate join table, reuse the existing `unifi_cameras` mirror if present, or add `unifi_camera_sites(instance_id, camera_id, site_id)` — one row per assigned camera.

**Ingest change**
- `supabase/functions/unifi-ingest`: on each event, look up the site for `(instance_id, camera_id)` and write it to `site_id` + include site name in the display payload so the Live wall shows the site instead of the NVR name.

**Frontend**
- New route `/cameras` — dedicated page that lists ALL UniFi cameras across NVRs, groups by NVR, filter/search bar, and a Site dropdown per camera with bulk-assign (checkboxes → "Assign selected to site").
- Add "Manage sites" side panel on the same page (create/rename/delete sites, scoped to the selected NVR).
- `Wall.tsx` site-lookup: prefer `event.site_name` from ingest, fall back to NVR name (already fixed).
- Sidebar link "Cameras" under NVRs.

## 2. UniFi 10-second clips

**Bridge (`scripts/unifi-bridge/bridge.mjs`)**
- After receiving `add` event with `end` timestamp (or `motion`/`smartDetectZone` finished), schedule a clip download after `end + 5s` buffer.
- Call `POST /proxy/protect/api/video/export` with `camera`, `start`, `end` (10s window centred on event start), stream to buffer.
- POST clip to `unifi-ingest` as multipart with `kind=clip`, same event id so it updates the existing row.

**Ingest (`unifi-ingest`)**
- Accept `clip` uploads: store to `camera-snapshots` bucket (or new `camera-clips`) and update `media_items.clip_url` for the matching event.

**Frontend**
- Alert card already renders `clip_url` if present; verify Media viewer plays MP4.

## 3. `/super` create user — "non-2xx" fix

**Diagnostics + fix**
- Add server-side console.error at every failure branch of `create` so the specific message surfaces in edge logs (already partly there — expand to include the caught throw path).
- Most likely causes on a *new org*:
  - `organization_members.role` enum missing `customer` value in a fresh org install.
  - `auth.users.email` collision because the org slug is empty/duplicate → `buildEmail` produces the same address as an existing user.
  - `profiles.username` uniqueness collision (a super-admin creating "admin" across orgs).
- Frontend `Users.tsx`: surface the JSON `error` field from the response instead of the generic "non-2xx" toast so we see the real reason next time.

## Technical details

```text
unifi_sites (id, organization_id, unifi_instance_id, name, color, notes)
unifi_camera_sites (instance_id, camera_id, site_id)  PK(instance_id, camera_id)
unifi_events + site_id uuid null
```

Files touched:
- `supabase/migrations/<ts>_unifi_sites.sql` (new)
- `supabase/functions/unifi-ingest/index.ts` (site lookup + clip accept)
- `scripts/unifi-bridge/bridge.mjs` (clip fetch)
- `src/pages/Cameras.tsx` (new)
- `src/App.tsx` + sidebar (route + link)
- `src/pages/Users.tsx` (surface error text)
- `supabase/functions/admin-users/index.ts` (verbose error logs)

## Order of work
1. Migration (sites tables + site_id column).
2. `/cameras` page + sidebar.
3. Ingest lookup + wall label.
4. Bridge clip fetch + ingest clip handler.
5. Users.tsx error surfacing + admin-users logging.
