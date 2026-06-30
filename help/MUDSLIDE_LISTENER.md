# Mudslide-replacement WhatsApp bridge (incoming + outgoing)

This single Node process replaces the old split setup (Mudslide CLI for sending
+ a separate Baileys listener for receiving). One Baileys socket handles both:

- **Receiving** — subscribes to `messages.upsert` and POSTs each incoming
  WhatsApp message to the `whatsapp-incoming` edge function (Reply inbox).
- **Sending** — exposes `POST /send` and `GET /me` on `127.0.0.1:3000`,
  matching the HTTP API the `escalate-offline-whatsapp` and
  `whatsapp-heartbeat` edge functions already call.

> ## Why one process?
> Two long-lived sockets sharing the same WhatsApp auth fight for the linked
> device slot and trigger an endless `conflict: replaced` reconnect loop. WA
> only allows one active socket per linked device — so we run one.

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
# Incoming → edge function
WEBHOOK_URL=https://<your-supabase-host>/functions/v1/whatsapp-incoming
WEBHOOK_SECRET=<value from whatsapp_settings.incoming_webhook_secret>
ORG_ID=<your organization_id uuid>
SUPABASE_ANON_KEY=<anon/publishable key>

# Outgoing HTTP API (called by escalate-offline-whatsapp + whatsapp-heartbeat)
LISTEN_HOST=127.0.0.1
LISTEN_PORT=3000
# Must equal whatsapp_settings.mudslide_token in the DB.
SEND_TOKEN=<long random token>

# Baileys auth — must be the SAME folder Mudslide used for sending.
MUDSLIDE_AUTH_DIR=/var/lib/mudslide/.mudslide

# Optional filters
INCLUDE_GROUPS=1
INCLUDE_DMS=1
INCLUDE_FROM_ME=0
```

> Reuse the existing Mudslide auth folder so you don't have to re-pair.
> Find it by checking the `-c` flag of the old Mudslide service (or the
> default `~/.mudslide` of the user it ran as) and point
> `MUDSLIDE_AUTH_DIR` at it.

## Switch the sender over

1. **Stop and disable the old Mudslide sender** so only this process holds
   the WhatsApp socket:

   ```bash
   sudo systemctl stop mudslide
   sudo systemctl disable mudslide
   # or, if it wasn't a service:
   sudo kill <pid-of-/opt/mudslide/server.js>
   ```

2. **Point NGINX (or your `mudslide_url`) at this process.** It listens on
   `127.0.0.1:3000` by default, exposing the same `POST /send` and `GET /me`
   endpoints the edge functions expect — no NGINX changes needed if your
   existing reverse-proxy already forwards `https://wa.example.com/*` to
   `127.0.0.1:3000`.

3. **Restart the service:**

   ```bash
   sudo cp mudslide-listener.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now mudslide-listener
   sudo journalctl -u mudslide-listener -f
   ```

4. **Verify both directions:**

   ```bash
   # health (no auth)
   curl -s http://127.0.0.1:3000/health
   # me (requires SEND_TOKEN)
   curl -s -H "Authorization: Bearer $SEND_TOKEN" http://127.0.0.1:3000/me
   # send to self
   curl -s -X POST http://127.0.0.1:3000/send \
     -H "Authorization: Bearer $SEND_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"to":"me","message":"merged bridge test"}'
   ```

   Then send a WhatsApp message TO the linked number and watch for
   `[webhook] ok <jid>` in the journal.

## HTTP API

| Method | Path     | Auth                   | Body / Response |
| ------ | -------- | ---------------------- | --------------- |
| GET    | `/health`| —                      | `{ ok, connected }` |
| GET    | `/me`    | `Bearer SEND_TOKEN`    | `{ user }` from the socket |
| POST   | `/send`  | `Bearer SEND_TOKEN`    | `{ to, message }` → `{ ok, id, to }`. `to` accepts `"me"`, plain digits (`27821234567`), or a full JID (`...@s.whatsapp.net` / `...@g.us`). |

## Troubleshooting

- **`conflict: replaced` loop** — another process is using the same auth
  folder. Stop the old Mudslide sender (step 1 above).
- **401 from webhook** — `WEBHOOK_SECRET` doesn't match
  `whatsapp_settings.incoming_webhook_secret` for that org.
- **401 from `/send`** — `SEND_TOKEN` in `.env` doesn't match
  `whatsapp_settings.mudslide_token` in the DB.
- **400 "WhatsApp settings not configured"** — wrong `ORG_ID`.
- **Logged-out loop** — re-pair with `npx mudslide login` against the same
  `MUDSLIDE_AUTH_DIR`, then restart the service.
