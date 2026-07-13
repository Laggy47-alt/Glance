// Sends per-org WhatsApp offline-camera broadcasts on a per-day schedule.
//
// Two modes per org:
//   * Multi-slot (preferred when whatsapp_settings.daily_broadcast_times is
//     non-empty): fire once per configured HH:MM slot per day, gated by
//     daily_broadcast_last_slot + daily_broadcast_last_sent_at + a window.
//   * Legacy single slot (daily_broadcast_time): fires when current HH:MM
//     matches. Kept for orgs that haven't opted into the array.
//
// Cron: run at least every windowMinutes. Manual triggers with ?force=1
// bypass the schedule (useful for testing).

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

function localYMD(tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    return fmt.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Compute the UTC timestamp (ms) of "today HH:MM" in the given timezone.
// Uses fixed offset heuristic — good enough for gating "already sent this slot today".
function slotUtcMs(tz: string, hh: number, mm: number): number {
  // Get org-local Y-M-D
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const mo = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  // Compute offset (minutes) of tz vs UTC right now
  const nowUtc = Date.now();
  const fmt2 = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" });
  const p2 = fmt2.formatToParts(new Date(nowUtc));
  const ly = Number(p2.find((p) => p.type === "year")?.value);
  const lmo = Number(p2.find((p) => p.type === "month")?.value);
  const ld = Number(p2.find((p) => p.type === "day")?.value);
  const lh = Number(p2.find((p) => p.type === "hour")?.value);
  const lm = Number(p2.find((p) => p.type === "minute")?.value);
  const localAsUtc = Date.UTC(ly, lmo - 1, ld, lh, lm);
  const offsetMs = localAsUtc - nowUtc; // tz-local minus real utc
  return Date.UTC(y, mo - 1, d, hh, mm) - offsetMs;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  // Match the cron interval; slots fire once when curTime is within [slot, slot+window].
  const windowMinutes = Math.max(1, Number(url.searchParams.get("window_minutes")) || 15);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: orgs, error } = await supabase
    .from("whatsapp_settings")
    .select("organization_id, enabled, daily_broadcast_enabled, daily_broadcast_recipients, daily_broadcast_time, daily_broadcast_times, daily_broadcast_last_sent_at, daily_broadcast_last_slot, quiet_timezone, default_recipients");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const results: any[] = [];
  for (const o of orgs ?? []) {
    if (!o.enabled || !o.daily_broadcast_enabled) continue;

    const tz = o.quiet_timezone || "UTC";
    const now = currentHM(tz);
    const curMinutes = now.h * 60 + now.m;
    const nowMs = Date.now();
    const times: string[] = Array.isArray(o.daily_broadcast_times) && o.daily_broadcast_times.length
      ? o.daily_broadcast_times
      : [String(o.daily_broadcast_time ?? "08:00")];
    const multiSlot = Array.isArray(o.daily_broadcast_times) && o.daily_broadcast_times.length > 0;

    // Decide whether this run should fire.
    let dueSlot: string | null = null;
    if (force) {
      dueSlot = times[0] ?? "08:00";
    } else if (multiSlot) {
      const lastSentMs = o.daily_broadcast_last_sent_at ? new Date(o.daily_broadcast_last_sent_at).getTime() : 0;
      for (const t of times) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
        if (!m) continue;
        const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
        const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
        const slotMinutes = hh * 60 + mm;
        const diff = curMinutes - slotMinutes;
        if (diff < 0 || diff > windowMinutes) continue;
        // Already fired this slot today?
        const slotMs = slotUtcMs(tz, hh, mm);
        if (lastSentMs >= slotMs) continue;
        dueSlot = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        break;
      }
    } else {
      // Legacy single-slot: fire when hour+minute match exactly.
      const [hh, mm] = String(o.daily_broadcast_time ?? "08:00").split(":").map(Number);
      if (now.h === hh && now.m === mm) dueSlot = String(o.daily_broadcast_time ?? "08:00");
    }
    if (!dueSlot) continue;

    // Claim the exact org-local slot before sending. This prevents duplicate
    // sends when cron overlaps or when the previous send is still running.
    const slotKey = `${localYMD(tz)}T${dueSlot}`;
    if (multiSlot && !force) {
      const { data: claimed, error: claimError } = await supabase
        .from("whatsapp_settings")
        .update({ daily_broadcast_last_slot: slotKey, daily_broadcast_last_sent_at: new Date().toISOString() })
        .eq("organization_id", o.organization_id)
        .or(`daily_broadcast_last_slot.is.null,daily_broadcast_last_slot.neq.${slotKey}`)
        .select("organization_id");
      if (claimError) {
        results.push({ org: o.organization_id, slot: dueSlot, error: `claim failed: ${claimError.message}` });
        continue;
      }
      if (!claimed?.length) continue;
    }

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
      // Note: offline alerts fire regardless of armed state — clients need to
      // know when cameras are offline even during scheduled disarm windows.
      const grouped = new Map<string, string[]>();
      for (const s of states ?? []) {
        const mins = Math.max(0, Math.floor((nowMs - new Date(s.since).getTime()) / 60_000));
        const list = grouped.get(s.instance_id) ?? [];
        list.push(`${s.camera} (offline ${mins}m)`);
        grouped.set(s.instance_id, list);
      }
      for (const [id, info] of instMap) {
        const cams = grouped.get(id) ?? [];
        if (cams.length) nvrsPayload.push({ name: info.name, reachable: true, offlineCameras: cams });
      }
    }

    // UniFi: include offline cameras from any UniFi NVR in this org whose
    // unifi_offline_alert_settings.daily_broadcast_enabled is true. This is
    // additive — orgs that don't opt in (e.g. ABC) get no UniFi content here.
    const { data: unifiOptIn } = await supabase
      .from("unifi_offline_alert_settings")
      .select("unifi_instance_id, daily_broadcast_enabled")
      .eq("organization_id", o.organization_id)
      .eq("daily_broadcast_enabled", true);
    const unifiInstIds = (unifiOptIn ?? []).map((r: any) => r.unifi_instance_id);
    if (unifiInstIds.length) {
      const { data: unifiInsts } = await supabase
        .from("unifi_instances")
        .select("id, name")
        .in("id", unifiInstIds);
      const unifiNameMap = new Map<string, string>((unifiInsts ?? []).map((i: any) => [i.id, i.name]));
      const { data: unifiCams } = await supabase
        .from("unifi_camera_status")
        .select("instance_id, camera_id, name, is_online, last_offline_at")
        .in("instance_id", unifiInstIds)
        .eq("is_online", false);
      const uGrouped = new Map<string, string[]>();
      for (const c of unifiCams ?? []) {
        const offMs = c.last_offline_at ? new Date(c.last_offline_at).getTime() : nowMs;
        const mins = Math.max(0, Math.floor((nowMs - offMs) / 60_000));
        const list = uGrouped.get(c.instance_id) ?? [];
        list.push(`${c.name || c.camera_id} (offline ${mins}m)`);
        uGrouped.set(c.instance_id, list);
      }
      for (const [id, cams] of uGrouped) {
        if (!cams.length) continue;
        nvrsPayload.push({ name: unifiNameMap.get(id) ?? "UniFi NVR", reachable: true, offlineCameras: cams });
      }
    }

    const recipients = (o.daily_broadcast_recipients?.length ? o.daily_broadcast_recipients : (o.default_recipients ?? []))
      .map((s: string) => String(s).trim()).filter(Boolean);

    let message: string;
    if (!nvrsPayload.length) {
      message = `✅ Daily report (${dueSlot}) — no cameras are currently offline.`;
    } else {
      const blocks = nvrsPayload.map((n) => `🚨 *${n.name}* — ${n.offlineCameras.length} offline:\n${n.offlineCameras.map((c) => `• ${c}`).join("\n")}`);
      message = `📋 Daily offline summary (${dueSlot})\n\n${blocks.join("\n\n")}`;
    }

    async function sendWA(toRecipients: string[], msg: string) {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/escalate-offline-whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          organization_id: o.organization_id,
          recipients: toRecipients,
          message: msg,
          test: true, // bypass quiet hours & rate limit for the scheduled daily run
        }),
      });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, response: j };
    }

    let anySent = false;

    // 1) Org-wide summary
    if (recipients.length) {
      try {
        const out = await sendWA(recipients, message);
        anySent = true;
        results.push({ org: o.organization_id, slot: dueSlot, scope: "org", sent: nvrsPayload.length, ...out });
      } catch (e: any) {
        results.push({ org: o.organization_id, slot: dueSlot, scope: "org", error: String(e?.message ?? e) });
      }
    } else {
      results.push({ org: o.organization_id, slot: dueSlot, scope: "org", skipped: "no recipients" });
    }

    // 2) Per-NVR client summaries (only NVRs with daily_broadcast_enabled + recipients)
    for (const [, info] of instMap) {
      if (!info.daily) continue;
      const nvrRecips = (info.recipients ?? []).map((s) => String(s).trim()).filter(Boolean);
      if (!nvrRecips.length) { results.push({ org: o.organization_id, nvr: info.name, skipped: "no recipients" }); continue; }
      const cams = (nvrsPayload.find((n) => n.name === info.name)?.offlineCameras) ?? [];
      const nvrMsg = cams.length
        ? `📋 Daily offline summary (${dueSlot})\n\n🚨 *${info.name}* — ${cams.length} offline:\n${cams.map((c) => `• ${c}`).join("\n")}`
        : `✅ Daily report (${dueSlot}) — *${info.name}*: all cameras online.`;
      try {
        const out = await sendWA(nvrRecips, nvrMsg);
        anySent = true;
        results.push({ org: o.organization_id, slot: dueSlot, nvr: info.name, scope: "nvr", sent: cams.length, ...out });
      } catch (e: any) {
        results.push({ org: o.organization_id, slot: dueSlot, nvr: info.name, scope: "nvr", error: String(e?.message ?? e) });
      }
    }

    // Multi-slot mode is pre-claimed above so overlapping cron runs cannot
    // duplicate the same org-local slot. Force mode intentionally never stamps.
  }

  return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
