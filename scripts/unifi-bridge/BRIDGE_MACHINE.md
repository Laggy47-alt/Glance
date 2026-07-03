# Glance UniFi Bridge — On-Site Machine Reference

This document describes everything installed on the on-site Linux box that
sits on the same LAN as one or more UniFi Protect ENVRs (UDM Pro / NVR /
Cloud Key Gen2+) and forwards their events to the Glance app.

The bridge is **outbound-only** — it opens a WebSocket to the local NVR
and HTTPS POSTs to the Glance Supabase. No inbound ports are required on
this machine.

---

## 1. What is installed

| Path | Purpose |
| --- | --- |
| `/opt/glance-unifi-bridge/` | Bridge source (cloned from `scripts/unifi-bridge/`) |
| `/opt/glance-unifi-bridge/bridge.mjs` | The Node 20 service (WS client + ingest poster) |
| `/opt/glance-unifi-bridge/package.json` | npm deps: `ws`, `undici` |
| `/opt/glance-unifi-bridge/node_modules/` | Installed deps (`npm install --omit=dev`) |
| `/opt/glance-unifi-bridge/.env` | Runtime env (Glance URL + anon key, log level) |
| `/opt/glance-unifi-bridge/instances.json` | One block per ENVR: host, creds, secret |
| `/etc/systemd/system/unifi-bridge.service` | systemd unit, runs as `unifi-bridge` user |

System packages: `nodejs` (>=20), `npm`, `curl`, `jq` (handy for debug).

Dedicated unprivileged user `unifi-bridge` owns `/opt/glance-unifi-bridge`.

---

## 2. Data flow

```
 ┌──────────────────┐  wss://<nvr>/proxy/protect/ws/updates   ┌──────────────┐
 │  UniFi Protect   │  ◀────────────  binary frames  ────────▶│              │
 │  ENVR (LAN IP)   │                                         │  bridge.mjs  │
 │                  │  /api/auth/login (cookie + csrf)        │  on this box │
 │                  │  /proxy/protect/api/cameras             │              │
 │                  │  /proxy/protect/api/events/{id}/thumb   │              │
 └──────────────────┘                                         └──────┬───────┘
                                                                     │
                              HTTPS POST + X-Webhook-Secret          │
                              ▼                                      │
                ┌────────────────────────────────────────────┐       │
                │ Glance Supabase                            │◀──────┘
                │  /functions/v1/unifi-ingest                │
                │   ├─ verify secret vs unifi_instances row  │
                │   ├─ insert unifi_events                   │
                │   ├─ upload thumb → camera-snapshots/...   │
                │   ├─ insert media_items                    │
                │   ├─ insert webhook_events  ───────────────┼──▶ Live Wall
                │   └─ bump last_seen_at / last_event_ts     │    Media page
                └────────────────────────────────────────────┘    WhatsApp alerts
                                                                   Daily reports
```

Step by step for one motion event:

1. NVR pushes a binary `add` frame for `modelKey:"event"` on the WS.
2. Bridge decodes the two-packet (header + zlib JSON) frame.
3. Bridge filters: only `motion`, `smartDetectZone`, `smartDetectLine`,
   `smartDetectLoiterZone`, `smartAudioDetect`, `ring`.
4. Bridge waits ~800 ms then GETs
   `/proxy/protect/api/events/{id}/thumbnail?w=640`, base64-encodes it.
5. Bridge POSTs to `${GLANCE_URL}/functions/v1/unifi-ingest` with header
   `X-Webhook-Secret: <unifi_instances.webhook_secret>` and body
   `{ instance_id, event:{ id, type, smartDetectTypes, camera_id,
   camera_name, start, end, score, thumbnail_b64 } }`.
6. `unifi-ingest` writes the event, mirrors a `webhook_events` row, and
   bumps `last_seen_at` so the Glance card flips from "Pending first
   contact" to "Online".

---

## 3. Configuration files

### `/opt/glance-unifi-bridge/.env`

