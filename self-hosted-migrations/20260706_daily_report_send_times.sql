-- Multiple configurable send times per daily report config.
-- Apply on self-hosted Supabase:
--   docker compose cp self-hosted-migrations/20260706_daily_report_send_times.sql db:/tmp/m.sql
--   docker compose exec -T db psql -U postgres -d postgres -f /tmp/m.sql

ALTER TABLE public.daily_report_configs
  ADD COLUMN IF NOT EXISTS send_times text[] NOT NULL DEFAULT ARRAY['08:00']::text[];

-- Recommended: change your cron to run at least every 15 minutes so all
-- configured times fire on schedule (the edge function only sends configs
-- whose scheduled slot falls inside the current window and haven't already
-- been sent for that slot):
--
--   */15 * * * * curl -s -X POST \
--     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
--     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
--     https://supabase.example.com/functions/v1/daily-report-send > /dev/null
