CREATE TABLE public.customer_camera_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  camera text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (user_id, instance_id, camera)
);

CREATE INDEX idx_cca_user_instance ON public.customer_camera_assignments(user_id, instance_id);

ALTER TABLE public.customer_camera_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage camera assignments"
  ON public.customer_camera_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "customers view own camera assignments"
  ON public.customer_camera_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Helper: does the customer have access to this specific camera?
-- Returns true if NVR is assigned AND either no per-camera filter exists,
-- or this camera is explicitly in the per-camera filter list.
CREATE OR REPLACE FUNCTION public.user_has_camera(_user_id uuid, _instance_id uuid, _camera text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.user_has_instance(_user_id, _instance_id)
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.customer_camera_assignments
        WHERE user_id = _user_id AND instance_id = _instance_id
      )
      OR EXISTS (
        SELECT 1 FROM public.customer_camera_assignments
        WHERE user_id = _user_id AND instance_id = _instance_id AND camera = _camera
      )
    );
$$;