```ini
GLANCE_URL=https://supabase.your-domain.com
GLANCE_ANON_KEY=eyJhbGciOi...
INSTANCES_FILE=/opt/glance-unifi-bridge/instances.json
LOG_LEVEL=info        # set to debug to log every forwarded event
```

### `/opt/glance-unifi-bridge/instances.json`

```json
[
  {
    "id": "00000000-0000-0000-0000-000000000000",
    "host": "10.254.2.2",
    "username": "glance-bridge",
    "password": "the-local-password",
    "webhook_secret": "uuid-copied-from-glance-card",
    "verify_tls": false
  }
]
```

Notes:
- `id` = the UUID shown as **Instance ID** on the Glance NVR card.
- `webhook_secret` = the UUID shown as **Webhook secret** on the same card.
- `host` = LAN IP or hostname only, **no scheme, no slash, no spaces**.
- `username` / `password` = a **local** UniFi OS account (not cloud SSO),
  **MFA must be OFF** for that account, role: Limited Admin → Protect
  View Only is enough.
- `verify_tls: false` is normal (NVRs ship with a self-signed cert).

Add another block to the array for each additional ENVR, then restart.

---

## 4. systemd service

`/etc/systemd/system/unifi-bridge.service` runs `node bridge.mjs` as the
`unifi-bridge` user with `Restart=always`.

Common commands:

```bash
# start / stop / restart
sudo systemctl start  unifi-bridge
sudo systemctl stop   unifi-bridge
sudo systemctl restart unifi-bridge

# enable at boot
sudo systemctl enable unifi-bridge

# status & live logs
sudo systemctl status unifi-bridge
sudo journalctl -u unifi-bridge -f
sudo journalctl -u unifi-bridge --since "10 min ago"
```

---

## 5. What a healthy boot looks like

```
… [<id>] logging in 10.254.2.2
… [<id>] loaded 8 cameras
… [<id>] ws connect wss://10.254.2.2/proxy/protect/ws/updates
… [<id>] ws open
```

Trigger motion on a camera. With `LOG_LEVEL=debug` you should see:

```
… [<id>] sent smartDetectZone Front Door
```

Within ~2 seconds the Glance NVR card flips to **Online** and the event
appears on the Live Wall and Media page.

---

## 6. Debug playbook — when something goes wrong

Always start here:

```bash
sudo systemctl status unifi-bridge
sudo journalctl -u unifi-bridge -n 100 --no-pager
```

Then match the symptom below.

### 6.1  Service won't start / keeps crashing

```bash
sudo journalctl -u unifi-bridge -n 200 --no-pager
ls -la /opt/glance-unifi-bridge/
sudo -u unifi-bridge cat /opt/glance-unifi-bridge/.env
sudo -u unifi-bridge cat /opt/glance-unifi-bridge/instances.json | jq .
```

- `missing env GLANCE_URL` → fill `.env`.
- `instances file not found` → check `INSTANCES_FILE` path.
- `SyntaxError` parsing JSON → run the `jq .` above; fix the JSON.
- Permission denied → `sudo chown -R unifi-bridge:unifi-bridge /opt/glance-unifi-bridge`.

### 6.2  `boot failed: fetch failed` or `Invalid URL`

Usually a typo in `host`.

```bash
# space or scheme snuck in?
sudo -u unifi-bridge cat /opt/glance-unifi-bridge/instances.json
# can the box reach the NVR at all?
ping -c2 10.254.2.2
curl -kI https://10.254.2.2/    # should return any HTTP response
```

- Fix `host` to bare IP, no `https://`, no leading space.
- If `curl` hangs: firewall / VLAN issue between this box and the NVR.

### 6.3  `login HTTP 401`

Wrong creds, or the account is cloud SSO, or MFA is on.

- Log into the NVR web UI → Settings → Admins → confirm the user is
  **local** (Restrict to local access: ON) and **2FA is OFF**.
- Reset password, paste into `instances.json`, restart.

