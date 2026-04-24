CREATE TABLE public.camera_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL,
  camera text NOT NULL,
  online boolean NOT NULL,
  since timestamptz NOT NULL DEFAULT now(),
  last_checked timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, camera)
);

ALTER TABLE public.camera_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view camera_status" ON public.camera_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins write camera_status" ON public.camera_status FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins update camera_status" ON public.camera_status FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins delete camera_status" ON public.camera_status FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_camera_status_instance ON public.camera_status(instance_id);