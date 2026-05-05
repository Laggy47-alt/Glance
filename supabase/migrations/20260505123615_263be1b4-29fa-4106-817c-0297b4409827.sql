-- Customer-authored instructions for operators when a camera/NVR is offline.
-- camera = NULL means the instruction applies to the entire NVR (default),
-- a specific camera value overrides the NVR default for that camera.
CREATE TABLE public.customer_offline_instructions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  instance_id UUID NOT NULL,
  camera TEXT,
  instructions TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID
);

CREATE UNIQUE INDEX customer_offline_instructions_nvr_uniq
  ON public.customer_offline_instructions (user_id, instance_id)
  WHERE camera IS NULL;

CREATE UNIQUE INDEX customer_offline_instructions_cam_uniq
  ON public.customer_offline_instructions (user_id, instance_id, camera)
  WHERE camera IS NOT NULL;

CREATE INDEX customer_offline_instructions_inst_idx
  ON public.customer_offline_instructions (instance_id);

ALTER TABLE public.customer_offline_instructions ENABLE ROW LEVEL SECURITY;

-- Customers manage their own
CREATE POLICY "customers manage own offline instructions"
  ON public.customer_offline_instructions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND user_has_instance(auth.uid(), instance_id));

-- Admins manage all
CREATE POLICY "admins manage offline instructions"
  ON public.customer_offline_instructions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Any authenticated user (operators) can read so popups can display
CREATE POLICY "authenticated read offline instructions"
  ON public.customer_offline_instructions
  FOR SELECT TO authenticated
  USING (true);

-- Track which operator acknowledged which offline event so popup doesn't re-nag.
CREATE TABLE public.offline_instruction_acks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  instance_id UUID NOT NULL,
  camera TEXT NOT NULL,
  since TIMESTAMP WITH TIME ZONE NOT NULL,
  acknowledged_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, instance_id, camera, since)
);

ALTER TABLE public.offline_instruction_acks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own acks"
  ON public.offline_instruction_acks
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER tr_customer_offline_instructions_updated
  BEFORE UPDATE ON public.customer_offline_instructions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();