### 6.4  `login HTTP 403` after working previously

The account got locked, demoted, or had MFA re-enabled.

- Re-check the admin in UniFi OS settings.

### 6.5  `ws http 401` / `ws http 403`

Session expired or creds rotated. The bridge auto re-logs in, but if it
keeps looping:

```bash
sudo systemctl restart unifi-bridge
sudo journalctl -u unifi-bridge -f
```

If it still loops: regenerate the local account password and update
`instances.json`.

### 6.6  `ws closed 1006` repeatedly

Network blip or NVR reboot.

- Normal if it recovers within a minute (exponential backoff up to 30 s).
- If persistent: check NVR uptime, switch port, MTU. Try
  `ping -i 0.2 10.254.2.2` for packet loss.

### 6.7  `ingest HTTP 401`

`webhook_secret` in `instances.json` ≠ the one on the Glance card.

- Re-copy the secret from the Glance NVR card into `instances.json`.
- Restart the service.

### 6.8  `ingest HTTP 404`

`id` in `instances.json` ≠ a row in `unifi_instances`.

- Re-copy the Instance ID from the Glance card.
- Confirm the NVR row still exists in Glance.

### 6.9  `ingest HTTP 5xx` or `ingest error: fetch failed`

The Glance Supabase is unreachable from this box.

```bash
curl -I "$GLANCE_URL/functions/v1/unifi-ingest"
# Should return 401 (missing secret) not a DNS/TLS error.
```

- DNS error → fix `/etc/resolv.conf` or use IP.
- TLS error → time skew (`timedatectl`), or expired cert on Glance host.
- Connection refused → Glance Supabase is down; check the app server.

### 6.10  Service runs, logs look fine, but Glance card stays "Pending"

```bash
# Watch one full event end-to-end:
LOG_LEVEL=debug sudo systemctl restart unifi-bridge
sudo journalctl -u unifi-bridge -f
# Now wave at a camera.
```

- No `sent …` line → bridge isn't seeing events. Confirm Protect is
  actually generating Smart Detections on that camera (Protect UI →
  Events tab).
- `sent …` line but Glance silent → the POST is hitting a *different*
  Supabase. Re-check `GLANCE_URL` in `.env`.

### 6.11  Reset everything

```bash
sudo systemctl stop unifi-bridge
cd /opt/glance-unifi-bridge
sudo -u unifi-bridge rm -rf node_modules
sudo -u unifi-bridge npm install --omit=dev
sudo systemctl start unifi-bridge
sudo journalctl -u unifi-bridge -f
```

### 6.12  Upgrading the bridge

On the **app repo server**:

```bash
cd /functions/Glance
git pull
```

On the **bridge machine** (the repo is at `/Glance`, the service runs from `/opt/glance-unifi-bridge`):

```bash
sudo systemctl stop unifi-bridge
sudo cp -r /Glance/scripts/unifi-bridge/* /opt/glance-unifi-bridge/
# (.env and instances.json are NOT overwritten by the wildcard — good)
cd /opt/glance-unifi-bridge
sudo -u unifi-bridge npm install --omit=dev
sudo chown -R unifi-bridge:unifi-bridge /opt/glance-unifi-bridge
sudo systemctl start unifi-bridge
sudo journalctl -u unifi-bridge -f
```

---

## 7. Quick sanity one-liners

```bash
# Is the service running?
systemctl is-active unifi-bridge

# Last 50 lines without paging
sudo journalctl -u unifi-bridge -n 50 --no-pager

# Show the last successfully forwarded event (needs LOG_LEVEL=debug)
sudo journalctl -u unifi-bridge | grep "sent " | tail

# Confirm the NVR is reachable from this box
curl -kI https://$(jq -r '.[0].host' /opt/glance-unifi-bridge/instances.json)/

# Confirm Glance ingest is reachable from this box
curl -I "$(grep ^GLANCE_URL /opt/glance-unifi-bridge/.env | cut -d= -f2)/functions/v1/unifi-ingest"
```
