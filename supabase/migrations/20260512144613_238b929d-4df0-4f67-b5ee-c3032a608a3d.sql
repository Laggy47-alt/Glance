ALTER TABLE public.daily_report_settings
  ALTER COLUMN smtp_host SET DEFAULT 'smtp.example.com',
  ALTER COLUMN smtp_port SET DEFAULT 587,
  ALTER COLUMN smtp_secure SET DEFAULT 'starttls',
  ALTER COLUMN smtp_username SET DEFAULT 'no-reply@example.com',
  ALTER COLUMN smtp_password SET DEFAULT 'changeme';