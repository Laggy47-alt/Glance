-- Dispatch completion feedback (operator-filled) and alert-media link.
-- Apply on self-hosted:
--   docker compose exec -T db psql -U postgres -d postgres < self-hosted-migrations/20260708_dispatch_feedback.sql

alter table public.dispatches
  add column if not exists feedback_outcome text
    check (feedback_outcome in ('false_alarm','genuine','resolved','other')),
  add column if not exists feedback_action text
    check (feedback_action in ('patrol','arrest','saps_called','none','other')),
  add column if not exists feedback_notes text,
  add column if not exists feedback_damage text,
  add column if not exists feedback_submitted_at timestamptz,
  add column if not exists feedback_submitted_by uuid references auth.users(id),
  add column if not exists alert_media_ids uuid[];

create index if not exists dispatches_completed_pending_feedback_idx
  on public.dispatches (organization_id, completed_at)
  where status = 'completed' and feedback_submitted_at is null;
