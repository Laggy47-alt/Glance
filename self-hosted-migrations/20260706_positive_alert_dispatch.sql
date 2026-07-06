-- Positive-tag WhatsApp group alerts (self-hosted mirror of Lovable Cloud migration).
--
-- Adds three columns to whatsapp_settings for the new alert type and creates
-- an audit table so we can cooldown-dedupe and inspect dispatches.

ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS positive_alert_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS positive_alert_group_jid text,
  ADD COLUMN IF NOT EXISTS positive_alert_cooldown_seconds integer NOT NULL DEFAULT 60;

CREATE TABLE IF NOT EXISTS public.positive_alert_dispatches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  media_id uuid NOT NULL,
  tag_id uuid,
  group_jid text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS positive_alert_dispatches_media_idx
  ON public.positive_alert_dispatches (media_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS positive_alert_dispatches_org_idx
  ON public.positive_alert_dispatches (organization_id, sent_at DESC);

GRANT SELECT ON public.positive_alert_dispatches TO authenticated;
GRANT ALL ON public.positive_alert_dispatches TO service_role;

ALTER TABLE public.positive_alert_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org admins can view positive alert dispatches"
  ON public.positive_alert_dispatches;
CREATE POLICY "Org admins can view positive alert dispatches"
  ON public.positive_alert_dispatches
  FOR SELECT
  TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));
