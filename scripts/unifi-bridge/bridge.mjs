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
  let backoff = 1000;

  async function login() {
    log("info", inst.id, "logging in", inst.host);
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: inst.username, password: inst.password }),
      dispatcher,
    });
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

  async function fetchThumbnail(eventId) {
    try {
      const r = await fetch(`${base}/proxy/protect/api/events/${eventId}/thumbnail?w=640`, {
        headers: { Cookie: cookie, "x-csrf-token": csrf },
        dispatcher,
      });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return buf.toString("base64");
    } catch { return null; }
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
    if (!isAdd) return; // only emit once on add to avoid duplicates

    const eventId = action.id ?? data?.id;
    const cameraId = data?.camera ?? data?.cameraId ?? null;
    const cameraName = (cameraId && cameras.get(cameraId)) || data?.cameraName || cameraId || "Unknown";
    const smart = Array.isArray(data?.smartDetectTypes) ? data.smartDetectTypes : [];
    const start = typeof data?.start === "number" ? data.start : Date.now();
    const end = typeof data?.end === "number" ? data.end : null;
    const score = typeof data?.score === "number" ? data.score : null;

    let thumbnail_b64 = null;
    if (eventId) {
      // Slight delay so Protect has the snapshot ready
      await new Promise((r) => setTimeout(r, 800));
      thumbnail_b64 = await fetchThumbnail(eventId);
    }

    await postEvent({
      id: eventId,
      type,
      smartDetectTypes: smart,
      camera_id: cameraId,
      camera_name: cameraName,
      start,
      end,
      score,
      thumbnail_b64,
    });
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

function log(level, id, ...rest) {
  if (level === "debug" && LOG_LEVEL !== "debug") return;
  const ts = new Date().toISOString();
  console.log(`${ts} [${id}]`, ...rest);
}
