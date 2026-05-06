ALTER TABLE public.daily_report_configs DROP CONSTRAINT IF EXISTS daily_report_configs_instance_id_key;
ALTER TABLE public.daily_report_configs ADD COLUMN IF NOT EXISTS cameras text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.daily_report_configs ADD COLUMN IF NOT EXISTS label text;
CREATE INDEX IF NOT EXISTS daily_report_configs_instance_idx ON public.daily_report_configs(instance_id);