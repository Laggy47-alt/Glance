#!/usr/bin/env node
// Mudslide companion listener + sender.
// Reuses Mudslide's Baileys auth folder for a SINGLE long-lived WhatsApp
// socket that:
//   1. Subscribes to messages.upsert and POSTs each incoming WhatsApp
//      message to the whatsapp-incoming Supabase edge function.
//   2. Exposes a tiny HTTP API (POST /send, GET /me) that the
//      escalate-offline-whatsapp and whatsapp-heartbeat edge functions
//      call to send messages / check session health.
//
// Running both inside one process avoids the "conflict: replaced" loop
// that happens when two separate Baileys/Mudslide processes share the
// same WhatsApp auth and fight for the device slot.
//
// Env vars (required):
//   WEBHOOK_URL              e.g. https://supabase.example.com/functions/v1/whatsapp-incoming
//   WEBHOOK_SECRET           same value stored in whatsapp_settings.incoming_webhook_secret
//   ORG_ID                   the organization_id (uuid) the messages belong to
//   SUPABASE_ANON_KEY        anon/publishable key for the apikey header
//
// Env vars (optional):
//   MUDSLIDE_AUTH_DIR        default: $HOME/.mudslide  (must match Mudslide's -c cache folder)
//   INCLUDE_GROUPS           "1" (default) to forward @g.us messages
//   INCLUDE_DMS              "1" (default) to forward @s.whatsapp.net messages
//   INCLUDE_FROM_ME          "0" (default) — set "1" to also forward messages you send
//   LISTEN_PORT              HTTP port for /send + /me (default: 3000)
//   LISTEN_HOST              bind address (default: 127.0.0.1)
//   SEND_TOKEN               Bearer token required by POST /send and GET /me.
//                            Must equal whatsapp_settings.mudslide_token.

import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import http from "node:http";
import path from "node:path";
import os from "node:os";

const WEBHOOK_URL = must("WEBHOOK_URL");
const WEBHOOK_SECRET = must("WEBHOOK_SECRET");
const ORG_ID = must("ORG_ID");
const SUPABASE_ANON_KEY = must("SUPABASE_ANON_KEY");
const AUTH_DIR =
  process.env.MUDSLIDE_AUTH_DIR || path.join(os.homedir(), ".mudslide");
const INCLUDE_GROUPS = (process.env.INCLUDE_GROUPS ?? "1") === "1";
const INCLUDE_DMS = (process.env.INCLUDE_DMS ?? "1") === "1";
const INCLUDE_FROM_ME = (process.env.INCLUDE_FROM_ME ?? "0") === "1";
const LISTEN_PORT = Number(process.env.LISTEN_PORT ?? 3000);
const LISTEN_HOST = process.env.LISTEN_HOST ?? "127.0.0.1";
const SEND_TOKEN = process.env.SEND_TOKEN ?? "";

