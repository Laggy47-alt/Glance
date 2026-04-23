
CREATE TABLE public.webhook_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  secret text NOT NULL,
  color text NOT NULL DEFAULT '#06b6d4',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.webhook_sources(id) ON DELETE CASCADE,
  topic text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_text text,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  read boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_events_ts ON public.webhook_events(ts DESC);
CREATE INDEX idx_webhook_events_source ON public.webhook_events(source_id);

CREATE TABLE public.auto_read_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.webhook_sources(id) ON DELETE CASCADE,
  pattern text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.media_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.webhook_sources(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.webhook_events(id) ON DELETE CASCADE,
  kind text NOT NULL,
  url text NOT NULL,
  camera text,
  topic text,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_ts ON public.media_items(ts DESC);

ALTER TABLE public.webhook_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_read_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_items ENABLE ROW LEVEL SECURITY;

-- Public access (no auth in this app)
CREATE POLICY "public read sources" ON public.webhook_sources FOR SELECT USING (true);
CREATE POLICY "public write sources" ON public.webhook_sources FOR INSERT WITH CHECK (true);
CREATE POLICY "public update sources" ON public.webhook_sources FOR UPDATE USING (true);
CREATE POLICY "public delete sources" ON public.webhook_sources FOR DELETE USING (true);

CREATE POLICY "public read events" ON public.webhook_events FOR SELECT USING (true);
CREATE POLICY "public write events" ON public.webhook_events FOR INSERT WITH CHECK (true);
CREATE POLICY "public update events" ON public.webhook_events FOR UPDATE USING (true);
CREATE POLICY "public delete events" ON public.webhook_events FOR DELETE USING (true);

CREATE POLICY "public read rules" ON public.auto_read_rules FOR SELECT USING (true);
CREATE POLICY "public write rules" ON public.auto_read_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "public update rules" ON public.auto_read_rules FOR UPDATE USING (true);
CREATE POLICY "public delete rules" ON public.auto_read_rules FOR DELETE USING (true);

CREATE POLICY "public read media" ON public.media_items FOR SELECT USING (true);
CREATE POLICY "public write media" ON public.media_items FOR INSERT WITH CHECK (true);
CREATE POLICY "public delete media" ON public.media_items FOR DELETE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.webhook_sources;
ALTER PUBLICATION supabase_realtime ADD TABLE public.webhook_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.auto_read_rules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.media_items;
ALTER TABLE public.webhook_events REPLICA IDENTITY FULL;
ALTER TABLE public.media_items REPLICA IDENTITY FULL;
ALTER TABLE public.webhook_sources REPLICA IDENTITY FULL;
