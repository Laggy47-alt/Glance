ALTER TABLE public.unifi_instances
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.webhook_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_event_ts timestamptz,
  ADD COLUMN IF NOT EXISTS last_polled_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS poll_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_unifi_instances_source ON public.unifi_instances(source_id);
NOTIFY pgrst, 'reload schema';