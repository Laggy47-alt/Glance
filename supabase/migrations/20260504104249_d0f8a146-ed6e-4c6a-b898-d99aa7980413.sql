-- 1. Add 'customer' to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'customer';

-- 2. Customer ↔ NVR assignment
CREATE TABLE public.customer_nvr_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (user_id, instance_id)
);
ALTER TABLE public.customer_nvr_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage assignments"
  ON public.customer_nvr_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "customers view own assignments"
  ON public.customer_nvr_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Helper function: does this user have access to this instance?
CREATE OR REPLACE FUNCTION public.user_has_instance(_user_id uuid, _instance_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customer_nvr_assignments
    WHERE user_id = _user_id AND instance_id = _instance_id
  );
$$;

-- 3. Camera armed state
CREATE TABLE public.camera_armed_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL,
  camera text NOT NULL,
  armed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (instance_id, camera)
);
ALTER TABLE public.camera_armed_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone authenticated reads armed state"
  ON public.camera_armed_state FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "admins write armed state"
  ON public.camera_armed_state FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "customers insert armed state for own nvrs"
  ON public.camera_armed_state FOR INSERT TO authenticated
  WITH CHECK (public.user_has_instance(auth.uid(), instance_id));

CREATE POLICY "customers update armed state for own nvrs"
  ON public.camera_armed_state FOR UPDATE TO authenticated
  USING (public.user_has_instance(auth.uid(), instance_id))
  WITH CHECK (public.user_has_instance(auth.uid(), instance_id));

CREATE TRIGGER tr_camera_armed_updated
  BEFORE UPDATE ON public.camera_armed_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.camera_armed_state;

-- 4. Callout requests
CREATE TABLE public.callout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL,
  camera text,
  reason text,
  status text NOT NULL DEFAULT 'open', -- open | acknowledged | resolved
  requested_by uuid,
  requester_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  admin_note text
);
ALTER TABLE public.callout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read all callouts"
  ON public.callout_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "customers read own callouts"
  ON public.callout_requests FOR SELECT TO authenticated
  USING (requested_by = auth.uid());

CREATE POLICY "customers create callouts for own nvrs"
  ON public.callout_requests FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND public.user_has_instance(auth.uid(), instance_id)
  );

CREATE POLICY "admins update callouts"
  ON public.callout_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete callouts"
  ON public.callout_requests FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.callout_requests;

-- 5. Callout notification settings (where admin emails go)
CREATE TABLE public.callout_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipients text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL DEFAULT 'Callout request — {{nvr_name}}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.callout_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone authenticated reads callout settings"
  ON public.callout_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins manage callout settings"
  ON public.callout_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.callout_settings (recipients) VALUES ('{}');

-- 6. Allow customers to view the NVRs they're assigned to and related events
-- Frigate instances currently have permissive public RLS — leave as is (already broad).
-- Webhook events also already public. We rely on application-level filtering for customer UI.