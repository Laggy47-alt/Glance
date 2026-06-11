// Runs hourly via pg_cron. For each org with daily_broadcast_enabled,
// if the current hour (in the org's quiet_timezone) matches the configured
// daily_broadcast_time, send a WhatsApp summary of currently offline cameras
// (sourced from camera_status, maintained by camera-watch) to the configured
// daily_broadcast_recipients group(s).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function currentHM(tz: string): { h: number; m: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    const [h, m] = fmt.format(new Date()).split(":").map(Number);
    return { h, m };
  } catch { const d = new Date(); return { h: d.getUTCHours(), m: d.getUTCMinutes() }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: orgs, error } = await supabase
    .from("whatsapp_settings")
    .select("organization_id, enabled, daily_broadcast_enabled, daily_broadcast_recipients, daily_broadcast_time, quiet_timezone, default_recipients");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const results: any[] = [];
  for (const o of orgs ?? []) {
    if (!o.enabled || !o.daily_broadcast_enabled) continue;
    const [hh, mm] = String(o.daily_broadcast_time ?? "08:00").split(":").map(Number);
    const now = currentHM(o.quiet_timezone || "UTC");
    // Per-minute cron — fire when both hour and minute match the configured time
    if (!force && (now.h !== hh || now.m !== mm)) continue;

    // Get NVRs for this org and their offline cameras
    const { data: insts } = await supabase
      .from("frigate_instances")
      .select("id, name, daily_broadcast_enabled, whatsapp_recipients")
      .eq("organization_id", o.organization_id)
      .eq("enabled", true);
    const instMap = new Map<string, { name: string; daily: boolean; recipients: string[] }>(
      (insts ?? []).map((i: any) => [i.id, {
        name: i.name,
        daily: !!i.daily_broadcast_enabled,
        recipients: Array.isArray(i.whatsapp_recipients) ? i.whatsapp_recipients : [],
      }]),
    );
    const instIds = Array.from(instMap.keys());


    let nvrsPayload: Array<{ name: string; reachable: boolean; offlineCameras: string[] }> = [];
    if (instIds.length) {
      const { data: states } = await supabase
        .from("camera_status")
        .select("instance_id, camera, online, since")
        .in("instance_id", instIds)
        .eq("online", false);
      // Filter out disarmed cameras
      const { data: disarmedRows } = await supabase
        .from("camera_armed_state")
        .select("instance_id, camera, armed")
        .in("instance_id", instIds)
        .eq("armed", false);
      const disarmed = new Set<string>((disarmedRows ?? []).map((r: any) => `${r.instance_id}|${r.camera}`));
      const grouped = new Map<string, string[]>();
      const nowMs = Date.now();
      for (const s of states ?? []) {
        if (disarmed.has(`${s.instance_id}|${s.camera}`)) continue;
        const mins = Math.max(0, Math.floor((nowMs - new Date(s.since).getTime()) / 60_000));
        const list = grouped.get(s.instance_id) ?? [];
        list.push(`${s.camera} (offline ${mins}m)`);
        grouped.set(s.instance_id, list);
      }
      for (const [id, name] of instMap) {
        const cams = grouped.get(id) ?? [];
        if (cams.length) nvrsPayload.push({ name, reachable: true, offlineCameras: cams });
      }
    }

    const recipients = (o.daily_broadcast_recipients?.length ? o.daily_broadcast_recipients : (o.default_recipients ?? []))
      .map((s: string) => String(s).trim()).filter(Boolean);
    if (!recipients.length) { results.push({ org: o.organization_id, skipped: "no recipients" }); continue; }

    let message: string;
    if (!nvrsPayload.length) {
      message = "✅ Daily report — no cameras are currently offline.";
    } else {
      const blocks = nvrsPayload.map((n) => `🚨 *${n.name}* — ${n.offlineCameras.length} offline:\n${n.offlineCameras.map((c) => `• ${c}`).join("\n")}`);
      message = `📋 Daily offline summary\n\n${blocks.join("\n\n")}`;
    }

    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/escalate-offline-whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          organization_id: o.organization_id,
          recipients,
          message,
          test: true, // bypass quiet hours & rate limit for the scheduled daily run
        }),
      });
      const j = await r.json().catch(() => ({}));
      results.push({ org: o.organization_id, sent: nvrsPayload.length, status: r.status, response: j });
    } catch (e: any) {
      results.push({ org: o.organization_id, error: String(e?.message ?? e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
