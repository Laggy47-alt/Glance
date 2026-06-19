-- Additive migration: support Frigate username/password (JWT) auth per instance.
-- Existing rows with only api_key keep working — the resolver in edge functions
-- prefers username/password when set, otherwise falls back to api_key.
--
-- Run on self-hosted Supabase:
--   psql "$SUPABASE_DB_URL" -f docs/migrations/004_frigate_auth.sql

ALTER TABLE public.frigate_instances
  ADD COLUMN IF NOT EXISTS auth_username        text,
  ADD COLUMN IF NOT EXISTS auth_password        text,
  ADD COLUMN IF NOT EXISTS auth_token_cache     text,
  ADD COLUMN IF NOT EXISTS auth_token_expires_at timestamptz;

COMMENT ON COLUMN public.frigate_instances.auth_username        IS 'Frigate UI username (0.14+ JWT auth). When set with auth_password, takes precedence over api_key.';
COMMENT ON COLUMN public.frigate_instances.auth_password        IS 'Frigate UI password. Treated as a secret at the same trust level as api_key.';
COMMENT ON COLUMN public.frigate_instances.auth_token_cache     IS 'Cached JWT from POST /api/login. Refreshed automatically before expiry.';
COMMENT ON COLUMN public.frigate_instances.auth_token_expires_at IS 'When the cached JWT becomes invalid (refreshed ~23h after login).';
