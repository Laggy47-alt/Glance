ALTER TABLE public.daily_report_configs
  ADD COLUMN IF NOT EXISTS send_times text[] NOT NULL DEFAULT ARRAY['08:00']::text[];