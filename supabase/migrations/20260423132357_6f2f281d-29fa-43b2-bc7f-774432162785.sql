CREATE TABLE public.media_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id uuid NOT NULL REFERENCES public.media_items(id) ON DELETE CASCADE,
  tag text NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_tags_media_id ON public.media_tags(media_id);
CREATE INDEX idx_media_tags_tag ON public.media_tags(tag);

ALTER TABLE public.media_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read media tags"
  ON public.media_tags FOR SELECT
  USING (true);

CREATE POLICY "public insert media tags"
  ON public.media_tags FOR INSERT
  WITH CHECK (true);

CREATE POLICY "public delete media tags"
  ON public.media_tags FOR DELETE
  USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.media_tags;