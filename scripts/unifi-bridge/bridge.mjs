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
import zlib from "node:zlib";
import { Buffer } from "node:buffer";
import https from "node:https";
import WebSocket from "ws";
import { Agent as UndiciAgent } from "undici";
import { authenticator } from "otplib";

// ───────────────────────── config ─────────────────────────

const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const GLANCE_URL = required("GLANCE_URL").replace(/\/+$/, "");
const GLANCE_ANON_KEY = required("GLANCE_ANON_KEY");
const INGEST_URL = `${GLANCE_URL}/functions/v1/unifi-ingest`;

const instances = loadInstances();
if (!instances.length) {
  console.error("[bridge] no instances configured — exiting");
  process.exit(1);
}

const EVENT_TYPES = new Set([
  "motion", "smartDetectZone", "smartDetectLine", "smartDetectLoiterZone",
  "smartAudioDetect", "ring",
]);

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
  let recentEvents = new Map(); // Protect event id → last payload sent
  let backoff = 1000;

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
        let code = inst.mfa_token;
        if (inst.totp_secret) {
          code = authenticator.generate(String(inst.totp_secret).replace(/\s+/g, ""));
          log("debug", inst.id, "generated TOTP code");
        }
        if (!code) throw new Error("login: MFA required but no totp_secret / mfa_token configured");
        log("info", inst.id, "mfa challenge, submitting totp");
        const retryHeaders = { "Content-Type": "application/json" };
        if (mfaCookie) retryHeaders.Cookie = mfaCookie;
        res = await fetch(`${base}/api/auth/login`, {
          method: "POST",
          headers: retryHeaders,
          body: JSON.stringify({ ...body, token: code }),
          dispatcher,
        });
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
    log("info", inst.id, `loaded ${cameras.size} cameras`);
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
    if (contentType && !contentType.includes("image")) {
      log("debug", inst.id, `${label} not image ${contentType} ${buf.length}b`);
      return null;
    }
    log("debug", inst.id, `${label} ok ${buf.length}b ${contentType || "unknown-content-type"}`);
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
    return snap;
  }

  async function postEvent(payload) {
    try {
      const r = await fetch(INGEST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": String(inst.webhook_secret),
          apikey: GLANCE_ANON_KEY,
          Authorization: `Bearer ${GLANCE_ANON_KEY}`,
        },
        body: JSON.stringify({ instance_id: inst.id, event: payload }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        log("info", inst.id, `ingest HTTP ${r.status} ${t.slice(0, 200)}`);
      } else {
        log("debug", inst.id, `sent ${payload.type} ${payload.camera_name}`);
      }
    } catch (e) {
      log("info", inst.id, "ingest error:", e?.message ?? e);
    }
  }

  function scheduleVisualRetry(payload, delays = [5_000, 15_000, 45_000]) {
    if (!payload.id || payload.thumbnail_b64) return;
    for (const delay of delays) {
      setTimeout(async () => {
        const latest = recentEvents.get(payload.id) ?? payload;
        if (latest.thumbnail_b64) return;
        const thumbnail_b64 = await fetchThumbnail(latest.id, latest.camera_id);
        if (!thumbnail_b64) return;
        const enriched = { ...latest, thumbnail_b64, visual_retry: true };
        recentEvents.set(latest.id, enriched);
        log("info", inst.id, "late visual captured", latest.camera_name);
        await postEvent(enriched);
      }, delay).unref?.();
    }
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
        try { await login(); } catch (e) { log("info", inst.id, "relogin failed", e?.message ?? e); }
      }
    });
  }

  function scheduleReconnect() {
    const delay = Math.min(backoff, 30_000);
    backoff = Math.min(backoff * 2, 30_000);
    setTimeout(() => { openWs().catch((e) => log("info", inst.id, "reconnect err", e?.message ?? e)); }, delay);
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

  async function handleUpdate(action, data) {
    if (!action || typeof action !== "object") return;
    if (action.newUpdateId) lastUpdateId = action.newUpdateId;
    if (action.modelKey !== "event") return;

    // We care about new events and end-time updates.
    const isAdd = action.action === "add";
    const isUpd = action.action === "update";
    if (!isAdd && !isUpd) return;
    const type = data?.type ?? action.type;
    if (!type || !EVENT_TYPES.has(type)) return;
    const eventId = action.id ?? data?.id;
    const cameraId = data?.camera ?? data?.cameraId ?? null;
    if (isUpd && (!eventId || !recentEvents.has(eventId))) return;
    const cameraName = (cameraId && cameras.get(cameraId)) || data?.cameraName || cameraId || "Unknown";
    const smart = Array.isArray(data?.smartDetectTypes) ? data.smartDetectTypes : [];
    const start = typeof data?.start === "number" ? data.start : Date.now();
    const end = typeof data?.end === "number" ? data.end : null;
    const score = typeof data?.score === "number" ? data.score : null;

    let thumbnail_b64 = null;
    // Kick off thumbnail retrieval; use eventId when available, otherwise straight to snapshot.
    await new Promise((r) => setTimeout(r, 500));
    thumbnail_b64 = eventId ? await fetchThumbnail(eventId, cameraId) : await fetchCameraSnapshot(cameraId);

    const previous = eventId ? recentEvents.get(eventId) : null;
    const payload = {
      ...(previous ?? {}),
      id: eventId,
      type,
      smartDetectTypes: smart.length ? smart : previous?.smartDetectTypes ?? [],
      camera_id: cameraId ?? previous?.camera_id ?? null,
      camera_name: cameraName || previous?.camera_name || "Unknown",
      start: typeof previous?.start === "number" ? previous.start : start,
      end: end ?? previous?.end ?? null,
      score: score ?? previous?.score ?? null,
      thumbnail_b64: thumbnail_b64 ?? previous?.thumbnail_b64 ?? null,
      visual_retry: isUpd,
    };
    if (eventId) recentEvents.set(eventId, payload);

    // Send adds immediately so the alarm appears. Updates only re-post when
    // they add a visual that was missing on the initial add.
    if (isAdd || (!previous?.thumbnail_b64 && payload.thumbnail_b64)) {
      await postEvent(payload);
    }
    scheduleVisualRetry(payload);
  }

  // boot
  try {
    await login();
    await loadCameras();
    await openWs();
    // Periodic camera refresh (in case names change)
    setInterval(() => { loadCameras().catch(() => {}); }, 10 * 60 * 1000);
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

function log(level, id, ...rest) {
  if (level === "debug" && LOG_LEVEL !== "debug") return;
  const ts = new Date().toISOString();
  console.log(`${ts} [${id}]`, ...rest);
}
