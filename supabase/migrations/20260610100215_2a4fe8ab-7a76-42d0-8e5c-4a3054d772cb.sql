ALTER TABLE public.whatsapp_settings ADD COLUMN IF NOT EXISTS daily_broadcast_template TEXT; UPDATE public.whatsapp_settings SET daily_broadcast_template = 'Hey there! 👋😊

I''m Glance, your friendly ABC CCTV sidekick! 🛡️🤖

Keep an eye out for my updates — I''ll ping you whenever something needs attention onsite. 🔔🔧

Cheers for now! 🎉👍' WHERE daily_broadcast_template IS NULL;