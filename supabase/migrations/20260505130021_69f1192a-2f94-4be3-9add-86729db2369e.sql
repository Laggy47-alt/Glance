-- Make schedules admin-managed (one per camera, not per-customer)
DROP POLICY IF EXISTS "customers manage own schedules" ON public.camera_arm_schedules;
DROP POLICY IF EXISTS "admins manage schedules" ON public.camera_arm_schedules;
DROP POLICY IF EXISTS "authenticated read schedules" ON public.camera_arm_schedules;

ALTER TABLE public.camera_arm_schedules DROP CONSTRAINT IF EXISTS camera_arm_schedules_unique;

-- Drop existing rows (none in production yet) so we can drop user_id
DELETE FROM public.camera_arm_schedules;

ALTER TABLE public.camera_arm_schedules DROP COLUMN IF EXISTS user_id;

ALTER TABLE public.camera_arm_schedules
  ADD CONSTRAINT camera_arm_schedules_unique UNIQUE (instance_id, camera, weekday);

CREATE POLICY "authenticated read schedules"
  ON public.camera_arm_schedules FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admins manage schedules"
  ON public.camera_arm_schedules FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));