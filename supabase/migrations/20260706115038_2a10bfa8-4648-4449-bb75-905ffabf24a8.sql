-- Responders (people who go on callouts)
CREATE TABLE IF NOT EXISTS public.responders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  role text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.responders TO authenticated;
GRANT ALL ON public.responders TO service_role;
ALTER TABLE public.responders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "responders_org_all" ON public.responders FOR ALL
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE TRIGGER responders_updated_at
  BEFORE UPDATE ON public.responders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_responders_org ON public.responders(organization_id);

-- Vehicles (dispatch vehicles, optionally assigned to a responder)
CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plate text NOT NULL,
  make text,
  model text,
  color text,
  responder_id uuid REFERENCES public.responders(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
GRANT ALL ON public.vehicles TO service_role;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicles_org_all" ON public.vehicles FOR ALL
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE TRIGGER vehicles_updated_at
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_vehicles_org ON public.vehicles(organization_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_responder ON public.vehicles(responder_id);

-- Link callouts to a responder / vehicle
ALTER TABLE public.callout_requests
  ADD COLUMN IF NOT EXISTS assigned_responder_id uuid REFERENCES public.responders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_callouts_responder ON public.callout_requests(assigned_responder_id);
CREATE INDEX IF NOT EXISTS idx_callouts_vehicle ON public.callout_requests(assigned_vehicle_id);