# Hikvision AcuSense NVR Setup

Glance ingests events from Hikvision NVRs via the ISAPI HTTP Host Notification
push. One webhook URL per NVR, no polling required for events (polling is only
used for online/offline heartbeats and channel discovery).

## 1. Add the NVR in Glance

Settings → NVRs → **Add Hikvision NVR**. Provide:

- **Name** (display only)
- **Base URL** — e.g. `http://192.168.1.64` or `https://nvr.local:443`
- **Username / Password** — ISAPI account (must have *Remote: Parameters/Operation* permissions)

Glance generates a **webhook URL** in the form:

```
https://<glance-host>/functions/v1/hikvision-ingest/<instance-id>/<secret>
```

Copy it before leaving the page.

## 2. Configure HTTP Host Notification on the NVR

In the NVR web UI:

1. **Configuration → Network → Advanced Settings → HTTP Listening**
2. Add a destination:
   - **URL**: paste the Glance webhook URL
   - **Protocol**: HTTP (or HTTPS if your Glance host has a valid certificate)
   - **Method**: POST
3. Save.

## 3. Enable AcuSense events per channel

For each camera channel you want alerts from:

1. **Configuration → Event → Smart Event** (or **VCA**, depending on firmware)
2. Enable the desired event(s): Line Crossing, Intrusion, Region Entrance, Region Exiting, Loitering, Object Removal, Unattended Baggage, etc.
3. Open **Linkage Method** → **Notify Surveillance Center**. This is the
   trigger that fires HTTP Listening.
4. Under target type, leave **Human / Vehicle** enabled for AcuSense filtering.
5. Save.

## 4. Confirm

Walk in front of the camera (or trigger a line crossing). The event should
appear in Glance's events feed within seconds with a snapshot attached.

If nothing arrives:

- In the NVR web UI, **Configuration → Network → Advanced → HTTP Listening**
  should show your URL as *Successful*. If it shows *Failed*, the NVR cannot
  reach the Glance host — open the port, fix DNS, or check the firewall.
- Glance Settings → NVRs → status badge shows the last received event time.
- `supabase functions logs hikvision-ingest` (or the Logs page) shows each
  inbound request with the parsed channel/event type.
