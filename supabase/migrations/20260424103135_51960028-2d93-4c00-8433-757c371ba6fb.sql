
-- Per-NVR daily report config
CREATE TABLE public.daily_report_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.frigate_instances(id) ON DELETE CASCADE,
  recipients text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL DEFAULT 'Daily Report — {{nvr_name}} — {{date}}',
  body_template text NOT NULL DEFAULT E'Daily report for {{nvr_name}}\n\nDate: {{date}}\n\nCameras online: {{cameras_online_count}}\n{{cameras_online_list}}\n\nCameras offline: {{cameras_offline_count}}\n{{cameras_offline_list}}\n\nPositive incidents (last 24h): {{positive_incidents_count}}\n{{positive_incidents_list}}',
  enabled boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instance_id)
);

ALTER TABLE public.daily_report_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view configs" ON public.daily_report_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins insert configs" ON public.daily_report_configs FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update configs" ON public.daily_report_configs FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete configs" ON public.daily_report_configs FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_daily_report_configs_updated
  BEFORE UPDATE ON public.daily_report_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Global daily report settings (single row)
CREATE TABLE public.daily_report_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_name text NOT NULL DEFAULT 'ABC Glance',
  from_email text NOT NULL DEFAULT 'onboarding@resend.dev',
  send_hour_utc smallint NOT NULL DEFAULT 6, -- 08:00 SAST = 06:00 UTC
  send_minute_utc smallint NOT NULL DEFAULT 0,
  reply_to text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.daily_report_settings (id) VALUES (gen_random_uuid());

ALTER TABLE public.daily_report_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view settings" ON public.daily_report_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins update settings" ON public.daily_report_settings FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_daily_report_settings_updated
  BEFORE UPDATE ON public.daily_report_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Send log
CREATE TABLE public.daily_report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid REFERENCES public.daily_report_configs(id) ON DELETE SET NULL,
  instance_id uuid,
  recipients text[] NOT NULL DEFAULT '{}',
  status text NOT NULL, -- 'sent' | 'failed' | 'skipped'
  error text,
  subject text,
  sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_report_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view runs" ON public.daily_report_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "service insert runs" ON public.daily_report_runs FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));

-- Enable cron + http for scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
