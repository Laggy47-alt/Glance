# HLS live view (fluent video)

The bridge now produces low-latency HLS video via `ffmpeg` from each camera's
RTSP(S) stream on Protect. The web UI plays it with hls.js and only falls back
to MJPEG snapshots if HLS can't start.

## One-time setup on the bridge machine

1. Install ffmpeg (any recent build with fMP4 HLS — Debian/Ubuntu 22.04+ is fine):

   ```bash
   sudo apt-get install -y ffmpeg
   ffmpeg -version | head -1
   ```

2. Enable RTSP on each camera in Protect that you want to live-view:
   Protect UI → Devices → *camera* → Manage → Advanced → **RTSP** → enable
   the "High" (or any) channel. No password needed — the alias in the URL
   authenticates the stream.

3. Copy the new bridge into place and add the HLS env vars:

   ```bash
   sudo systemctl stop unifi-bridge
   sudo cp /Glance/scripts/unifi-bridge/bridge.mjs /opt/glance-unifi-bridge/
   sudo cp /Glance/scripts/unifi-bridge/package.json /opt/glance-unifi-bridge/
   cd /opt/glance-unifi-bridge
   sudo -u unifi-bridge npm install --omit=dev
   ```

   Append to `/opt/glance-unifi-bridge/.env` (defaults are fine for most setups):

   ```
   HLS_ENABLED=true
   RTSP_SCHEME=rtsps
   RTSP_PORT=7441
   HLS_SEG_SEC=1
   HLS_LIST_SIZE=6
   HLS_IDLE_SEC=25
   HLS_DIR=/tmp/glance-hls
   FFMPEG_BIN=ffmpeg
   HLS_TRANSCODE=false
   ```

   ```bash
   sudo systemctl start unifi-bridge
   sudo journalctl -u unifi-bridge -f
   ```

4. Rebuild and deploy the frontend as usual (`npm run build` + rsync).

## How it works

- First request for `/hls/:inst/:cam/index.m3u8` spawns `ffmpeg -c copy` against
  `rtsps://<envr>:7441/<rtspAlias>?enableSrtp` and writes 1-second fMP4
  segments to `HLS_DIR/<inst>/<cam>/`.
- The playlist stays live as long as the browser keeps requesting it.
  `HLS_IDLE_SEC` seconds after the last request, ffmpeg is killed and the
  segments are deleted.
- Codec copy = ~0% CPU per camera. If a camera's codec is H.265 and your
  browser/hls.js can't play it, set `HLS_TRANSCODE=true` (uses CPU per stream).

## Reverse proxy note

Your existing Cloudflare Tunnel / nginx to the bridge is enough — HLS is just
HTTP GETs of `.m3u8` and `.m4s` files. No new ports.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tile falls back to MJPEG after ~6s | `journalctl -u unifi-bridge -f` and look for `hls start ...` / `ffmpeg` errors. Usually means RTSP isn't enabled on that camera in Protect. |
| ffmpeg logs `TLS: unable to get local issuer certificate` | Already handled by `-tls_verify 0`; if you still see this, upgrade ffmpeg. |
| Everything plays but latency ~10s | Lower `HLS_SEG_SEC=1` (already default) and confirm `lowLatencyMode` — nothing to do beyond defaults. Protect's RTSP is ~2–4s behind reality; that's the floor. |
| H.265 cameras don't play | Set `HLS_TRANSCODE=true` (costs one CPU core per stream) or switch the camera to H.264 in Protect. |
