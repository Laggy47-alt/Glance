## Scope

Three linked features on the self-hosted stack (Supabase ref `ragpwpshriqnieniaapx`). No responder-app changes needed — feedback is operator-only, and GPS pings already work end-to-end; the fix is on the operator side.

---

## 1. GPS not showing on operator map

Root-cause candidates (top-down):
- `responder_devices` row exists but `last_latitude` never got written (`dispatch-ping` update swallowed).
- Row updates fine but the operator query filters it out (`.eq(organization_id)`, `revoked_at IS NULL`, `last_latitude IS NOT NULL`).
- Realtime subscription isn't wired for `UPDATE` on that row, so map only refreshes on other events.

Fix steps:
1. Add a **Devices panel** at the top of `Dispatches.tsx` that lists every paired device for the org — regardless of whether it has a fix yet — showing `label`, `responder`, `last_seen_at`, and `last_latitude/last_longitude` (or "no fix yet"). This makes the state obvious instead of the map silently hiding rows.
2. Remove the `.not("last_latitude", "is", null)` filter from the map query — draw a "no fix" chip for devices without coords, plot the ones that have them.
3. Confirm the realtime channel picks up `UPDATE` on `responder_devices` (already `event: "*"` — but add a `console.debug` on payload so we can see it firing in the browser network panel).
4. Small hardening on `dispatch-ping`: log the row-count returned by the update; if 0 rows matched, return a 500 with `device update matched 0 rows` so we know it's an RLS/id mismatch and not a silent miss.

---

## 2. Operator-filled feedback popup on completion

Flow: responder taps **Complete** → dispatch status becomes `completed` → operator's Dispatches page pops a **Feedback dialog** (does NOT auto-close the dispatch card until feedback is submitted).

Schema (new migration `self-hosted-migrations/20260708_dispatch_feedback.sql` + mirror `db/dispatch/003_dispatch_feedback.sql`):

```sql
alter table public.dispatches
  add column if not exists feedback_outcome text
    check (feedback_outcome in ('false_alarm','genuine','resolved','other')),
  add column if not exists feedback_action text
    check (feedback_action in ('patrol','arrest','saps_called','none','other')),
  add column if not exists feedback_notes text,
  add column if not exists feedback_damage text,
  add column if not exists feedback_submitted_at timestamptz,
  add column if not exists feedback_submitted_by uuid references auth.users(id);
```

New component `src/components/DispatchFeedbackDialog.tsx`:
- 4 fields matching your selection: **Outcome** (dropdown), **Action taken** (dropdown), **Free-text notes** (relayed from responder), **Damage / loss** (text).
- Submit writes the 4 columns + `feedback_submitted_at/by` and inserts a `dispatch_events` row with `kind='feedback_submitted'`.

Trigger in `Dispatches.tsx`:
- On realtime UPDATE where old.status != 'completed' AND new.status == 'completed' AND `feedback_submitted_at` is null → open dialog for that dispatch id.
- Also on initial page load: any completed dispatch without feedback shows a "Complete report" button in the row.

---

## 3. Auto-tag on dispatch + auto-clear on feedback + Dispatch Reports page

### 3a. Auto-tag as positive on dispatch

When a dispatch is created **from a Wall alert** (source `"other"` with a `sourceRef`), tag the underlying media as **positive** immediately.

Wall passes `sourceRef = dispatchFor.event?.id ?? dispatchFor.key`. The `event.id` is a `webhook_events.id`. `media_items.event_id` FKs to `webhook_events.id`, so we resolve media by that.

Extend `DispatchDialog.submit()`:
```
if (sourceRef && dispatch created) {
  // find media_items where event_id = sourceRef
  // insert into media_tags (media_id, tag='positive', note='auto: dispatch <id>') for each
  // also store dispatch_id → media_id link so report can join back
}
```

Also add `alert_media_ids uuid[]` column on `dispatches` (migration above) so the report page can pull the snapshot(s) without re-resolving.

### 3b. Auto-clear alert from Wall on completion

You picked "keep alert visible until responder completes". On completion (responder taps Complete OR operator submits feedback), we already have the tag; add a second auto-tag `dispatched_completed` and update `media_items.archived = true` — the Wall filters out archived items. Do this in the **feedback submit** handler so it doubles as the "case closed" step.

### 3c. Dispatch Reports page

New route `/dispatch-reports` → `src/pages/DispatchReports.tsx`. Sidebar entry under Dispatches with `FileText` icon.

List view:
- All dispatches (default: last 30 days) with columns: dispatched at, site, responder, priority, outcome, elapsed, has-feedback badge.
- Click row → detail/report view.

Detail view (printable, single column, `window.print`-friendly):
- Header: site name, dispatched-at, responder, vehicle, priority.
- **Initial alert section** — snapshot image (from `alert_payload.snapshot_url` or `alert_media_ids`), label, camera, timestamp.
- **Timeline** — every `dispatch_events` row (created / acknowledged / arrived / completed / feedback_submitted) with time-since-dispatch.
- **Route** — small Leaflet map of `dispatch_location_pings` polyline + site marker (reuses existing map code).
- **Response times** — dispatched → ack, ack → arrived, arrived → completed.
- **Feedback** — the four fields.
- Export: "Print / Save PDF" button using browser print stylesheet.

---

## Technical layout

```text
supabase/functions/
  dispatch-ping/index.ts          # add matched-rows check
  dispatch-state/index.ts         # unchanged
db/dispatch/
  003_dispatch_feedback.sql       # new (self-hosted canonical)
self-hosted-migrations/
  20260708_dispatch_feedback.sql  # applied via psql on the box
src/
  pages/
    Dispatches.tsx                # devices panel, feedback trigger, "complete report" btn
    DispatchReports.tsx           # NEW list + detail
  components/
    AppSidebar.tsx                # add "Dispatch Reports" nav item
    DispatchFeedbackDialog.tsx    # NEW
    DispatchDialog.tsx            # auto-tag media_items on submit
  App.tsx                         # register /dispatch-reports route
```

## What the user runs

1. `git pull` on the self-hosted operator frontend.
2. Apply new migration:
   ```
   docker compose exec -T db psql -U postgres -d postgres < self-hosted-migrations/20260708_dispatch_feedback.sql
   ```
3. Redeploy edge functions (only `dispatch-ping` changed):
   ```
   supabase functions deploy dispatch-ping --project-ref ragpwpshriqnieniaapx --no-verify-jwt
   ```
4. Rebuild + publish operator frontend (`npm run build` → your normal deploy).
5. **No APK rebuild** — responder app is untouched.

## Open decision

You didn't answer the GPS-log question, so I'll go ahead with the "make it visible, harden the ping, log the update" approach in step 1 rather than guessing at a specific fix. Once you deploy this and open the Dispatches page you'll see either "device with no fix yet" (ping never landed) or coords (map filter was the issue), and we'll know exactly where to look next.
