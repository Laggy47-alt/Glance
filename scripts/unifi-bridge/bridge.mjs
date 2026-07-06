#!/usr/bin/env node
/**
 * Glance — UniFi Protect local bridge.
 *
 * Runs on an on-site machine with LAN access to one or more UniFi Protect
 * ENVRs (UDM Pro, NVR, Cloud Key Gen2 Plus, etc.). For each ENVR it:
 *   1. Logs in via /api/auth/login (cookie + x-csrf-token).
 *   2. Opens wss://<host>/proxy/protect/ws/updates and decodes the binary
 *      action/data frame pairs.
 *   3. Filters for camera "event" model adds (motion, smartDetectZone,
 *      smartDetectLine, ring, …) and fetches the event thumbnail.
 *   4. POSTs each event to the Glance edge function `unifi-ingest`
 *      with X-Webhook-Secret = the per-ENVR secret stored in
 *      `unifi_instances.webhook_secret`.
 *
 * Configuration (env, see .env.example):
 *   GLANCE_URL              https://your-supabase.example.com
 *   GLANCE_ANON_KEY         <anon key>
 *   INSTANCES_FILE          ./instances.json (default)  — or:
 *   INSTANCES_JSON          inline JSON array of instances
 *   LOG_LEVEL               info | debug (default info)
 *
 * instances.json shape:
 *   [
 *     {
 *       "id":             "<glance unifi_instances.id>",
 *       "host":           "10.0.0.1",         // ENVR IP or hostname (no scheme)
 *       "username":       "glance",
 *       "password":       "...",
 *       "webhook_secret": "<unifi_instances.webhook_secret>",
 *       "verify_tls":     false                // optional, default false
 *     }
 *   ]
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import http from "node:http";
import zlib from "node:zlib";
import { Buffer } from "node:buffer";
import https from "node:https";
import crypto from "node:crypto";
import WebSocket from "ws";
import { Agent as UndiciAgent } from "undici";
import { authenticator } from "otplib";


// ───────────────────────── config ─────────────────────────

const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const GLANCE_URL = required("GLANCE_URL").replace(/\/+$/, "");
const GLANCE_ANON_KEY = required("GLANCE_ANON_KEY");
const INGEST_URL = `${GLANCE_URL}/functions/v1/unifi-ingest`;
const STATUS_URL = `${GLANCE_URL}/functions/v1/unifi-status`;
const STATUS_INTERVAL_MS = envNumber("STATUS_INTERVAL_SEC", 30, 5, 600) * 1000;

// Optional HTTP server for live snapshot streaming (MJPEG proxy).
const HTTP_PORT = envNumber("HTTP_PORT", 0, 0, 65535);
const LIVE_TOKEN = process.env.BRIDGE_LIVE_TOKEN ?? "";
const LIVE_FPS = envNumber("LIVE_FPS", 6, 1, 15);

// Live HLS (fluid video via ffmpeg + RTSP(S) from Protect).
const HLS_ENABLED = String(process.env.HLS_ENABLED ?? "true").toLowerCase() !== "false";
const HLS_DIR = process.env.HLS_DIR || path.join(os.tmpdir(), "glance-hls");
const HLS_IDLE_SEC = envNumber("HLS_IDLE_SEC", 25, 5, 300);
const HLS_SEG_SEC = envNumber("HLS_SEG_SEC", 1, 1, 6);
const HLS_LIST_SIZE = envNumber("HLS_LIST_SIZE", 6, 3, 20);
const RTSP_SCHEME = (process.env.RTSP_SCHEME || "rtsps").toLowerCase(); // rtsps | rtsp
const RTSP_PORT = envNumber("RTSP_PORT", RTSP_SCHEME === "rtsps" ? 7441 : 7447, 1, 65535);
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const HLS_TRANSCODE = String(process.env.HLS_TRANSCODE ?? "false").toLowerCase() === "true";
// Sessions: `${instanceId}/${cameraId}` → { proc, dir, ready, lastAccess, startedAt }
const HLS_SESSIONS = new Map();

// Registry so the HTTP server can look up per-instance session state.
const REGISTRY = new Map();

const instances = loadInstances();
if (!instances.length) {
  console.error("[bridge] no instances configured — exiting");
  process.exit(1);
}

const EVENT_TYPES = new Set([
  "smartDetectZone", "smartDetectLine", "smartDetectLoiterZone",
]);
// When true (default) the bridge only forwards events whose smartDetectTypes
// includes "person". Set PERSON_ONLY=false in .env to forward all smart-detect
// types (vehicle, package, animal, etc.).
const PERSON_ONLY = String(process.env.PERSON_ONLY ?? "true").toLowerCase() !== "false";

const INGEST_CONCURRENCY = envNumber("INGEST_CONCURRENCY", 1, 1, 8);
const INGEST_RETRIES = envNumber("INGEST_RETRIES", 3, 0, 8);
const EVENT_CONCURRENCY = envNumber("EVENT_CONCURRENCY", 1, 1, 4);
const MEDIA_FETCH_CONCURRENCY = envNumber("MEDIA_FETCH_CONCURRENCY", 2, 1, 6);
const CLIP_SECONDS = envNumber("CLIP_SECONDS", 6, 2, 30);
const CLIP_PRE_ROLL_SECONDS = envNumber("CLIP_PRE_ROLL_SECONDS", 1, 0, 10);
const MAX_CLIP_BYTES = envNumber("MAX_CLIP_MB", 10, 1, 50) * 1024 * 1024;
const ingestQueue = createAsyncQueue(INGEST_CONCURRENCY);
const mediaQueue = createAsyncQueue(MEDIA_FETCH_CONCURRENCY);

// ───────────────────────── per-instance worker ─────────────────────────

for (const inst of instances) {
  runInstance(inst).catch((e) => {
    console.error(`[${inst.id}] fatal:`, e);
    process.exit(1);
  });
}

async function runInstance(inst) {
  const agent = new https.Agent({ rejectUnauthorized: inst.verify_tls === true });
  const dispatcher = new UndiciAgent({ connect: { rejectUnauthorized: inst.verify_tls === true } });
  const base = `https://${inst.host}`;
  let cookie = "";
  let csrf = "";
  let lastUpdateId = "";
  let cameras = new Map(); // id → name
  let cameraDetails = new Map(); // id → full camera object from Protect
  let recentEvents = new Map(); // Protect event id → compact state; never stores base64 media
  let postedInitialEvents = new Set();
  let visualRetryScheduled = new Set();
  const eventQueue = createAsyncQueue(Number(inst.event_concurrency) || EVENT_CONCURRENCY);
  let backoff = 1000;
  let reconnectTimer = null;

  setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, ev] of recentEvents) {
      if ((ev?._remembered_at ?? 0) < cutoff) {
        recentEvents.delete(id);
        postedInitialEvents.delete(id);
        visualRetryScheduled.delete(id);
      }
    }
  }, 10 * 60 * 1000).unref?.();

  async function login() {
    log("info", inst.id, "logging in", inst.host);
    const body = { username: inst.username, password: inst.password, rememberMe: true };
    // First attempt — without token; UniFi returns 401 with ulp-auth-* headers when MFA needed.
    let res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      dispatcher,
    });
    // MFA required → generate TOTP from configured secret and retry.
    // UniFi OS returns HTTP 499 with an mfaCookie in the JSON response. That
    // UBIC_2FA cookie must be sent back with the one-time code; otherwise the
    // second login attempt is treated as a fresh MFA challenge and returns 499.
    if (res.status === 499 || res.status === 401) {
      const mfaText = await res.text().catch(() => "");
      const mfaJson = safeJson(mfaText);
      const mfaCookie = extractMfaCookie(mfaJson, res.headers.get("set-cookie") ?? "");
      const mfaHeader = res.headers.get("x-ulp-auth-token") || res.headers.get("x-csrf-token");
      const needsMfa = res.status === 499 || (mfaHeader && mfaText.toLowerCase().includes("mfa"));
      if (needsMfa || inst.totp_secret || inst.mfa_token) {
        const codes = mfaCodes(inst);
        if (!codes.length) throw new Error("login: MFA required but no totp_secret / mfa_token configured");
        let lastStatus = res.status;
        for (let i = 0; i < codes.length; i += 1) {
          const retryHeaders = { "Content-Type": "application/json" };
          if (mfaCookie) retryHeaders.Cookie = mfaCookie;
          log("info", inst.id, i === 0 ? "mfa challenge, submitting totp" : `mfa retry with adjacent totp window ${i}`);
          res = await fetch(`${base}/api/auth/login`, {
            method: "POST",
            headers: retryHeaders,
            body: JSON.stringify({ ...body, token: codes[i] }),
            dispatcher,
          });
          lastStatus = res.status;
          if (res.ok) break;
          if (res.status !== 403 && res.status !== 401 && res.status !== 499) break;
        }
        if (!res.ok && lastStatus === 403) {
          throw new Error("login HTTP 403 after MFA — check totp_secret, bridge machine time/NTP, and that the UniFi user is not locked/disabled");
        }
      }
    }
    if (!res.ok) throw new Error(`login HTTP ${res.status}`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    const tokenMatch = setCookie.match(/TOKEN=([^;]+)/);
    if (!tokenMatch) throw new Error("login: no TOKEN cookie returned");
    cookie = `TOKEN=${tokenMatch[1]}`;
    csrf = res.headers.get("x-csrf-token") ?? "";
  }

  async function loadCameras() {
    const r = await fetch(`${base}/proxy/protect/api/cameras`, {
      headers: { Cookie: cookie, "x-csrf-token": csrf },
      dispatcher,
    });
    if (!r.ok) throw new Error(`cameras HTTP ${r.status}`);
    const arr = await r.json();
    cameras = new Map(arr.map((c) => [c.id, c.name]));
    cameraDetails = new Map(arr.map((c) => [c.id, c]));
    // Refresh registry entry every load so /snapshot always has fresh auth.
    REGISTRY.set(inst.id, { inst, base, dispatcher, cameraDetails, getAuth: () => ({ cookie, csrf }) });
    log("info", inst.id, `loaded ${cameras.size} cameras`);
    await postCameraInventory(arr.map((c) => ({ id: c.id, name: c.name })));
  }

  async function pollStatus() {
    try {
      const r = await fetch(`${base}/proxy/protect/api/cameras`, {
        headers: { Cookie: cookie, "x-csrf-token": csrf },
        dispatcher,
      });
      if (!r.ok) { log("debug", inst.id, `status HTTP ${r.status}`); return; }
      const arr = await r.json();
      cameraDetails = new Map(arr.map((c) => [c.id, c]));
      // Protect's own UI treats anything other than state === "CONNECTED"
      // (CONNECTING, UPGRADING, ADOPTING, REBOOTING, DISCONNECTED, ...) as
      // offline. We also require lastSeen to be recent, because Protect
      // occasionally leaves state=CONNECTED on a camera whose stream has
      // actually died. STALE_MS should match a bit more than one keepalive.
      const STALE_MS = 120_000;
      const nowMs = Date.now();
      const payload = {
        instance_id: inst.id,
        cameras: arr.map((c) => {
          const state = String(c.state ?? "").toUpperCase();
          const lastSeenMs = typeof c.lastSeen === "number" ? c.lastSeen : null;
          const fresh = lastSeenMs ? (nowMs - lastSeenMs) < STALE_MS : true;
          const isConnected = state === "CONNECTED" && fresh;
          return {
            id: c.id,
            name: c.name,
            state: c.state,
            isConnected,
            lastSeenMs,
          };
        }),
      };
      const res = await fetch(STATUS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": String(inst.webhook_secret),
          apikey: GLANCE_ANON_KEY,
          Authorization: `Bearer ${GLANCE_ANON_KEY}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) log("info", inst.id, `status POST ${res.status}`);
    } catch (e) {
      log("debug", inst.id, "status error", e?.message ?? e);
    }
  }

  async function postCameraInventory(cameraList) {
    try {
      const r = await fetch(INGEST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": String(inst.webhook_secret),
          apikey: GLANCE_ANON_KEY,
          Authorization: `Bearer ${GLANCE_ANON_KEY}`,
        },
        body: JSON.stringify({ instance_id: inst.id, cameras: cameraList }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        log("info", inst.id, `camera inventory HTTP ${r.status} ${t.slice(0, 200)}`);
      } else {
        log("info", inst.id, `camera inventory synced ${cameraList.length}`);
      }
    } catch (e) {
      log("info", inst.id, "camera inventory error:", e?.message ?? e);
    }
  }

  async function responseImageBase64(r, label) {
    if (!r.ok) {
      log("debug", inst.id, `${label} HTTP ${r.status}`);
      return null;
    }
    const contentType = (r.headers.get("content-type") ?? "").toLowerCase();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 500) {
      log("debug", inst.id, `${label} too small ${buf.length}b ${contentType}`);
      return null;
    }
    const imageKind = detectImageKind(buf);
    // UniFi Protect commonly serves snapshots/thumbnails as application/octet-stream
    // even when the body is a valid JPEG. Trust the bytes, not just content-type.
    if (!imageKind && contentType && !contentType.includes("image")) {
      log("debug", inst.id, `${label} not image ${contentType} ${buf.length}b`);
      return null;
    }
    if (!imageKind && !contentType.includes("image")) {
      log("debug", inst.id, `${label} unknown image body ${buf.length}b ${contentType || "unknown-content-type"}`);
      return null;
    }
    log("debug", inst.id, `${label} ok ${buf.length}b ${contentType || "unknown-content-type"} ${imageKind || "image"}`);
    return buf.toString("base64");
  }

  async function fetchEventThumb(eventId) {
    try {
      const r = await fetch(`${base}/proxy/protect/api/events/${eventId}/thumbnail?w=640`, {
        headers: { Cookie: cookie, "x-csrf-token": csrf },
        dispatcher,
      });
      return await responseImageBase64(r, "event thumbnail");
    } catch (e) {
      log("debug", inst.id, "event thumbnail error", e?.message ?? e);
      return null;
    }
  }

  async function fetchCameraSnapshot(cameraId) {
    if (!cameraId) return null;
    const paths = [
      `/proxy/protect/api/cameras/${cameraId}/snapshot?force=true&width=640&ts=${Date.now()}`,
      `/proxy/protect/api/cameras/${cameraId}/snapshot?width=640&ts=${Date.now()}`,
      `/proxy/protect/api/cameras/${cameraId}/snapshot?force=true&w=640&ts=${Date.now()}`,
      `/proxy/protect/api/cameras/${cameraId}/snapshot?w=640&ts=${Date.now()}`,
      `/proxy/protect/api/cameras/${cameraId}/snapshot?ts=${Date.now()}`,
    ];
    for (const path of paths) {
      try {
        const r = await fetch(`${base}${path}`, {
          headers: { Cookie: cookie, "x-csrf-token": csrf },
          dispatcher,
        });
        const img = await responseImageBase64(r, "camera snapshot");
        if (img) return img;
      } catch (e) {
        log("debug", inst.id, "camera snapshot error", e?.message ?? e);
      }
    }
    return null;
  }

  async function fetchThumbnail(eventId, cameraId) {
    // Try event thumbnail up to 3 times (Protect may take a moment to render it)
    for (let i = 0; i < 3; i++) {
      const t = await fetchEventThumb(eventId);
      if (t) return t;
      await new Promise((r) => setTimeout(r, 700));
    }
    // Fallback: live camera snapshot
    const snap = await fetchCameraSnapshot(cameraId);
    if (snap) log("debug", inst.id, "used camera snapshot fallback");
    else log("info", inst.id, "visual fetch failed", { eventId, cameraId });
    return snap;
  }

  function isMp4(buf) {
    return buf.length > 12 && buf.subarray(4, 8).toString("ascii") === "ftyp";
  }

  async function fetchClip(cameraId, startMs) {
    if (!cameraId || !startMs) return null;
    return mediaQueue.add(() => fetchClipNow(cameraId, startMs));
  }

  // Fetch a short MP4 clip centred on the event start. Keep clips modest so the
  // self-hosted edge worker does not cancel large concurrent JSON uploads.
  async function fetchClipNow(cameraId, startMs) {
    const start = Math.max(0, startMs - CLIP_PRE_ROLL_SECONDS * 1000);
    const end = start + CLIP_SECONDS * 1000;
    const paths = [
      `/proxy/protect/api/video/export?camera=${encodeURIComponent(cameraId)}&start=${start}&end=${end}`,
      `/proxy/protect/api/video/export?camera=${encodeURIComponent(cameraId)}&start=${start}&end=${end}&type=timelapse&fps=0`,
      `/proxy/protect/api/video/export?camera=${encodeURIComponent(cameraId)}&start=${start}&end=${end}&type=normal`,
      `/proxy/protect/api/video/export?camera=${encodeURIComponent(cameraId)}&start=${Math.floor(start / 1000)}&end=${Math.floor(end / 1000)}`,
    ];
    try {
      for (const path of paths) {
        const r = await fetch(`${base}${path}`, {
          headers: { Cookie: cookie, "x-csrf-token": csrf },
          dispatcher,
        });
        if (!r.ok) {
          log("debug", inst.id, `clip HTTP ${r.status} ${path}`);
          continue;
        }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 2000) {
          log("debug", inst.id, `clip too small ${buf.length}b ${path}`);
          continue;
        }
        if (buf.length > MAX_CLIP_BYTES) {
          log("info", inst.id, `clip skipped too large ${(buf.length / 1024 / 1024).toFixed(1)}mb (MAX_CLIP_MB=${(MAX_CLIP_BYTES / 1024 / 1024).toFixed(0)})`);
          continue;
        }
        if (!isMp4(buf)) {
          log("debug", inst.id, `clip not mp4 (${buf.subarray(0, 16).toString("hex")}) ${path}`);
          continue;
        }
        log("info", inst.id, `clip fetched ${(buf.length / 1024).toFixed(0)}kb`);
        return buf.toString("base64");
      }
    } catch (e) {
      log("debug", inst.id, "clip error", e?.message ?? e);
    }
    log("info", inst.id, "clip unavailable", cameraId);
    return null;
  }

  async function postEvent(payload) {
    const event = outboundEventPayload(payload);
    const body = JSON.stringify({ instance_id: inst.id, event });
    return ingestQueue.add(async () => {
      for (let attempt = 0; attempt <= INGEST_RETRIES; attempt += 1) {
        try {
          const r = await fetch(INGEST_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Webhook-Secret": String(inst.webhook_secret),
              apikey: GLANCE_ANON_KEY,
              Authorization: `Bearer ${GLANCE_ANON_KEY}`,
            },
            body,
          });
          if (r.ok) {
            log("debug", inst.id, `sent ${payload.type} ${payload.camera_name}`);
            return true;
          }
          const t = await r.text().catch(() => "");
          log("info", inst.id, `ingest HTTP ${r.status} ${t.slice(0, 200)}${attempt < INGEST_RETRIES ? " — retrying" : ""}`);
          if (![429, 500, 502, 503, 504].includes(r.status)) return false;
        } catch (e) {
          log("info", inst.id, `ingest error${attempt < INGEST_RETRIES ? " — retrying" : ""}:`, e?.message ?? e);
        }
        if (attempt < INGEST_RETRIES) await delay(Math.min(1000 * 2 ** attempt, 8000));
      }
      return false;
    });
  }

  function rememberEvent(payload) {
    if (!payload?.id) return;
    recentEvents.set(payload.id, {
      id: payload.id,
      type: payload.type,
      smartDetectTypes: payload.smartDetectTypes ?? [],
      camera_id: payload.camera_id ?? null,
      camera_name: payload.camera_name ?? "Unknown",
      start: payload.start,
      end: payload.end ?? null,
      score: payload.score ?? null,
      has_thumbnail: Boolean(payload.has_thumbnail || payload.thumbnail_b64),
      has_clip: Boolean(payload.has_clip || payload.clip_b64),
      _remembered_at: Date.now(),
    });
  }

  function scheduleVisualRetry(payload, delays = [5_000, 15_000, 45_000]) {
    if (!payload.id) return;
    if (visualRetryScheduled.has(payload.id)) return;
    visualRetryScheduled.add(payload.id);
    delays.forEach((delayMs, index) => {
      setTimeout(async () => {
        try {
          const latest = recentEvents.get(payload.id) ?? payload;
          const needsThumb = !latest.has_thumbnail;
          const needsClip = !latest.has_clip;
          if (!needsThumb && !needsClip) return;
          const thumbnail_b64 = needsThumb ? await fetchThumbnail(latest.id, latest.camera_id) : null;
          const clip_b64 = needsClip ? await fetchClip(latest.camera_id, latest.start) : null;
          if (!thumbnail_b64 && !clip_b64) return;
          const enriched = {
            ...latest,
            thumbnail_b64,
            clip_b64,
            has_thumbnail: Boolean(latest.has_thumbnail || thumbnail_b64),
            has_clip: Boolean(latest.has_clip || clip_b64),
            visual_retry: true,
          };
          log("info", inst.id, "late media captured", latest.camera_name, JSON.stringify({ thumb: !!thumbnail_b64, clip: !!clip_b64 }));
          const ok = await postEvent(enriched);
          if (ok) rememberEvent(enriched);
        } finally {
          if (index === delays.length - 1) visualRetryScheduled.delete(payload.id);
        }
      }, delayMs).unref?.();
    });
  }

  async function openWs() {
    const qs = lastUpdateId ? `?lastUpdateId=${encodeURIComponent(lastUpdateId)}` : "";
    const wsUrl = `wss://${inst.host}/proxy/protect/ws/updates${qs}`;
    log("info", inst.id, "ws connect", wsUrl);
    const ws = new WebSocket(wsUrl, {
      headers: { Cookie: cookie, "x-csrf-token": csrf },
      rejectUnauthorized: inst.verify_tls === true,
    });

    ws.on("open", () => { backoff = 1000; log("info", inst.id, "ws open"); });
    ws.on("message", (buf) => handleFrame(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)));
    ws.on("close", (code, reason) => {
      log("info", inst.id, "ws closed", code, String(reason));
      scheduleReconnect();
    });
    ws.on("error", (e) => log("info", inst.id, "ws error:", e?.message ?? e));
    ws.on("unexpected-response", async (_req, res) => {
      log("info", inst.id, "ws http", res.statusCode);
      if (res.statusCode === 401 || res.statusCode === 403) {
        try { await boot(); } catch (e) { log("info", inst.id, "relogin failed", e?.message ?? e); scheduleReconnect(); }
      }
    });
  }

  function scheduleReconnect() {
    const delay = Math.min(backoff, 30_000);
    backoff = Math.min(backoff * 2, 30_000);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { boot().catch((e) => { log("info", inst.id, "reconnect err", e?.message ?? e); scheduleReconnect(); }); }, delay);
    reconnectTimer.unref?.();
  }

  // Protect "updates" framing: two packets concatenated.
  // Each packet: 8-byte header (packetType, payloadFormat, deflated, _r, payloadSize:uint32be)
  // followed by payloadSize bytes. payloadFormat: 1=json, 2=utf8, 3=nodebuffer.
  function handleFrame(buf) {
    try {
      let off = 0;
      const packets = [];
      while (off + 8 <= buf.length) {
        const deflated = buf.readUInt8(off + 2) === 1;
        const fmt = buf.readUInt8(off + 1);
        const size = buf.readUInt32BE(off + 4);
        const start = off + 8;
        const end = start + size;
        if (end > buf.length) break;
        let chunk = buf.subarray(start, end);
        if (deflated) chunk = zlib.inflateSync(chunk);
        if (fmt === 1) packets.push(JSON.parse(chunk.toString("utf8")));
        else if (fmt === 2) packets.push(chunk.toString("utf8"));
        else packets.push(chunk);
        off = end;
      }
      if (packets.length < 2) return;
      const [action, data] = packets;
      handleUpdate(action, data);
    } catch (e) {
      log("debug", inst.id, "frame decode err", e?.message ?? e);
    }
  }

  function handleUpdate(action, data) {
    if (!action || typeof action !== "object") return;
    if (action.newUpdateId) lastUpdateId = action.newUpdateId;
    if (action.modelKey !== "event") return;

    // We care about new events and end-time updates.
    const isAdd = action.action === "add";
    const isUpd = action.action === "update";
    if (!isAdd && !isUpd) return;
    const type = data?.type ?? action.type;
    if (!type || !EVENT_TYPES.has(type)) return;
    eventQueue.add(() => processEventUpdate(action, data)).catch((e) => log("info", inst.id, "event processing error", e?.message ?? e));
  }

  async function processEventUpdate(action, data) {
    const isAdd = action.action === "add";
    const isUpd = action.action === "update";
    const type = data?.type ?? action.type;
    const eventId = action.id ?? data?.id;
    const cameraId = data?.camera ?? data?.cameraId ?? null;
    if (isUpd && (!eventId || !recentEvents.has(eventId))) return;
    const cameraName = (cameraId && cameras.get(cameraId)) || data?.cameraName || cameraId || "Unknown";
    const smart = Array.isArray(data?.smartDetectTypes) ? data.smartDetectTypes : [];
    const start = typeof data?.start === "number" ? data.start : Date.now();
    const end = typeof data?.end === "number" ? data.end : null;
    const score = typeof data?.score === "number" ? data.score : null;
    const previous = eventId ? recentEvents.get(eventId) : null;

    // Person-only filter. Accept if any smart types (current or previously seen)
    // include "person". If neither current update nor previous state has smart
    // types yet, defer — the next update usually carries them.
    if (PERSON_ONLY) {
      const prevSmart = previous?.smartDetectTypes ?? [];
      const combined = new Set([...smart, ...prevSmart].map((s) => String(s).toLowerCase()));
      const hasPerson = combined.has("person");
      const hasOtherClassification = [...combined].some((s) => s && s !== "person");
      if (hasOtherClassification && !hasPerson) return; // classified as vehicle/etc → drop
      if (!hasPerson) return; // unclassified yet → wait for next update
    }


    let thumbnail_b64 = null;
    let clip_b64 = null;
    const needsThumb = !previous?.has_thumbnail;
    const needsClip = !previous?.has_clip;
    // Kick off visual retrieval only while the event is still missing media.
    // UniFi often emits many updates for the same event; re-fetching clips for
    // every update floods both the ENVR and the ingest worker.
    if (needsThumb || needsClip) {
      await delay(500);
      if (needsThumb) thumbnail_b64 = eventId ? await fetchThumbnail(eventId, cameraId) : await fetchCameraSnapshot(cameraId);
      if (needsClip) clip_b64 = await fetchClip(cameraId, typeof previous?.start === "number" ? previous.start : start);
    }

    const payload = {
      id: eventId,
      type,
      smartDetectTypes: smart.length ? smart : previous?.smartDetectTypes ?? [],
      camera_id: cameraId ?? previous?.camera_id ?? null,
      camera_name: cameraName || previous?.camera_name || "Unknown",
      start: typeof previous?.start === "number" ? previous.start : start,
      end: end ?? previous?.end ?? null,
      score: score ?? previous?.score ?? null,
      thumbnail_b64,
      clip_b64,
      has_thumbnail: Boolean(previous?.has_thumbnail || thumbnail_b64),
      has_clip: Boolean(previous?.has_clip || clip_b64),
      visual_retry: isUpd,
    };

    // Send adds immediately so the alarm appears. Updates only re-post when
    // they add a visual that was missing on the initial add.
    const initialAlreadyPosted = eventId ? postedInitialEvents.has(eventId) : false;
    const gainedThumb = !previous?.has_thumbnail && !!payload.thumbnail_b64;
    const gainedClip = !previous?.has_clip && !!payload.clip_b64;
    const shouldPost = (isAdd && !initialAlreadyPosted) || gainedThumb || gainedClip;
    let ok = true;
    if (shouldPost) {
      ok = await postEvent(payload);
      if (ok && isAdd && eventId) postedInitialEvents.add(eventId);
    }
    if (ok && eventId) rememberEvent(payload);
    if (!payload.has_thumbnail || !payload.has_clip) scheduleVisualRetry(payload);
  }

  async function boot() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    await login();
    await loadCameras();
    await openWs();
  }

  // boot
  try {
    await boot();
    // Periodic camera refresh (in case names change)
    setInterval(() => { loadCameras().catch(() => {}); }, 10 * 60 * 1000);
    // Periodic camera status push (online / offline / last seen)
    pollStatus().catch(() => {});
    setInterval(() => { pollStatus().catch(() => {}); }, STATUS_INTERVAL_MS);
  } catch (e) {
    log("info", inst.id, "boot failed:", e?.message ?? e);
    scheduleReconnect();
  }
}

// ───────────────────────── helpers ─────────────────────────

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`[bridge] missing env ${name}`); process.exit(1); }
  return v;
}

function envNumber(name, fallback, min, max) {
  const raw = process.env[name];
  const n = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAsyncQueue(concurrency) {
  const q = [];
  let active = 0;
  function pump() {
    while (active < concurrency && q.length) {
      const item = q.shift();
      active += 1;
      Promise.resolve()
        .then(item.fn)
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }
  return {
    add(fn) {
      return new Promise((resolve, reject) => {
        q.push({ fn, resolve, reject });
        pump();
      });
    },
    size() { return q.length + active; },
  };
}

function outboundEventPayload(payload) {
  return {
    id: payload.id,
    type: payload.type,
    smartDetectTypes: payload.smartDetectTypes ?? [],
    camera_id: payload.camera_id ?? null,
    camera_name: payload.camera_name ?? "Unknown",
    start: payload.start,
    end: payload.end ?? null,
    score: payload.score ?? null,
    thumbnail_b64: payload.thumbnail_b64 ?? null,
    clip_b64: payload.clip_b64 ?? null,
    visual_retry: payload.visual_retry === true,
  };
}

function loadInstances() {
  if (process.env.INSTANCES_JSON) {
    return JSON.parse(process.env.INSTANCES_JSON);
  }
  const path = process.env.INSTANCES_FILE ?? "./instances.json";
  if (!fs.existsSync(path)) {
    console.error(`[bridge] instances file not found: ${path}`);
    return [];
  }
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function safeJson(text) {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

function extractMfaCookie(body, setCookie) {
  const fromBody = body?.data?.mfaCookie || body?.mfaCookie;
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.split(";")[0];
  const match = String(setCookie || "").match(/UBIC_2FA=([^;]+)/);
  return match ? `UBIC_2FA=${match[1]}` : "";
}

function mfaCodes(inst) {
  if (inst.mfa_token) return [String(inst.mfa_token).trim()].filter(Boolean);
  if (!inst.totp_secret) return [];
  const secret = String(inst.totp_secret).replace(/\s+/g, "").toUpperCase();
  const now = Date.now();
  // UniFi rejects TOTP with HTTP 403 when either the secret is wrong or the
  // bridge machine clock is slightly skewed. Try current, previous and next
  // 30-second windows without logging the codes.
  const codes = [0, -1, 1].map((offset) => totpAt(secret, now + offset * 30_000));
  return [...new Set(codes.filter(Boolean))];
}

function totpAt(secret, epochMs) {
  try {
    const key = base32Decode(secret);
    const counter = Math.floor(epochMs / 1000 / 30);
    const msg = Buffer.alloc(8);
    msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    msg.writeUInt32BE(counter >>> 0, 4);
    const hmac = crypto.createHmac("sha1", key).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    return String(bin % 1_000_000).padStart(6, "0");
  } catch {
    return authenticator.generate(secret);
  }
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(input).replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function detectImageKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function log(level, id, ...rest) {
  if (level === "debug" && LOG_LEVEL !== "debug") return;
  const ts = new Date().toISOString();
  console.log(`${ts} [${id}]`, ...rest);
}

// ─────────────── Live view HTTP server (MJPEG snapshot proxy) ───────────────
//
// Enable by setting HTTP_PORT in .env. Cameras are served as an animated
// multipart/x-mixed-replace stream so a plain <img src="..."> tag renders live
// snapshots at LIVE_FPS. Auth is via ?token= matching BRIDGE_LIVE_TOKEN.
//
//   GET /health
//   GET /snapshot/:instanceId/:cameraId?token=…
//   GET /stream/:instanceId/:cameraId?token=…   (multipart JPEG)
//
if (HTTP_PORT > 0) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      // Very permissive CORS — this is behind your LAN / reverse proxy anyway.
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, instances: [...REGISTRY.keys()], hls_sessions: [...HLS_SESSIONS.keys()] }));
        return;
      }

      // ── HLS live video (fluent) ──
      // GET /hls/:inst/:cam/index.m3u8?token=…
      // GET /hls/:inst/:cam/:file
      const hlsM = url.pathname.match(/^\/hls\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (hlsM) {
        const [, instanceId, cameraId, file] = hlsM;
        const token = url.searchParams.get("token") ?? "";
        if (LIVE_TOKEN && token !== LIVE_TOKEN) { res.writeHead(401); res.end("unauthorized"); return; }
        if (!HLS_ENABLED) { res.writeHead(503); res.end("hls disabled"); return; }
        const entry = REGISTRY.get(instanceId);
        if (!entry) { res.writeHead(503); res.end("instance not ready"); return; }
        if (!/^[A-Za-z0-9._-]+$/.test(file)) { res.writeHead(400); res.end("bad file"); return; }
        try {
          const session = await ensureHlsSession(entry, cameraId);
          session.lastAccess = Date.now();
          const filePath = path.join(session.dir, file);
          if (!filePath.startsWith(session.dir)) { res.writeHead(400); res.end("bad path"); return; }
          // For the playlist, wait briefly for ffmpeg to produce it after cold start.
          if (file.endsWith(".m3u8")) {
            const deadline = Date.now() + 8000;
            while (!fs.existsSync(filePath) && Date.now() < deadline) {
              await delay(150);
            }
          }
          if (!fs.existsSync(filePath)) { res.writeHead(404); res.end("not ready"); return; }
          const ct = file.endsWith(".m3u8")
            ? "application/vnd.apple.mpegurl"
            : file.endsWith(".m4s") || file.endsWith(".mp4")
              ? "video/mp4"
              : file.endsWith(".ts")
                ? "video/mp2t"
                : "application/octet-stream";
          res.writeHead(200, { "Content-Type": ct, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
          fs.createReadStream(filePath).pipe(res);
        } catch (e) {
          log("info", instanceId, "hls error", e?.message ?? e);
          try { res.writeHead(502); res.end(String(e?.message ?? e)); } catch {}
        }
        return;
      }

      const m = url.pathname.match(/^\/(snapshot|stream)\/([^/]+)\/([^/]+)$/);
      if (!m) { res.writeHead(404); res.end("not found"); return; }
      const [, kind, instanceId, cameraId] = m;
      const token = url.searchParams.get("token") ?? "";
      if (LIVE_TOKEN && token !== LIVE_TOKEN) { res.writeHead(401); res.end("unauthorized"); return; }

      const entry = REGISTRY.get(instanceId);
      if (!entry) { res.writeHead(503); res.end("instance not ready"); return; }

      const widthParam = Math.max(160, Math.min(1920, parseInt(url.searchParams.get("w") ?? "", 10) || 1280));
      const fpsParam = Math.max(1, Math.min(15, parseInt(url.searchParams.get("fps") ?? "", 10) || LIVE_FPS));

      if (kind === "snapshot") {
        const buf = await grabSnapshot(entry, cameraId, widthParam);
        if (!buf) { res.writeHead(502); res.end("snapshot failed"); return; }
        res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
        res.end(buf);
        return;
      }

      // MJPEG stream — pipelined: prefetch next frame while writing current one,
      // and only sleep the *remaining* interval so slow fetches don't stack.
      const boundary = "glancemjpeg";
      res.writeHead(200, {
        "Content-Type": `multipart/x-mixed-replace; boundary=${boundary}`,
        "Cache-Control": "no-store",
        Connection: "close",
      });
      let closed = false;
      req.on("close", () => { closed = true; });
      const interval = Math.max(60, Math.floor(1000 / fpsParam));
      let pending = grabSnapshot(entry, cameraId, widthParam);
      while (!closed) {
        const start = Date.now();
        const buf = await pending;
        if (closed) break;
        // Kick off the next fetch immediately, in parallel with writing this frame.
        pending = grabSnapshot(entry, cameraId, widthParam);
        if (buf) {
          res.write(`--${boundary}\r\n`);
          res.write(`Content-Type: image/jpeg\r\n`);
          res.write(`Content-Length: ${buf.length}\r\n\r\n`);
          res.write(buf);
          res.write("\r\n");
        }
        const elapsed = Date.now() - start;
        const wait = interval - elapsed;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      try { res.end(); } catch {}
    } catch (e) {
      try { res.writeHead(500); res.end(String(e?.message ?? e)); } catch {}
    }
  });
  server.listen(HTTP_PORT, () => {
    console.log(`[bridge] live HTTP server listening on :${HTTP_PORT}${LIVE_TOKEN ? " (token required)" : " (no token — set BRIDGE_LIVE_TOKEN!)"}`);
  });
}

async function grabSnapshot(entry, cameraId, width = 1280) {
  const { base, dispatcher, getAuth } = entry;
  const { cookie, csrf } = getAuth();
  const w = Math.max(160, Math.min(1920, Math.floor(width)));
  const paths = [
    `/proxy/protect/api/cameras/${cameraId}/snapshot?force=true&w=${w}&ts=${Date.now()}`,
    `/proxy/protect/api/cameras/${cameraId}/snapshot?w=${w}&ts=${Date.now()}`,
    `/proxy/protect/api/cameras/${cameraId}/snapshot?ts=${Date.now()}`,
  ];
  for (const p of paths) {
    try {
      const r = await fetch(`${base}${p}`, { headers: { Cookie: cookie, "x-csrf-token": csrf }, dispatcher });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 500) return buf;
    } catch {}
  }
  return null;
}

// ─────────────────────────── HLS via ffmpeg ───────────────────────────
//
// Spawns one ffmpeg per (instance, camera) that pulls the Protect RTSP(S)
// stream and writes LL-HLS fMP4 segments into HLS_DIR/<inst>/<cam>/. The
// HTTP server serves index.m3u8 + segments to hls.js in the browser.
//
// Codec-copy (default) has essentially zero CPU cost. Set HLS_TRANSCODE=true
// to re-encode to H.264 baseline for players that can't handle the source.

function pickRtspAlias(cameraDetails, cameraId) {
  const cam = cameraDetails?.get?.(cameraId);
  const channels = Array.isArray(cam?.channels) ? cam.channels : [];
  const enabled = channels.filter((c) => c && c.isRtspEnabled && c.rtspAlias);
  if (!enabled.length) return null;
  // Prefer the highest-resolution enabled channel (usually the "High" stream).
  enabled.sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
  return enabled[0].rtspAlias;
}

function hlsKey(instanceId, cameraId) { return `${instanceId}/${cameraId}`; }

async function ensureHlsSession(entry, cameraId) {
  const { inst, cameraDetails } = entry;
  const key = hlsKey(inst.id, cameraId);
  const existing = HLS_SESSIONS.get(key);
  if (existing && existing.proc && !existing.proc.killed) {
    existing.lastAccess = Date.now();
    return existing;
  }
  const alias = pickRtspAlias(cameraDetails, cameraId);
  if (!alias) throw new Error("no rtsp channel enabled on this camera (enable RTSP in Protect → camera → advanced)");

  const dir = path.join(HLS_DIR, inst.id, cameraId);
  fs.mkdirSync(dir, { recursive: true });
  // Clean any stale segments/playlists.
  for (const f of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }

  const rtspUrl = `${RTSP_SCHEME}://${inst.host}:${RTSP_PORT}/${alias}${RTSP_SCHEME === "rtsps" ? "?enableSrtp" : ""}`;
  const codecArgs = HLS_TRANSCODE
    ? ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-profile:v", "baseline", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k"]
    : ["-c", "copy"];
  const args = [
    "-hide_banner", "-loglevel", "warning",
    "-fflags", "nobuffer+genpts", "-flags", "low_delay",
    "-rtsp_transport", "tcp",
    "-i", rtspUrl,
    ...codecArgs,
    "-f", "hls",
    "-hls_time", String(HLS_SEG_SEC),
    "-hls_list_size", String(HLS_LIST_SIZE),
    "-hls_flags", "delete_segments+independent_segments+omit_endlist+program_date_time",
    "-hls_segment_type", "fmp4",
    "-hls_fmp4_init_filename", "init.mp4",
    "-hls_segment_filename", path.join(dir, "seg_%05d.m4s"),
    path.join(dir, "index.m3u8"),
  ];
  log("info", inst.id, `hls start ${cameraId} ← ${RTSP_SCHEME}://${inst.host}:${RTSP_PORT}/${alias}`);
  const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
  const session = { proc, dir, lastAccess: Date.now(), startedAt: Date.now(), alias, instanceId: inst.id, cameraId };
  HLS_SESSIONS.set(key, session);
  proc.stderr.on("data", (b) => log("debug", inst.id, `ffmpeg[${cameraId}]`, b.toString().trim()));
  proc.on("exit", (code, sig) => {
    log("info", inst.id, `hls exit ${cameraId} code=${code} sig=${sig}`);
    if (HLS_SESSIONS.get(key) === session) HLS_SESSIONS.delete(key);
    // Best-effort cleanup so the next start begins with a fresh playlist.
    try { for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f)); } catch {}
  });
  return session;
}

setInterval(() => {
  const cutoff = Date.now() - HLS_IDLE_SEC * 1000;
  for (const [key, s] of HLS_SESSIONS) {
    if (s.lastAccess < cutoff) {
      log("info", s.instanceId, `hls idle stop ${s.cameraId} (${Math.round((Date.now() - s.startedAt) / 1000)}s)`);
      try { s.proc.kill("SIGTERM"); } catch {}
      HLS_SESSIONS.delete(key);
    }
  }
}, 5000).unref?.();

function shutdownAllHls() {
  for (const s of HLS_SESSIONS.values()) { try { s.proc.kill("SIGTERM"); } catch {} }
  HLS_SESSIONS.clear();
}
process.on("SIGTERM", shutdownAllHls);
process.on("SIGINT", () => { shutdownAllHls(); process.exit(0); });
