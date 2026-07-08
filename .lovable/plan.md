## What we're shipping

1. **Diagnose the 0-ping 500s** — already patched `dispatch-ping` to log every step and return `detail` in the error body, and the responder app now surfaces `detail` in its on-screen log. Redeploy `dispatch-ping` and the next failed ping tells us exactly which DB call is choking (likely the `dispatch_location_pings` insert — see step 4).
2. **Push notifications** — use `@capacitor/local-notifications` fired from the poll loop. This is the right fit here: no FCM/Firebase account, no server-side push infra, works on self-hosted, and reliable within the existing 10–15 s poll cadence. Alert fires the moment poll sees a new dispatch id or a status change.
3. **Alert payload on the phone** — when the operator dispatches from a Wall alert, snapshot the alert into `dispatches.alert_payload` (jsonb). The phone reads it via `dispatch-poll` and shows it on the status view.

## Backend changes

**Migration (both self-hosted `ragpwpshriqnieniaapx` and Lovable Cloud `bgczubehzofjvjenozof`):**

```sql
alter table public.dispatches
  add column if not exists alert_payload jsonb;
-- source / source_ref already exist and cover source_kind + source_id.
grant select, insert, update on public.dispatches to authenticated;
```

Reason for reusing existing columns: `dispatches` already has `source` (text) and `source_ref` (text). Those are functionally the `source_kind` + `source_id` you approved — no need to duplicate. `alert_payload` is the new one.

**Edge functions:**
- `dispatch-ping`: hardened with per-step error logging + JSON `detail` (done in this turn).
- `dispatch-poll`: include `alert_payload` in the returned dispatch object.

## Frontend changes

**`src/components/DispatchDialog.tsx`**
- New optional prop `alertPayload?: { site, camera, label, ts, snapshot_url? }`.
- Insert it into `dispatches.alert_payload` on submit.

**`src/pages/Wall.tsx`**
- When opening the dispatch dialog for an alert, pass `alertPayload` built from `dispatchFor` (site, camera, label, ts, snapshot URL from `dispatchFor.snapshot`).

## Responder app changes (`apps/responder-android`)

**`package.json`** — add `@capacitor/local-notifications`.

**`src/main.ts`**
- Track `lastDispatchId` and `lastStatus` in memory.
- When poll returns a dispatch whose id differs from `lastDispatchId`, or status transitions to `pending`/`en_route`, fire a local notification: title = priority + site name, body = alert label or "New dispatch".
- Render `alert_payload` in the status view: alert text line + snapshot `<img>` if URL present. Fetches with the anon key headers if needed; snapshot URLs from media_items are already served through the Supabase storage/media path.

**`src/api.ts`** — extend `PollResult.dispatch` with `alert_payload?: { site, camera, label, ts, snapshot_url? }`.

**`index.html`** — add a `#alertPayload` block (hidden by default) with an `<img>` slot and a text slot.

**Android permission** — `POST_NOTIFICATIONS` is already listed in the manifest per README, so no manifest edit needed. Plugin will prompt on first fire.

## What you'll do after I ship

```bash
# 1. Apply the migration on both backends
psql "$SELF_HOSTED_URL" -f self-hosted-migrations/20260708_dispatch_alert_payload.sql
psql "$CLOUD_URL"       -f self-hosted-migrations/20260708_dispatch_alert_payload.sql

# 2. Deploy edge functions to self-hosted
supabase functions deploy dispatch-ping dispatch-poll

# 3. Rebuild the responder APK
cd apps/responder-android
npm install                # picks up @capacitor/local-notifications
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

Sideload the new APK, re-pair, create a dispatch from a Wall alert, and you should see the alert card + snapshot on the phone and a heads-up notification.

## Why local notifications, not FCM

- **No external account required** — FCM needs a Firebase project + server key + a secret on the backend. Local notifications work out of the box on any self-hosted stack.
- **The polling channel already exists** — you already accept a 10–15 s worst-case latency, so wake-from-doze via FCM buys little.
- **Escape hatch** — if you later need instant wake or notifications while the app is killed, swapping in FCM is additive: `dispatch-state`/dispatch creation trigger fires an FCM message, everything else stays.

If you'd rather go FCM up-front, say so and I'll wire that path instead (needs your Firebase server key).
