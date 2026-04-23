-- Frigate instances
CREATE TABLE public.frigate_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  name text NOT NULL,
  base_url text NOT NULL,
  api_key text,
  color text NOT NULL DEFAULT '#3b82f6',
  enabled boolean NOT NULL DEFAULT true,
  poll_enabled boolean NOT NULL DEFAULT true,
  poll_interval_seconds integer NOT NULL DEFAULT 60,
  last_polled_at timestamptz,
  last_event_ts timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.frigate_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read frigate" ON public.frigate_instances FOR SELECT USING (true);
CREATE POLICY "public write frigate" ON public.frigate_instances FOR INSERT WITH CHECK (true);
CREATE POLICY "public update frigate" ON public.frigate_instances FOR UPDATE USING (true);
CREATE POLICY "public delete frigate" ON public.frigate_instances FOR DELETE USING (true);

-- Frigate-specific metadata on events & media
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS frigate_event_id text,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS camera text,
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'event';

ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS frigate_event_id text,
  ADD COLUMN IF NOT EXISTS instance_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_frigate_event_id_key
  ON public.webhook_events (frigate_event_id) WHERE frigate_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS frigate_instances_enabled_idx
  ON public.frigate_instances (enabled, poll_enabled);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.frigate_instances;