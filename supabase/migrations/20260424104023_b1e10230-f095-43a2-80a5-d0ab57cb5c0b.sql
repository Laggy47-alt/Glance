ALTER TABLE public.daily_report_settings
  ADD COLUMN IF NOT EXISTS smtp_host text,
  ADD COLUMN IF NOT EXISTS smtp_port integer NOT NULL DEFAULT 587,
  ADD COLUMN IF NOT EXISTS smtp_username text,
  ADD COLUMN IF NOT EXISTS smtp_password text,
  ADD COLUMN IF NOT EXISTS smtp_secure text NOT NULL DEFAULT 'starttls';
-- smtp_secure values: 'none' | 'starttls' | 'tls'