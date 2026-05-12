ALTER TABLE public.daily_report_settings
  ALTER COLUMN smtp_host DROP DEFAULT,
  ALTER COLUMN smtp_username DROP DEFAULT,
  ALTER COLUMN smtp_password DROP DEFAULT;
-- keep port=587 and smtp_secure='starttls' as sensible non-credential defaults
ALTER TABLE public.daily_report_settings
  ALTER COLUMN smtp_port SET DEFAULT 587,
  ALTER COLUMN smtp_secure SET DEFAULT 'starttls';