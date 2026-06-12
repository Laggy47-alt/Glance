# Unifi → Supabase bridge

A small Deno service that maintains one websocket per enabled row in
`public.unifi_instances` and streams Unifi Protect / ENVR events into
`public.unifi_events` using the service-role key.

Use this on your self-hosted server (the same box that runs Supabase + Glance).

## 1. Add to your docker-compose

Append the snippet below into the compose file that already runs Supabase
(adjust the network so it can resolve `kong` / `supabase-kong`, or just point
`SUPABASE_URL` at your public URL).

```yaml
services:
  unifi-bridge:
    build: ./docs/unifi-bridge
    restart: unless-stopped
    environment:
      SUPABASE_URL: https://supabase.abcglance.co.za
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      POLL_INSTANCES_MS: "30000"
      LOG_LEVEL: info
    # If the bridge runs on the same docker network as Kong you can use the
    # internal URL instead — saves a public round trip:
    #   SUPABASE_URL: http://kong:8000
    networks:
      - default
```

Then:

```bash
docker compose up -d --build unifi-bridge
docker compose logs -f unifi-bridge
```

## 2. Per-org setup (already in the UI)

1. Super admin → `/super` → **Features** → toggle **Unifi ENVR** on for the org.
2. Inside that org's dashboard go to **Unifi NVR** (the renamed Frigate page) or
   **Sources / NVR Status**, click **Add Unifi ENVR**, and enter:
   - **Base URL** — public HTTPS to the Protect console, no trailing slash, e.g. `https://protect.example.com`
   - **API key** — issued from the Unifi console: *OS Settings → Control Plane → Integrations → Create API Key* (Protect 5.x+).
   - Color, Verify TLS, Enabled.

The bridge picks up the new row within `POLL_INSTANCES_MS` and opens a
websocket to `${base_url}/proxy/protect/integration/v1/subscribe/events`.

## 3. What gets stored

For every event the bridge upserts a row into `public.unifi_events`:

| column            | source                                     |
|-------------------|--------------------------------------------|
| organization_id   | from `unifi_instances.organization_id`     |
| instance_id       | `unifi_instances.id`                       |
| remote_event_id   | `item.id` from the Integration API        |
| camera_id / name  | `item.camera.id` / `item.camera.name`     |
| event_type        | `item.type` (motion, smartDetectZone, …)  |
| smart_types       | `item.smartDetectTypes[]`                 |
| start_at / end_at | `item.start` / `item.end`                 |
| score             | `item.score`                              |
| thumbnail_path    | `item.thumbnail`                          |
| raw               | full payload                              |

Uniqueness is `(instance_id, remote_event_id)`, so retries are safe.

## 4. Troubleshooting

- **`code=1006`** repeatedly: API key invalid or Integration API not enabled.
- **`tls: certificate signed by unknown authority`**: install a trusted cert on
  the Protect console (Deno does not honour a per-instance `verify_tls=false`).
- **No rows arrive**: confirm Glance can see the row in `unifi_instances` and
  the bridge logs `connecting <name>` followed by `connected <name>`.
