// Polls each enabled Frigate instance to maintain camera_status,
// and sends an escalation email to the assigned customer(s) when a
// camera has been offline for at least the per-NVR threshold.
// Runs every minute via pg_cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type Instance = {
  id: string;
  organization_id: string;
  name: string;
  base_url: string;
  api_key: string | null;
  is_local: boolean;
  offline_alert_enabled: boolean;
  offline_alert_minutes: number;
  offline_alert_recipients: string[];
};

function trimUrl(u: string) { return u.replace(/\/+$/, ""); }

async function fetchStats(inst: Instance) {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (inst.api_key) headers["Authorization"] = `Bearer ${inst.api_key}`;
    const r = await fetch(`${trimUrl(inst.base_url)}/api/stats`, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j: any = await r.json();
    const online: string[] = [];
    const offline: string[] = [];
    for (const [name, data] of Object.entries<any>(j?.cameras ?? {})) {
      if (Number(data?.camera_fps ?? 0) > 0) online.push(name); else offline.push(name);
    }
    return { online, offline, reachable: true };
  } catch {
    return null;
  }
}

async function reconcile(supabase: any, instId: string, orgId: string, online: string[], offline: string[]) {
  const { data: existing } = await supabase.from("camera_status").select("*").eq("instance_id", instId);
  const map = new Map<string, any>((existing ?? []).map((r: any) => [r.camera, r]));
  const now = new Date().toISOString();
  const upserts: any[] = [];
  const result: Array<{ camera: string; online: boolean; since: string }> = [];
  for (const { n, isOnline } of [
    ...online.map((n) => ({ n, isOnline: true })),
    ...offline.map((n) => ({ n, isOnline: false })),
  ]) {
    const prev = map.get(n);
    const since = (!prev || prev.online !== isOnline) ? now : prev.since;
    upserts.push({
      instance_id: instId, organization_id: orgId, camera: n,
      online: isOnline, since, last_checked: now,
    });
    result.push({ camera: n, online: isOnline, since });
  }
  if (upserts.length) {
    await supabase.from("camera_status").upsert(upserts, { onConflict: "instance_id,camera" });
  }
  return result;
}

async function recipientsForInstance(supabase: any, inst: Instance): Promise<string[]> {
  const recips = new Set<string>(inst.offline_alert_recipients?.filter((s) => s && s.includes("@")) ?? []);
  const { data: assigns } = await supabase
    .from("customer_nvr_assignments")
    .select("user_id")
    .eq("instance_id", inst.id);
  const userIds = (assigns ?? []).map((a: any) => a.user_id);
  if (userIds.length) {
    const { data: profs } = await supabase.from("profiles").select("user_id, contact_email").in("user_id", userIds);
    for (const p of profs ?? []) if (p.contact_email && p.contact_email.includes("@")) recips.add(p.contact_email);
    // fallback to auth.users.email
    for (const uid of userIds) {
      try {
        const { data: u } = await supabase.auth.admin.getUserById(uid);
        const em = u?.user?.email;
        if (em && em.includes("@")) recips.add(em);
      } catch { /* ignore */ }
    }
  }
  return Array.from(recips);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: instances, error } = await supabase
    .from("frigate_instances")
    .select("id, organization_id, name, base_url, api_key, is_local, offline_alert_enabled, offline_alert_minutes, offline_alert_recipients")
    .eq("enabled", true);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const results: any[] = [];
  for (const inst of (instances ?? []) as Instance[]) {
    const stats = await fetchStats(inst);
    if (!stats) { results.push({ instance: inst.name, reachable: false }); continue; }
    const states = await reconcile(supabase, inst.id, inst.organization_id, stats.online, stats.offline);
    const now = Date.now();
    const thresholdMs = Math.max(1, inst.offline_alert_minutes) * 60_000;

    // Clear alert rows for cameras now back online
    const onlineNames = states.filter((s) => s.online).map((s) => s.camera);
    if (onlineNames.length) {
      await supabase.from("camera_offline_alerts").delete()
        .eq("instance_id", inst.id).in("camera", onlineNames);
    }

    if (!inst.offline_alert_enabled) { results.push({ instance: inst.name, alerted: 0 }); continue; }

    const due = states.filter((s) => !s.online && (now - new Date(s.since).getTime()) >= thresholdMs);
    if (!due.length) { results.push({ instance: inst.name, alerted: 0 }); continue; }

    // Skip ones already alerted for this streak
    const { data: existingAlerts } = await supabase
      .from("camera_offline_alerts")
      .select("camera, since")
      .eq("instance_id", inst.id)
      .in("camera", due.map((d) => d.camera));
    const alreadyKey = new Set((existingAlerts ?? []).map((a: any) => `${a.camera}|${new Date(a.since).toISOString()}`));
    const toAlert = due.filter((d) => !alreadyKey.has(`${d.camera}|${new Date(d.since).toISOString()}`));
    if (!toAlert.length) { results.push({ instance: inst.name, alerted: 0 }); continue; }

    const recipients = await recipientsForInstance(supabase, inst);
    if (!recipients.length) {
      results.push({ instance: inst.name, alerted: 0, error: "no recipients" });
      continue;
    }

    try {
      const escalateUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/escalate-offline`;
      const minsList = toAlert.map((d) => {
        const mins = Math.floor((now - new Date(d.since).getTime()) / 60_000);
        return `${d.camera} (offline ${mins}m)`;
      });
      const res = await fetch(escalateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          recipients,
          organization_id: inst.organization_id,
          subject: `[Alert] ${toAlert.length} camera${toAlert.length === 1 ? "" : "s"} offline on ${inst.name}`,
          note: `Cameras have been offline for at least ${inst.offline_alert_minutes} minute${inst.offline_alert_minutes === 1 ? "" : "s"}.`,
          nvrs: [{ name: inst.name, reachable: true, offlineCameras: minsList }],
        }),
      });
      if (!res.ok) throw new Error(`escalate-offline ${res.status}: ${await res.text()}`);
      await supabase.from("camera_offline_alerts").insert(
        toAlert.map((d) => ({
          organization_id: inst.organization_id,
          instance_id: inst.id, camera: d.camera, since: d.since,
        })),
      );
      results.push({ instance: inst.name, alerted: toAlert.length, recipients });
    } catch (e: any) {
      results.push({ instance: inst.name, alerted: 0, error: String(e?.message ?? e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
