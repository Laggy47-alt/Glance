ALTER TABLE public.media_items ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_media_items_archived ON public.media_items(archived);