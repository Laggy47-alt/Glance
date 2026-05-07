
-- 2. organizations table
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 3. organization_members (user belongs to an org with a role within it)
CREATE TYPE public.org_member_role AS ENUM ('admin', 'customer');

CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.org_member_role NOT NULL DEFAULT 'customer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX idx_org_members_org ON public.organization_members(organization_id);

-- 4. Helper functions
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.user_org_ids(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.organization_members WHERE user_id = _user_id
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id uuid, _org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE user_id = _user_id AND organization_id = _org_id AND role = 'admin'
      )
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE user_id = _user_id AND organization_id = _org_id
      )
$$;

-- Update has_role so super_admin passes 'admin' checks transparently
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
      OR ( _role = 'admin'::app_role
           AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin'::app_role) )
$$;

-- 5. Add organization_id to all tenant-scoped tables (nullable for now, backfilled below)
ALTER TABLE public.frigate_instances        ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.webhook_sources          ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.webhook_events           ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.media_items              ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.media_tags               ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.event_audit_log          ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.callout_requests         ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.callout_settings         ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.daily_report_configs     ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.daily_report_runs        ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.daily_report_settings    ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.camera_arm_schedules     ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.camera_arm_schedule_runs ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.camera_arm_audit         ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.camera_armed_state       ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.camera_status            ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.customer_nvr_assignments ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.customer_camera_assignments ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.customer_offline_instructions ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.offline_instruction_acks ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.auto_read_rules          ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.app_settings             ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 6. Create the legacy "ABC" org and backfill all data into it
DO $$
DECLARE
  abc_id UUID;
  bootstrap_admin UUID;
BEGIN
  INSERT INTO public.organizations (slug, name) VALUES ('abc-2026', 'ABC') RETURNING id INTO abc_id;

  UPDATE public.frigate_instances              SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.webhook_sources                SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.webhook_events                 SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.media_items                    SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.media_tags                     SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.event_audit_log                SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.callout_requests               SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.callout_settings               SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.daily_report_configs           SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.daily_report_runs              SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.daily_report_settings          SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.camera_arm_schedules           SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.camera_arm_schedule_runs       SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.camera_arm_audit               SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.camera_armed_state             SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.camera_status                  SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.customer_nvr_assignments       SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.customer_camera_assignments    SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.customer_offline_instructions  SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.offline_instruction_acks       SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.auto_read_rules                SET organization_id = abc_id WHERE organization_id IS NULL;
  UPDATE public.app_settings                   SET organization_id = abc_id WHERE organization_id IS NULL;

  -- Find bootstrap admin (username = 'admin')
  SELECT user_id INTO bootstrap_admin FROM public.profiles WHERE username = 'admin' LIMIT 1;

  -- All existing customers + admins go into ABC.
  -- Customers as 'customer', admins (excluding bootstrap) as 'admin' within ABC.
  INSERT INTO public.organization_members (organization_id, user_id, role)
  SELECT abc_id, p.user_id,
         CASE WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.user_id AND ur.role = 'admin') THEN 'admin'::public.org_member_role
              ELSE 'customer'::public.org_member_role END
  FROM public.profiles p
  WHERE p.user_id <> COALESCE(bootstrap_admin, '00000000-0000-0000-0000-000000000000'::uuid)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  -- Promote bootstrap admin to super_admin (also remove its plain admin role to keep things clean)
  IF bootstrap_admin IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (bootstrap_admin, 'super_admin') ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 7. Rewrite auth emails so usernames are unique per-org going forward
--    Existing users: customers/admins → @abc-2026.local.app, bootstrap admin → @super.local.app
DO $$
DECLARE
  bootstrap_admin UUID;
BEGIN
  SELECT user_id INTO bootstrap_admin FROM public.profiles WHERE username = 'admin' LIMIT 1;

  -- Move bootstrap admin email
  IF bootstrap_admin IS NOT NULL THEN
    UPDATE auth.users
       SET email = 'admin@super.local.app',
           raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('org_slug', 'super', 'username', 'admin')
     WHERE id = bootstrap_admin;
  END IF;

  -- Move all other users into abc-2026 namespace
  UPDATE auth.users u
     SET email = lower(p.username) || '@abc-2026.local.app',
         raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('org_slug', 'abc-2026', 'username', p.username)
    FROM public.profiles p
   WHERE u.id = p.user_id
     AND u.id <> COALESCE(bootstrap_admin, '00000000-0000-0000-0000-000000000000'::uuid);
END $$;

-- 8. Make organization_id NOT NULL on tenant tables (now that they're backfilled)
ALTER TABLE public.frigate_instances              ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.webhook_sources                ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.callout_requests               ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.callout_settings               ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.daily_report_configs           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.daily_report_settings          ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.camera_arm_schedules           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.camera_armed_state             ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.camera_status                  ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.customer_nvr_assignments       ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.customer_camera_assignments    ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.customer_offline_instructions  ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.offline_instruction_acks       ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.app_settings                   ALTER COLUMN organization_id SET NOT NULL;
-- (events / media / audit / runs / arm_audit / arm_schedule_runs / auto_read_rules left nullable; backfilled but tolerant of legacy rows)

-- 9. Indexes
CREATE INDEX idx_frigate_org   ON public.frigate_instances(organization_id);
CREATE INDEX idx_sources_org   ON public.webhook_sources(organization_id);
CREATE INDEX idx_events_org    ON public.webhook_events(organization_id);
CREATE INDEX idx_media_org     ON public.media_items(organization_id);
CREATE INDEX idx_callouts_org  ON public.callout_requests(organization_id);
CREATE INDEX idx_dr_configs_org ON public.daily_report_configs(organization_id);
CREATE INDEX idx_arm_sched_org ON public.camera_arm_schedules(organization_id);
CREATE INDEX idx_cam_state_org ON public.camera_armed_state(organization_id);
CREATE INDEX idx_cam_status_org ON public.camera_status(organization_id);
CREATE INDEX idx_cust_nvr_org  ON public.customer_nvr_assignments(organization_id);
CREATE INDEX idx_cust_cam_org  ON public.customer_camera_assignments(organization_id);

-- 10. RLS for new tables
CREATE POLICY "super admin full org access"
  ON public.organizations FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "members can read their orgs"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), id));

CREATE POLICY "super admin manages members"
  ON public.organization_members FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "org admins manage own org members"
  ON public.organization_members FOR ALL TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id))
  WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "members read own org membership"
  ON public.organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 11. Public view for login: lookup org by slug (without exposing membership)
CREATE OR REPLACE FUNCTION public.lookup_org_by_slug(_slug text)
RETURNS TABLE(id uuid, slug text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, slug, name FROM public.organizations WHERE slug = lower(_slug) LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.lookup_org_by_slug(text) TO anon, authenticated;
