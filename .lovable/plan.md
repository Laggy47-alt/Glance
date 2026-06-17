# Remove UniFi from the app (temporary)

Pulling UniFi out of the **frontend, edge functions, and navigation** so you can rebuild it later with your own Python+WebSocket service. **Database tables stay** — that way your Python script can write straight into `unifi_instances` / `unifi_events` when you're ready, and no historical data is lost.

## What gets deleted

**Frontend pages & components**
- `src/pages/UnifiAlerts.tsx`
- `src/components/UnifiInstancesManager.tsx`
- `src/components/UnifiNvrCards.tsx`
- `src/lib/unifi.ts`

**Edge functions**
- `supabase/functions/unifi-poll/`
- `supabase/functions/unifi-proxy/`
- `supabase/functions/unifi-webhook/`

**Docs / scaffolding**
- `docs/unifi-bridge/` (Dockerfile + Deno bridge — Python script will replace it)

## What gets edited (UniFi imports/routes/menu items removed)

- `src/App.tsx` — drop `/unifi-alerts` route + import
- `src/components/AppSidebar.tsx` — drop "UniFi Alerts" / NVR nav entries
- `src/components/SuperFeaturesPanel.tsx` — remove UniFi feature toggle
- `src/hooks/useOrgFeatures.tsx` — remove `unifi` feature key
- `src/pages/NvrStatus.tsx` — remove UniFi cards section (keep Frigate)
- `src/pages/CameraStatus.tsx` — remove UniFi filter/branch
- `src/pages/Sources.tsx` — remove UniFi instances manager
- `src/pages/Frigate.tsx` — remove any UniFi cross-references
- `supabase/functions/webhook-ingest/index.ts` — remove UniFi-specific branch

## What stays untouched

- `unifi_instances` and `unifi_events` tables (data preserved for future Python script)
- `webhook_events` / `webhook_sources` (used by Frigate too)
- `DB_DUMP.md` (still references the tables — accurate, since they exist)
- All historical migrations (don't rewrite history)

## After this lands

- The app builds with **zero UniFi references** in code.
- Frigate, callouts, WhatsApp, daily reports, customer pages all keep working unchanged.
- Your Python WebSocket service can later `POST` rows into `unifi_events` (and optionally `webhook_events` to surface them on the Wall) using the existing service-role key — no app code needed.

## Out of scope

- Dropping the `unifi_*` tables (you'd lose history; ask explicitly if you want this).
- Building the Python WS service (you said you're handling that).

Approve and I'll do the deletions + edits in one pass.