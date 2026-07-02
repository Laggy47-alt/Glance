# Mudslide WhatsApp Listener — Commands & Functions Reference

Everything you need to run, pair, debug, and call the Mudslide-based WhatsApp bridge that ships in `scripts/mudslide-listener/`.

The listener is a **single Node process** that:

1. Holds one long-lived Baileys WhatsApp socket (uses the same auth dir as the `mudslide` CLI).
2. Forwards every incoming message to the `whatsapp-incoming` edge function.
3. Exposes a small HTTP API (`/send`, `/me`, `/health`) that edge functions call to send messages.

Running one process avoids the "conflict: replaced" loop you get when two Baileys clients share the same auth folder.

---

## 1. Files

```
scripts/mudslide-listener/
├── Dockerfile
├── docker-compose.example.yml
├── listener.mjs                # the service
├── package.json
├── README.md
└── mudslide-listener.service   # (legacy) systemd unit — do NOT enable if using Docker
```

---

## 2. Environment variables

Required:

| Var | Description |
|---|---|
| `WEBHOOK_URL` | e.g. `https://supabase.example.com/functions/v1/whatsapp-incoming` |
| `WEBHOOK_SECRET` | Must equal `whatsapp_settings.incoming_webhook_secret` |
| `ORG_ID` | Organization UUID that incoming messages belong to |
| `SUPABASE_ANON_KEY` | Sent as the `apikey` header when POSTing to the edge function |

Optional:

| Var | Default | Purpose |
|---|---|---|
| `MUDSLIDE_AUTH_DIR` | `/data/.mudslide` (in Docker) / `$HOME/.mudslide` (host) | Baileys auth folder |
| `INCLUDE_GROUPS` | `1` | Forward `@g.us` messages |
| `INCLUDE_DMS` | `1` | Forward `@s.whatsapp.net` messages |
| `INCLUDE_FROM_ME` | `0` | Also forward messages you send |
| `LISTEN_PORT` | `3000` | HTTP port |
| `LISTEN_HOST` | `0.0.0.0` (Docker) / `127.0.0.1` (host) | Bind address |
| `SEND_TOKEN` | *(empty)* | Bearer token required by `/send` and `/me`. Must equal `whatsapp_settings.mudslide_token` |

---

## 3. Docker lifecycle

Assume you are in the compose directory that includes the `mudslide-listener` service.

```bash
# Start / update
docker compose up -d mudslide-listener

# Restart after code or env change
docker compose restart mudslide-listener

# Stop
docker compose stop mudslide-listener

# Rebuild image (after editing listener.mjs / Dockerfile / package.json)
docker compose build mudslide-listener
docker compose up -d mudslide-listener

# Tear down completely (keeps volumes)
docker compose rm -sf mudslide-listener

# Follow logs
docker compose logs -f --tail=200 mudslide-listener

# Container shell
docker compose exec mudslide-listener sh

# Check env inside the container (safe fields only)
docker compose exec mudslide-listener printenv | grep -E 'LISTEN_|INCLUDE_|MUDSLIDE_|ORG_ID|WEBHOOK_URL'
```

---

## 4. Pairing WhatsApp (first-time + re-pair)

The listener uses Mudslide's auth folder. Log in **once** using the Mudslide CLI inside the container, then start the listener.

```bash
# 1. Stop the listener so it doesn't fight for the auth slot
docker compose stop mudslide-listener

# 2. Run the CLI in the same container, pointed at the same auth dir
docker compose run --rm -it mudslide-listener \
  npx mudslide --data-dir /data/.mudslide login
```

You will get a QR code in the terminal. Scan it in WhatsApp → **Linked devices → Link a device**.

```bash
# 3. Verify pairing
docker compose run --rm -it mudslide-listener \
  npx mudslide --data-dir /data/.mudslide me

# 4. Start the listener again
docker compose up -d mudslide-listener
docker compose logs -f mudslide-listener   # wait for "✅ Connected."
```

### Re-pair (session lost / phone logged it out)

```bash
docker compose stop mudslide-listener
# wipe old session
docker compose run --rm -it mudslide-listener sh -c 'rm -rf /data/.mudslide && mkdir -p /data/.mudslide'
docker compose run --rm -it mudslide-listener npx mudslide --data-dir /data/.mudslide login
docker compose up -d mudslide-listener
```

### Common Mudslide CLI helpers (all inside the container)

```bash
docker compose exec mudslide-listener npx mudslide --data-dir /data/.mudslide me
docker compose exec mudslide-listener npx mudslide --data-dir /data/.mudslide send <phone> "hello"
docker compose exec mudslide-listener npx mudslide --data-dir /data/.mudslide logout
```

> Never run the CLI while the listener is up — they'll knock each other off.

---

## 5. HTTP API (called by edge functions and for manual testing)

Base URL from **inside the Supabase functions container**:

```
http://host.docker.internal:3000
```

Base URL from the **host**:

```
http://127.0.0.1:3000
```

All calls except `/health` require `Authorization: Bearer $SEND_TOKEN`.

### GET /health

```bash
curl -s http://127.0.0.1:3000/health
# → {"ok":true,"connected":true}
```

