-- Snapshot of the originating alert (camera, label, timestamp, snapshot URL)
-- so the responder phone can display exactly what to look for.
-- Apply on both self-hosted and Lovable Cloud.
alter table public.dispatches
  add column if not exists alert_payload jsonb;

grant select, insert, update on public.dispatches to authenticated;
