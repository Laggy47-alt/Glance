drop index if exists public.webhook_events_frigate_event_id_key;
alter table public.webhook_events
  add constraint webhook_events_frigate_event_id_key unique (frigate_event_id);