`connected:false` means the WhatsApp socket isn't up (not paired, or reconnecting).

### GET /me

```bash
curl -s http://127.0.0.1:3000/me \
  -H "Authorization: Bearer $SEND_TOKEN"
# → {"user":{"id":"27...@s.whatsapp.net","name":"…"}}
```

### POST /send

```bash
# Send to a phone number (international format, digits only)
curl -s -X POST http://127.0.0.1:3000/send \
  -H "Authorization: Bearer $SEND_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"27821234567","message":"hello from mudslide"}'

# Send to yourself
curl -s -X POST http://127.0.0.1:3000/send \
  -H "Authorization: Bearer $SEND_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"me","message":"self test"}'

# Send to a group (full JID)
curl -s -X POST http://127.0.0.1:3000/send \
  -H "Authorization: Bearer $SEND_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"1203456789@g.us","message":"group ping"}'
```

Response:

```json
{"ok":true,"id":"3EB0…","to":"27821234567@s.whatsapp.net"}
```

Error responses:

| Status | Meaning |
|---|---|
| 400 | Missing/invalid `to` or `message` |
| 401 | Wrong or missing `SEND_TOKEN` |
| 404 | Unknown path |
| 502 | Baileys refused to send (bad JID, blocked, etc.) |
| 503 | Socket not connected yet |

---

## 6. Edge functions that talk to the listener

| Function | Direction | Purpose |
|---|---|---|
| `whatsapp-incoming` | listener → edge | Receives inbound WA messages, stores them in `whatsapp_incoming_messages`, triggers auto-read rules |
| `whatsapp-send` | edge → listener | User/UI-triggered send, hits `POST /send` |
| `escalate-offline-whatsapp` | edge → listener | Sends offline-camera escalations |
| `whatsapp-heartbeat` | edge → listener | Calls `GET /me` to verify the session is alive; toggles `whatsapp_settings.connected` |

### Test them directly (via Supabase CLI curl helper or `curl`)

```bash
# Send a WA message through the edge function (mirrors what the app does)
curl -s -X POST "$SUPABASE_URL/functions/v1/whatsapp-send" \
  -H "Authorization: Bearer <user JWT>" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"27821234567","message":"edge → listener test"}'

# Force a heartbeat
curl -s -X POST "$SUPABASE_URL/functions/v1/whatsapp-heartbeat" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

### Simulate an incoming message (bypasses WhatsApp)

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/whatsapp-incoming" \
  -H "Authorization: Bearer $INCOMING_WEBHOOK_SECRET" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "organization_id":"'"$ORG_ID"'",
    "sender":"27821234567@s.whatsapp.net",
    "sender_name":"Test",
    "message":"read camera1",
    "message_id":"manual-test-1"
  }'
```

---

## 7. DB tables & queries

All queries below assume you are in the self-hosted supabase directory.

### `whatsapp_settings` (per-org config)

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT organization_id,
       mudslide_base_url,
       enabled,
       connected,
       last_heartbeat_at,
       updated_at
FROM public.whatsapp_settings
ORDER BY updated_at DESC;"
```

### Change the base URL that edge functions call

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
UPDATE public.whatsapp_settings
SET mudslide_base_url = 'http://host.docker.internal:3000'
WHERE organization_id = 'c093c027-920c-4e88-865a-fb17413b3b5a';"
```

### Rotate the send token (must match container's `SEND_TOKEN`)

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
UPDATE public.whatsapp_settings
SET mudslide_token = 'new-strong-token'
WHERE organization_id = '<org-uuid>';"
```

Then restart the container with the same value:

```bash
docker compose up -d --force-recreate mudslide-listener
```

### Rotate the incoming webhook secret

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
UPDATE public.whatsapp_settings
SET incoming_webhook_secret = 'new-webhook-secret'
WHERE organization_id = '<org-uuid>';"
```

Update the container's `WEBHOOK_SECRET` env to match, then restart.

### Recent incoming messages

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT received_at, from_number, left(body, 80) AS body
FROM public.whatsapp_incoming_messages
ORDER BY received_at DESC
LIMIT 50;"
```

### Incoming volume last 24h per sender

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT from_number, count(*) AS msgs
FROM public.whatsapp_incoming_messages
WHERE received_at > now() - interval '24 hours'
GROUP BY from_number
ORDER BY msgs DESC;"
```

### Auto-read rules that a message might trigger

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT id, keyword, camera_name, enabled
FROM public.auto_read_rules
ORDER BY keyword;"
```

---

## 8. Troubleshooting

### "unauthorized" from /send or /me
`SEND_TOKEN` in the container doesn't match `whatsapp_settings.mudslide_token`. Fix and restart.

### "not connected" (503)
WhatsApp socket isn't up. Check logs:

```bash
docker compose logs --tail=200 mudslide-listener
```

Look for:
- `getaddrinfo EAI_AGAIN web.whatsapp.com` → DNS problem. Use `network_mode: host` in compose, or add `dns: [1.1.1.1, 8.8.8.8]`.
- `Session logged out` → re-pair (section 4).
- `conflict: replaced` → something else is using the same auth dir. Stop CLI runs, stop old systemd unit:

```bash
sudo systemctl disable --now mudslide-listener.service mudslide.service 2>/dev/null
```

### Port 3000 already in use
Something else is bound on the host. Find it:

```bash
sudo ss -ltnp 'sport = :3000'
```

Usually the legacy systemd `node` process — disable it (command above).

### Edge function says "Failed to send a request to the Edge Function" / connection refused
The `mudslide_base_url` in `whatsapp_settings` isn't reachable from the functions container. From inside functions, `localhost` = the functions container itself, not the host. Set it to `http://host.docker.internal:3000` (works when the listener uses `network_mode: host` or maps port 3000 on the host).