function must(k) {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing required env var: ${k}`);
    process.exit(2);
  }
  return v;
}

let sock = null;
let connected = false;

function extractText(m) {
  const msg = m.message;
  if (!msg) return "";
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.buttonsResponseMessage?.selectedDisplayText ||
    msg.listResponseMessage?.title ||
    ""
  );
}

async function postWebhook(payload) {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WEBHOOK_SECRET}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error(`[webhook] ${res.status}: ${t}`);
    } else {
      console.log(`[webhook] ok  ${payload.sender}`);
    }
  } catch (e) {
    console.error("[webhook] error:", e?.message ?? e);
  }
}

function toJid(to) {
  if (!to) throw new Error("missing 'to'");
  if (to === "me") {
    const self = sock?.user?.id;
    if (!self) throw new Error("socket not ready");
    // sock.user.id is "12345:NN@s.whatsapp.net" — strip the device suffix.
    return self.replace(/:\d+(?=@)/, "");
  }
  if (to.includes("@")) return to;
  const digits = String(to).replace(/[^\d]/g, "");
  if (!digits) throw new Error("invalid 'to'");
  return `${digits}@s.whatsapp.net`;
}

function readJsonBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > maxBytes) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function authOk(req) {
  if (!SEND_TOKEN) return true; // no token configured → open (loopback only)
  const h = req.headers["authorization"] || "";
  return h === `Bearer ${SEND_TOKEN}`;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleHttp(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health") return json(res, 200, { ok: true, connected });

    if (path === "/me") {
      if (!authOk(req)) return json(res, 401, { error: "unauthorized" });
      if (!connected || !sock?.user) return json(res, 503, { error: "not connected" });
      return json(res, 200, { user: sock.user });
    }

    if (path === "/groups" && req.method === "GET") {
      if (!authOk(req)) return json(res, 401, { error: "unauthorized" });
      if (!connected || !sock) return json(res, 503, { error: "not connected" });
      try {
        const all = await sock.groupFetchAllParticipating();
        const groups = Object.values(all).map((g) => ({
          jid: g.id,
          name: g.subject,
          participants: Array.isArray(g.participants) ? g.participants.length : 0,
          owner: g.owner ?? null,
          creation: g.creation ?? null,
        }));
        groups.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        return json(res, 200, { groups });
      } catch (e) {
        return json(res, 502, { error: e?.message ?? String(e) });
      }
    }

    if (path === "/send" && req.method === "POST") {
      if (!authOk(req)) return json(res, 401, { error: "unauthorized" });
      if (!connected || !sock) return json(res, 503, { error: "not connected" });
      // Accept larger bodies for base64-encoded images
      const body = await readJsonBody(req, 20_000_000).catch((e) => ({ __err: e }));
      if (body?.__err) return json(res, 400, { error: String(body.__err?.message ?? body.__err) });
      const message = body?.message;
      const imageUrl = body?.image_url;
      const imageBase64 = body?.image_base64;
      const videoUrl = body?.video_url;
      if (!message && !imageUrl && !imageBase64 && !videoUrl) {
        return json(res, 400, { error: "missing 'message' or media" });
      }
      let jid;
      try { jid = toJid(body?.to); }
      catch (e) { return json(res, 400, { error: e?.message ?? String(e) }); }

      try {
        let sent;
        if (imageBase64 || imageUrl) {
          let buf;
          if (imageBase64) {
            const b64 = String(imageBase64).replace(/^data:[^;]+;base64,/, "");
            buf = Buffer.from(b64, "base64");
          } else {
            const r = await fetch(imageUrl);
            if (!r.ok) throw new Error(`image fetch ${r.status}`);
            buf = Buffer.from(await r.arrayBuffer());
          }
          sent = await sock.sendMessage(jid, { image: buf, caption: message || "" });
        } else if (videoUrl) {
          sent = await sock.sendMessage(jid, { video: { url: videoUrl }, caption: message || "" });
        } else {
          sent = await sock.sendMessage(jid, { text: message });
        }
        console.log(`[send] ok  ${jid}${imageUrl || imageBase64 ? " (image)" : ""}`);
        return json(res, 200, { ok: true, id: sent?.key?.id ?? null, to: jid });
      } catch (e) {
        console.error(`[send] error ${jid}:`, e?.message ?? e);
        return json(res, 502, { error: e?.message ?? String(e) });
      }
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 500, { error: e?.message ?? String(e) });
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  console.log(`Using auth dir: ${AUTH_DIR}`);
  console.log(`Baileys version: ${version.join(".")}`);

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === "open") {
      connected = true;
      console.log("✅ Connected. Listening for incoming messages…");
    } else if (connection === "close") {
      connected = false;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`Connection closed (code=${code}). loggedOut=${loggedOut}`);
      if (!loggedOut) {
        setTimeout(start, 2000); // reconnect
      } else {
        console.error("Session logged out. Re-pair Mudslide and restart.");
        process.exit(1);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try {
        if (!m.message) continue;
        if (m.key.fromMe && !INCLUDE_FROM_ME) continue;

        const jid = m.key.remoteJid || "";
        const isGroup = jid.endsWith("@g.us");
        const isDm = jid.endsWith("@s.whatsapp.net");
        if (isGroup && !INCLUDE_GROUPS) continue;
        if (isDm && !INCLUDE_DMS) continue;
        if (!isGroup && !isDm) continue;

        const text = extractText(m).trim();
        if (!text) continue;

        const participant = m.key.participant || jid;
        const pushName = m.pushName || "";
        const senderName = isGroup
          ? `${pushName || participant}`
          : pushName || jid;

        await postWebhook({
          organization_id: ORG_ID,
          sender: jid,
          sender_name: senderName || null,
          message: text,
          message_id: m.key.id || null,
        });
      } catch (e) {
        console.error("handler error:", e?.message ?? e);
      }
    }
  });
}

const server = http.createServer((req, res) => { handleHttp(req, res); });
server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`HTTP API on http://${LISTEN_HOST}:${LISTEN_PORT}  (POST /send, GET /me, GET /health)`);
  if (!SEND_TOKEN) console.warn("⚠ SEND_TOKEN not set — /send and /me are open on the bind address.");
});

start().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
