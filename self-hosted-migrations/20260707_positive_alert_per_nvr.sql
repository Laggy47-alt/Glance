-- Per-NVR positive-alert WhatsApp group override.
--
-- Stores a mapping of instance_id (frigate/unifi/hikvision instances all use uuid PKs
-- and never collide) -> group JID. When an operator tags a media item as positive,
-- the dispatcher looks up the source NVR's instance_id in this map first; if present
-- and non-empty it sends to that group instead of the org-wide positive_alert_group_jid.

ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS positive_alert_group_jids jsonb NOT NULL DEFAULT '{}'::jsonb;
