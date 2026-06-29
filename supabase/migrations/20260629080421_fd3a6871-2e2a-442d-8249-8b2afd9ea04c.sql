
CREATE TABLE public.super_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  author_id uuid,
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.super_notes TO authenticated;
GRANT ALL ON public.super_notes TO service_role;

ALTER TABLE public.super_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read notes" ON public.super_notes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can insert notes" ON public.super_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can update notes" ON public.super_notes
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can delete notes" ON public.super_notes
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid()));

CREATE TRIGGER super_notes_set_updated_at
  BEFORE UPDATE ON public.super_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX super_notes_pinned_updated_idx ON public.super_notes (pinned DESC, updated_at DESC);
