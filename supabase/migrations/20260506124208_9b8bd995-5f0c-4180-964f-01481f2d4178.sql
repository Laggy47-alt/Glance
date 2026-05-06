
CREATE TABLE IF NOT EXISTS public.camera_arm_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL,
  camera text NOT NULL,
  action text NOT NULL CHECK (action IN ('arm','disarm')),
  source text NOT NULL CHECK (source IN ('manual','schedule')),
  actor uuid,
  actor_name text,
  note text,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS camera_arm_audit_inst_cam_ts_idx
  ON public.camera_arm_audit (instance_id, camera, ts DESC);
ALTER TABLE public.camera_arm_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read arm audit" ON public.camera_arm_audit
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert arm audit" ON public.camera_arm_audit
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admins delete arm audit" ON public.camera_arm_audit
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
