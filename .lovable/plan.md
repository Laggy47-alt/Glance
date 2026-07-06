# Positive-tag WhatsApp group alert

## What triggers it
When an operator adds a tag whose name starts with `positive` (e.g. the existing "positive incident" suggested tag) to a media item in `MediaLightbox`, the app dispatches a WhatsApp message to a single per-organization group. Removing the tag does not send anything. Adding a second positive tag to the same media within a short window is deduped so the group isn't spammed.

The operator's comment on that tag (the `note` column on `media_tags`, editable in the lightbox — a small edit for the note is added if it's not already writable there) is included in the message.

## What the message contains
Plain WhatsApp text (Mudslide `/send` only accepts text today, so we don't try to upload a binary image), formatted like:

```
✅ Positive incident confirmed
Camera: <camera / source name>
Time:   <local time>
Tagged by: <operator display name>
Note:   <operator comment, if any>

Snapshot: <public snapshot URL>
Video:    <public video URL, if the media_item has one>
```

WhatsApp auto-renders the snapshot URL as an inline preview, so the group sees the image without us needing multipart upload. If the media has no video the "Video:" line is omitted.

## Where the tag lives
`media_tags` (columns: `id, media_id, tag, note, created_by, organization_id, created_at`) joined to `media_items` for the snapshot/video URLs and camera/source name. The lightbox already inserts rows here and the suggested tag `"positive incident"` already exists — no schema change needed for tagging itself.

## Configuration (per organization)
Extend `whatsapp_settings` with three columns:
- `positive_alert_enabled boolean default false`
- `positive_alert_group_jid text` — a single WhatsApp group JID (`…@g.us`)
- `positive_alert_cooldown_seconds int default 60` — dedupe window per media_item

Add a small "Positive-incident alerts" card to `src/pages/WhatsAppAlerts.tsx` with an enable switch, a group JID input (with a "Pick from groups" helper that calls the existing Mudslide `/groups` endpoint), and the cooldown field.

## Dispatch path
1. `MediaLightbox.addTag()` — after a successful insert, if the tag matches `/^positive/i`, call `supabase.functions.invoke("positive-alert-dispatch", { body: { media_tag_id } })`. Fire-and-forget; failures show a toast but don't block tagging.
2. New edge function `supabase/functions/positive-alert-dispatch/index.ts`:
   - Validates JWT, loads `media_tags` + `media_items` + camera name + operator profile.
   - Loads `whatsapp_settings` for that org; exits early if disabled or no group JID.
   - Checks `camera_offline_alerts`-style dedupe (or a new lightweight `positive_alert_dispatches` audit table keyed on `media_id` + `last_sent_at`) against `positive_alert_cooldown_seconds`.
   - Builds the message text above.
   - POSTs to the Mudslide listener using the same pattern as `escalate-offline-whatsapp` (reads `whatsapp_settings.mudslide_url` + `mudslide_token`, `POST /send` with `{ to: group_jid, message }`).
   - Writes an audit row on success.
3. Add `positive_alert_dispatches` table (org_id, media_id, tag_id, sent_at, group_jid) with the standard `GRANT` + RLS scoped to `has_role(auth.uid(), 'admin')` for reads; writes are service-role only.

## Files touched

Frontend
- `src/components/MediaLightbox.tsx` — trigger dispatch after positive-tag insert; allow editing the tag's `note` inline so the operator comment reaches WhatsApp.
- `src/pages/WhatsAppAlerts.tsx` — new "Positive-incident alerts" section.
- `src/lib/webhookStore.ts` (or a new `positiveAlertStore.ts`) — read/write helpers for the three new `whatsapp_settings` fields.

Backend
- Migration: add three columns to `whatsapp_settings`, create `positive_alert_dispatches` with GRANTs + RLS.
- New edge function: `supabase/functions/positive-alert-dispatch/index.ts`.

No changes to the Mudslide listener (`scripts/mudslide-listener/listener.mjs`) — it already exposes `POST /send` and `GET /groups` that this feature reuses.

## Applies to
Self-hosted stack only (that's where the Mudslide listener and `whatsapp_settings.mudslide_url` live). Say the word if you also want the migration replayed on the Lovable Cloud instance.
