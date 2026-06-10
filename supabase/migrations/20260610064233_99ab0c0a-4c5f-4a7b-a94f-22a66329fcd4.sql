
CREATE TABLE public.whatsapp_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  mudslide_url TEXT,
  mudslide_token TEXT,
  default_recipients TEXT[] NOT NULL DEFAULT '{}',
  alert_template TEXT NOT NULL DEFAULT '🚨 *{{nvr}}* — {{count}} camera(s) offline ≥ {{minutes}}m:
{{cameras}}',
  recovery_template TEXT NOT NULL DEFAULT '✅ *{{nvr}}* — {{camera}} back online',
  send_recovery BOOLEAN NOT NULL DEFAULT true,
  include_nvr_unreachable BOOLEAN NOT NULL DEFAULT true,
  batch_alerts BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_start TIME,
  quiet_end TIME,
  quiet_timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  max_alerts_per_hour INTEGER NOT NULL DEFAULT 30,
  cooldown_minutes INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_settings TO authenticated;
GRANT ALL ON public.whatsapp_settings TO service_role;

ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins manage whatsapp settings"
ON public.whatsapp_settings FOR ALL
TO authenticated
USING (public.can_admin_org(organization_id))
WITH CHECK (public.can_admin_org(organization_id));

CREATE TRIGGER whatsapp_settings_set_updated
BEFORE UPDATE ON public.whatsapp_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER whatsapp_settings_fill_org
BEFORE INSERT ON public.whatsapp_settings
FOR EACH ROW EXECUTE FUNCTION public.fill_organization_id();

ALTER TABLE public.frigate_instances
  ADD COLUMN IF NOT EXISTS whatsapp_alert_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_recipients TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS whatsapp_alert_minutes INTEGER;
