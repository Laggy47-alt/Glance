CREATE TABLE public.camera_arm_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  camera text NOT NULL,
  weekday smallint NOT NULL,
  arm_time time,
  disarm_time time,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT camera_arm_schedules_weekday_chk CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT camera_arm_schedules_unique UNIQUE (user_id, instance_id, camera, weekday)
);

CREATE INDEX camera_arm_schedules_lookup_idx
  ON public.camera_arm_schedules (instance_id, camera, weekday)
  WHERE enabled;

ALTER TABLE public.camera_arm_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read schedules"
  ON public.camera_arm_schedules FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admins manage schedules"
  ON public.camera_arm_schedules FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "customers manage own schedules"
  ON public.camera_arm_schedules FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND user_has_camera(auth.uid(), instance_id, camera)
  );

CREATE TRIGGER camera_arm_schedules_set_updated_at
  BEFORE UPDATE ON public.camera_arm_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Track the last applied schedule action to avoid re-applying on every cron tick
CREATE TABLE public.camera_arm_schedule_runs (
  instance_id uuid NOT NULL,
  camera text NOT NULL,
  last_action text NOT NULL,
  last_run_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, camera)
);

ALTER TABLE public.camera_arm_schedule_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read schedule runs"
  ON public.camera_arm_schedule_runs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admins manage schedule runs"
  ON public.camera_arm_schedule_runs FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));