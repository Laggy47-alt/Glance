// UniFi Protect Alarm Manager webhook receiver.
// Endpoint: /functions/v1/unifi-webhook/<instance_id>?token=<unifi_instances.webhook_secret>
//
// Accepts the secret via:
//   - URL query:   ?token=<secret>   (preferred, UniFi can't add custom headers easily)
//   - Header:      Authorization: Bearer <secret>
//   - Header:      Token: <secret>
//   - Header:      X-Webhook-Token: <secret>
//
// Accepts both POST (default once user toggles in Advanced Settings) and GET
// (UniFi's factory default — payload arrives as query string, no body).
//
// On success, inserts a row into `unifi_events`. UniFi events are NOT mirrored
// to `webhook_events` so the UniFi tenant view stays isolated from the Frigate Wall.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// UniFi camera is identified by MAC address only — there is no camera name
// or id in the payload. Returns the MAC string.
function pickCamera(p: any): { id: string | null; name: string | null } {
  const trig = p?.alarm?.triggers?.[0] ?? p?.triggers?.[0] ?? {};
  const src = p?.alarm?.sources?.[0] ?? {};
  const id =
    trig?.device ??
    src?.device ??
    p?.device ??
    p?.cameraId ??
    null;
  // No name in payload; alarm name often doubles as a human label.
  const name = p?.alarm?.name ?? p?.cameraName ?? null;
  return { id: id ? String(id) : null, name: name ? String(name) : null };
}

function pickEventType(p: any): { type: string; smart: string[] } {
  // Per UniFi docs: triggers[].key is the actual smart-detect type
  // ("person", "vehicle", "ring", "motion", "package", "animal", "face",
  //  "licensePlate", "nfc", "line_crossing", …).
  const triggers: any[] = Array.isArray(p?.alarm?.triggers) ? p.alarm.triggers : [];
  const keys = triggers.map((t) => t?.key).filter(Boolean).map(String);
  const conditions: any[] = Array.isArray(p?.alarm?.conditions) ? p.alarm.conditions : [];
  const condSources = conditions
    .map((c) => c?.condition?.source)
    .filter(Boolean)
    .map(String);
  // Smart-detect labels: dedupe keys + condition sources.
  const smart = Array.from(new Set([...keys, ...condSources]));
  // Primary event_type: first trigger key, else alarm name, else "alarm".
  const type = keys[0] || p?.alarm?.name || p?.eventType || p?.type || "alarm";
  return { type: String(type), smart };
}

function timingEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let ok = 0;
  for (let i = 0; i < a.length; i++) ok |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ok === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const reqId = crypto.randomUUID().slice(0, 8);
  console.log(`[${reqId}] ${req.method} ${url.pathname}${url.search}`);

  try {
    // Path layout: /functions/v1/unifi-webhook/<instance_id>
    const parts = url.pathname.split("/").filter(Boolean);
    const instanceId = parts[parts.length - 1];
    if (!instanceId || !/^[0-9a-f-]{36}$/i.test(instanceId)) {
      console.warn(`[${reqId}] bad instance id: ${instanceId}`);
      return json({ error: "Missing or invalid instance id in URL" }, 400);
    }

    // Token: query string first, then headers.
    const auth = req.headers.get("authorization") ?? "";
    const presented =
      url.searchParams.get("token") ??
      url.searchParams.get("secret") ??
      url.searchParams.get("key") ??
      (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "") ??
      req.headers.get("token") ??
      req.headers.get("x-webhook-token") ??
      "";

    if (!presented) {
      console.warn(`[${reqId}] no token presented`);
      return json({ error: "Missing token (pass ?token=… in URL or Authorization: Bearer …)" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const { data: inst, error: instErr } = await admin
      .from("unifi_instances")
      .select("id, organization_id, source_id, webhook_secret, name, enabled")
      .eq("id", instanceId)
      .maybeSingle();
    if (instErr) {
      console.error(`[${reqId}] instance lookup error:`, instErr);
      return json({ error: instErr.message }, 500);
    }
    if (!inst) {
      console.warn(`[${reqId}] unknown instance ${instanceId}`);
      return json({ error: "Unknown instance" }, 404);
    }

    if (!timingEqual(presented.trim(), (inst.webhook_secret ?? "").trim())) {
      console.warn(`[${reqId}] bad token for instance ${inst.name}`);
      return json({ error: "Bad token" }, 401);
    }

    if (!inst.enabled) {
      console.log(`[${reqId}] instance disabled, skipping`);
      return json({ ok: true, skipped: "instance disabled" });
    }

    // Read body. UniFi defaults to GET (no body); POST has a JSON body.
    let payload: any = {};
    if (req.method === "POST" || req.method === "PUT") {
      const bodyText = await req.text();
      try { payload = bodyText ? JSON.parse(bodyText) : {}; }
      catch { payload = { _raw: bodyText }; }
      if (bodyText) console.log(`[${reqId}] body: ${bodyText.slice(0, 500)}`);
    } else {
      // GET: surface query params as the payload so we still record something.
      payload = { _query: Object.fromEntries(url.searchParams.entries()) };
      console.log(`[${reqId}] GET with no body — recording query params`);
    }

    const { id: camId, name: camName } = pickCamera(payload);
    const { type, smart } = pickEventType(payload);
    const tsMs =
      payload?.alarm?.triggers?.[0]?.timestamp ??
      payload?.timestamp ??
      payload?.alarm?.start ??
      payload?.start ??
      Date.now();
    const startAt = new Date(Number(tsMs) || Date.now()).toISOString();
    const endAt = payload?.alarm?.end ?? payload?.end ?? null;
    const remoteId = String(
      payload?.alarm?.triggers?.[0]?.eventId ??
      payload?.alarm?.eventId ??
      payload?.eventId ??
      payload?.id ??
      `${inst.id}:${startAt}:${camId ?? "unknown"}`,
    );

    const { data: inserted, error: ueErr } = await admin
      .from("unifi_events")
      .upsert(
        {
          organization_id: inst.organization_id,
          instance_id: inst.id,
          remote_event_id: remoteId,
          event_type: type,
          smart_types: smart.length ? smart : null,
          camera_id: camId ?? "unknown",
          camera_name: camName,
          start_at: startAt,
          end_at: endAt ? new Date(Number(endAt) || endAt).toISOString() : null,
          raw: payload,
        },
        { onConflict: "instance_id,remote_event_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (ueErr) {
      console.error(`[${reqId}] unifi_events insert error:`, ueErr);
      return json({ error: ueErr.message }, 500);
    }

    console.log(`[${reqId}] stored event id=${inserted?.id ?? "(dup)"} type=${type} camera=${camId ?? "unknown"}`);
    return json({ ok: true, event_id: inserted?.id ?? null, type });
  } catch (e) {
    console.error(`[${reqId}] fatal:`, e);
    return json({ error: (e as Error).message }, 500);
  }
});
