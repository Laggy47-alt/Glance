CREATE TABLE public.event_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NULL,
  alert_key TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NULL,
  actor TEXT NULL,
  ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX event_audit_log_alert_key_idx ON public.event_audit_log (alert_key, ts DESC);
CREATE INDEX event_audit_log_event_id_idx ON public.event_audit_log (event_id, ts DESC);

ALTER TABLE public.event_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read audit" ON public.event_audit_log FOR SELECT USING (true);
CREATE POLICY "public write audit" ON public.event_audit_log FOR INSERT WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.event_audit_log;