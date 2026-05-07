
-- =========================================================================
-- PHASE 1: Multi-tenancy schema, helpers, backfill
-- =========================================================================

-- 1. Add super_admin to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