### Verify the functions container can reach the listener

```bash
docker compose exec functions curl -s http://host.docker.internal:3000/health
```

### Heartbeat says disconnected but /me works
Run the heartbeat manually and read edge logs:

```bash
docker compose logs -f functions | grep whatsapp-heartbeat
```

### Messages not arriving on the wall
1. `curl` the `whatsapp-incoming` function directly (section 6) — if that inserts a row, the listener→edge path is broken (check `WEBHOOK_URL` / `WEBHOOK_SECRET` / `SUPABASE_ANON_KEY`).
2. If the manual insert doesn't show up either, check RLS and the frontend query.

### Clean restart from scratch

```bash
docker compose stop mudslide-listener
docker compose run --rm -it mudslide-listener sh -c 'rm -rf /data/.mudslide && mkdir -p /data/.mudslide'
docker compose run --rm -it mudslide-listener npx mudslide --data-dir /data/.mudslide login
docker compose up -d mudslide-listener
docker compose logs -f mudslide-listener
```

---

## 9. Security notes

- `SEND_TOKEN`, `WEBHOOK_SECRET`, `SUPABASE_ANON_KEY` should be treated as secrets. Keep them in `.env` files with `chmod 600`.
- Only expose port 3000 on the loopback interface or the docker network. Never publish it to the public internet.
- The `mudslide_base_url` should be an internal address (`host.docker.internal`, private IP, or the docker network name), never a public URL.
- Rotate `SEND_TOKEN` and `WEBHOOK_SECRET` any time the container image or host is shared/rebuilt.

---

## 10. Listing WhatsApp groups & running Mudslide CLI in the container

The listener image ships the `mudslide` CLI. Use `docker exec` against the **running** container — you do not need a `docker-compose.yml` in your CWD.

### 10.1 Find the container & its auth mount

```bash
# Confirm the container is running
sudo docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | grep -i mud

# Show mounted auth folder + env (MUDSLIDE_AUTH_DIR is the in-container path)
sudo docker inspect mudslide-listener \
  --format 'Mounts: {{json .Mounts}}{{"\n"}}Env: {{json .Config.Env}}'

# Show the compose project dir (empty if started with `docker run`)
sudo docker inspect mudslide-listener \
  --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
```

On this deployment the auth dir is mounted at:

- Host:      `/home/charl/functions/Glance/scripts/mudslide-listener/auth`
- Container: `/data/.mudslide`

### 10.2 CLI flag: use `-c`, not `--data-dir`

The bundled Mudslide version uses `-c <config-dir>`. `--data-dir` will error with `unknown option`.

```bash
# Who am I logged in as
sudo docker exec mudslide-listener npx mudslide me -c /data/.mudslide

# List all WhatsApp groups (JID + name)
sudo docker exec mudslide-listener npx mudslide groups -c /data/.mudslide

# Some builds use singular
sudo docker exec mudslide-listener npx mudslide group -c /data/.mudslide

# List recent chats / contacts
sudo docker exec mudslide-listener npx mudslide chats    -c /data/.mudslide
sudo docker exec mudslide-listener npx mudslide contacts -c /data/.mudslide

# Send a test message from CLI
sudo docker exec mudslide-listener npx mudslide send \
  -c /data/.mudslide '<JID or number>@s.whatsapp.net' 'hello from CLI'
```

Group JIDs end in `@g.us`. Copy one and use it as `to` in the `/send` API:

```bash
curl -X POST http://127.0.0.1:3000/send \
  -H "Authorization: Bearer $SEND_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"120363...@g.us","message":"hello group"}'
```

### 10.3 HTTP `/groups` endpoint (listener)

The listener also exposes groups over HTTP (auth required):

```bash
curl -H "Authorization: Bearer $SEND_TOKEN" http://127.0.0.1:3000/groups
```

### 10.4 Common gotchas

- `no configuration file provided: not found` → you are in the wrong dir for `docker compose`. Either `cd` to the folder containing your `docker-compose.yml`, pass `-f /full/path/docker-compose.yml`, or skip compose and use `docker exec` as above.
- `/opt/mudslide/node_modules/mudslide/assets/docker-compose.yml` is the **upstream package example**, not your deployment — ignore it.
- `error: unknown option '--data-dir'` → replace with `-c /data/.mudslide`.
- If `mudslide` isn't on PATH inside the container, prefix with `npx`: `npx mudslide ...`.
- Rotate `SEND_TOKEN` if it was ever pasted into a shared terminal / screenshot.
