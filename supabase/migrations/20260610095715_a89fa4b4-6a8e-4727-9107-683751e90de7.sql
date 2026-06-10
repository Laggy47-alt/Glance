ALTER TABLE public.whatsapp_settings
ADD COLUMN IF NOT EXISTS reply_footer text
DEFAULT E'Reply to this message to get in touch with our Technical Team 👨‍💻\nWe''ll get back to you as soon as possible! 🚀';

ALTER TABLE public.whatsapp_settings
ADD COLUMN IF NOT EXISTS incoming_webhook_secret text;

CREATE TABLE public.whatsapp_incoming_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sender text NOT NULL,
  sender_name text,
  message text NOT NULL,
  message_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  read boolean NOT NULL DEFAULT false,
  notes text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_incoming_messages TO authenticated;
GRANT ALL ON public.whatsapp_incoming_messages TO service_role;

ALTER TABLE public.whatsapp_incoming_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read incoming messages"
ON public.whatsapp_incoming_messages
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can update incoming messages"
ON public.whatsapp_incoming_messages
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can insert incoming messages"
ON public.whatsapp_incoming_messages
FOR INSERT
TO service_role
WITH CHECK (true);