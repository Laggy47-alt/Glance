# Mudslide incoming-message listener

Mudslide's CLI is send-only. This tiny Baileys listener reuses Mudslide's
existing auth session and POSTs incoming WhatsApp messages (groups + DMs)
to the app's `whatsapp-incoming` edge function so they appear in the inbox.

## Install on the server

```bash
sudo mkdir -p /opt/mudslide-listener
sudo cp listener.mjs package.json /opt/mudslide-listener/
sudo chown -R mudslide:mudslide /opt/mudslide-listener
cd /opt/mudslide-listener
sudo -u mudslide npm install --omit=dev
```

## Configure

Create `/opt/mudslide-listener/.env` (chmod 600, owned by `mudslide`):

```env
WEBHOOK_URL=https://<your-supabase-host>/functions/v1/whatsapp-incoming
WEBHOOK_SECRET=<value from whatsapp_settings.incoming_webhook_secret>
ORG_ID=<your organization_id uuid>
SUPABASE_ANON_KEY=<anon/publishable key>
# Optional — match Mudslide's -c cache folder. Default: /var/lib/mudslide/.mudslide
MUDSLIDE_AUTH_DIR=/var/lib/mudslide/.mudslide
INCLUDE_GROUPS=1
INCLUDE_DMS=1
INCLUDE_FROM_ME=0
```

> The listener shares the same auth folder Mudslide uses for `send`.
> Find it by checking the `-c` flag (or the default `~/.mudslide` of the
> `mudslide` user). Both processes can connect simultaneously — Baileys
> supports multi-device — but if you see auth churn, stop the Mudslide
> background sender while testing.

## Run as a service

```bash
sudo cp mudslide-listener.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mudslide-listener
sudo journalctl -u mudslide-listener -f
```

You should see `✅ Connected. Listening for incoming messages…`, then a
`[webhook] ok <jid>` line for each message that hits the inbox.

## Troubleshooting

- **401 from webhook** — `WEBHOOK_SECRET` doesn't match
  `whatsapp_settings.incoming_webhook_secret` for that org.
- **400 "WhatsApp settings not configured"** — wrong `ORG_ID`.
- **Logged-out loop** — re-pair Mudslide (`npx mudslide login`) so the
  auth folder is valid, then restart the service.
