#!/usr/bin/env node
// Mudslide companion listener.
// Reuses Mudslide's Baileys auth folder, subscribes to messages.upsert,
// and POSTs each incoming WhatsApp message to the whatsapp-incoming
// Supabase edge function so it shows up in the in-app inbox.
//
// Env vars (required):
//   WEBHOOK_URL              e.g. https://<project>.supabase.co/functions/v1/whatsapp-incoming
//                            (self-hosted: https://supabase.example.com/functions/v1/whatsapp-incoming)
//   WEBHOOK_SECRET           same value stored in whatsapp_settings.incoming_webhook_secret
//   ORG_ID                   the organization_id (uuid) the messages belong to
//   SUPABASE_ANON_KEY        anon/publishable key for the apikey header
//
// Env vars (optional):
//   MUDSLIDE_AUTH_DIR        default: $HOME/.mudslide  (must match Mudslide's -c cache folder)
//   INCLUDE_GROUPS           "1" (default) to forward @g.us messages
//   INCLUDE_DMS              "1" (default) to forward @s.whatsapp.net messages
//   INCLUDE_FROM_ME          "0" (default) — set "1" to also forward messages you send

import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
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

function must(k) {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing required env var: ${k}`);
    process.exit(2);
  }
  return v;
}

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

async function post(payload) {
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

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  console.log(`Using auth dir: ${AUTH_DIR}`);
  console.log(`Baileys version: ${version.join(".")}`);

  const sock = makeWASocket({
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
      console.log("✅ Connected. Listening for incoming messages…");
    } else if (connection === "close") {
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

        await post({
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

start().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
