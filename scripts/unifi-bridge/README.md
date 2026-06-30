# Glance — UniFi Protect bridge

Small Node 20 service that runs on an on-site machine, holds a WebSocket
session to one or more UniFi Protect ENVRs (UDM Pro / NVR / CKG2+), decodes
the binary `updates` feed, and pushes each motion / smart-detect / ring
event to the Glance edge function `unifi-ingest`.

No inbound ports are required on the Glance server — the bridge only makes
outbound HTTPS POSTs.

---

## 1. Create the ENVR in Glance

1. Open **NVRs** in Glance.
2. Click **Add NVR → Add UniFi**.
3. Fill in name, base URL (e.g. `https://10.0.0.1`), color. Save.
4. Expand the new card and copy:
   - **Instance ID** (UUID)
   - **Webhook secret** (UUID)
5. Create a local UniFi OS user with **View Only** + access to UniFi
   Protect. (Settings → Admins → Add Admin → Restrict to local access.)

---

## 2. Install the bridge on the on-site machine

Tested on Debian / Ubuntu with Node 20.

```bash
sudo apt install -y nodejs npm
sudo useradd -r -s /usr/sbin/nologin unifi-bridge

sudo mkdir -p /opt/glance-unifi-bridge
sudo cp -r scripts/unifi-bridge/* /opt/glance-unifi-bridge/
cd /opt/glance-unifi-bridge
sudo npm install --omit=dev
sudo cp .env.example .env
sudo cp instances.example.json instances.json
sudo chown -R unifi-bridge:unifi-bridge /opt/glance-unifi-bridge
```

Edit `/opt/glance-unifi-bridge/.env`:

```ini
GLANCE_URL=https://supabase.your-domain.com
GLANCE_ANON_KEY=eyJhbGciOi...
INSTANCES_FILE=/opt/glance-unifi-bridge/instances.json
LOG_LEVEL=info
```

Edit `/opt/glance-unifi-bridge/instances.json` — one block per ENVR:

```json
[
  {
    "id": "00000000-...",
    "host": "10.0.0.1",
    "username": "glance",
    "password": "the-local-password",
    "webhook_secret": "uuid-from-glance",
    "verify_tls": false
  }
]
```

`verify_tls: false` is normal — UniFi consoles ship with a self-signed cert.

---

## 3. Run it as a service

```bash
sudo cp /opt/glance-unifi-bridge/unifi-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now unifi-bridge
sudo journalctl -u unifi-bridge -f
```

You should see:

```
… [<id>] logging in 10.0.0.1
… [<id>] loaded N cameras
… [<id>] ws open
```

Trigger motion on a camera — within ~1–2 s a line should appear in Glance
on the Live Wall, with a thumbnail in Media.

---

## 4. Adding more ENVRs

Add another block to `instances.json` and restart:

```bash
sudo systemctl restart unifi-bridge
```

---

## Troubleshooting

- **`ingest HTTP 401`** — `webhook_secret` in `instances.json` doesn't match
  the one on the Glance ENVR card. Re-copy it.
- **`ingest HTTP 404`** — `id` in `instances.json` doesn't match a row in
  `unifi_instances`. Re-copy the Instance ID.
- **`login HTTP 401`** — wrong username/password, or the user isn't a local
  account. UniFi cloud SSO users can't log in to the local API.
- **`ws closed 1006`** — network blip; the bridge reconnects automatically
  with exponential backoff (max 30 s).
- Set `LOG_LEVEL=debug` and `systemctl restart unifi-bridge` to see every
  event the bridge forwards.
