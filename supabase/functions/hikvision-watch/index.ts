// Periodic poller for Hikvision NVRs: heartbeat /ISAPI/System/status, refresh
// channel list, and mark instance/channel online/offline. Reuses the existing
// camera_status + camera_offline_alerts tables so the existing offline-alert
// machinery (escalate-offline / escalate-offline-whatsapp / daily broadcast)
// works for Hikvision too. Run from pg_cron every minute.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { hikvisionFetch, type HikvisionInstance } from "../_shared/hikvisionAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type Inst = HikvisionInstance & {
  organization_id: string;
  name: string;
  enabled: boolean;
  poll_enabled: boolean;
  offline_alert_enabled: boolean;
  offline_alert_minutes: number;
  whatsapp_alert_enabled: boolean;
  whatsapp_alert_minutes: number | null;
  nvr_unreachable_since: string | null;
  nvr_unreachable_alerted_since: string | null;
};

function pickAll(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

async function fetchChannels(inst: Inst): Promise<Array<{ id: string; name: string; online: boolean }> | null> {
  try {
    // Camera proxy endpoint exists on NVRs.
    let res = await hikvisionFetch(inst, "/ISAPI/ContentMgmt/InputProxy/channels", {}, 8000);
    if (!res.ok) {
      // Fallback to /System/Video/inputs/channels (for standalone cameras + some NVRs).
      res = await hikvisionFetch(inst, "/ISAPI/System/Video/inputs/channels", {}, 8000);
    }
    if (!res.ok) return null;
    const xml = await res.text();
    // Split into <InputProxyChannel> or <VideoInputChannel> blocks.
    const blocks = xml.split(/<(?:InputProxyChannel|VideoInputChannel)[\s>]/i).slice(1);
    const out: Array<{ id: string; name: string; online: boolean }> = [];
    for (const raw of blocks) {
      const id = (raw.match(/<id>([^<]+)<\/id>/i)?.[1] ?? "").trim();
      const name = (raw.match(/<name>([^<]+)<\/name>/i)?.[1] ?? "").trim() || `Channel ${id}`;
      const online = !/<online>false<\/online>/i.test(raw) && !/<status>offline<\/status>/i.test(raw);
      if (id) out.push({ id, name, online });
    }
    return out;
  } catch {
    return null;
  }
}

async function pingNvr(inst: Inst): Promise<boolean> {
  try {
    const r = await hikvisionFetch(inst, "/ISAPI/System/status", {}, 6000);
    return r.ok || r.status === 401; // 401 means reachable but auth failed
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: instances, error } = await supabase
    .from("hikvision_instances")
    .select("id, organization_id, name, base_url, auth_username, auth_password, verify_tls, enabled, poll_enabled, offline_alert_enabled, offline_alert_minutes, whatsapp_alert_enabled, whatsapp_alert_minutes, nvr_unreachable_since, nvr_unreachable_alerted_since")
    .eq("enabled", true).eq("poll_enabled", true);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const results: any[] = [];
  const nowIso = new Date().toISOString();

  for (const inst of (instances ?? []) as Inst[]) {
    const reachable = await pingNvr(inst);
    if (!reachable) {
      const sinceIso = inst.nvr_unreachable_since ?? nowIso;
      await supabase.from("hikvision_instances")
        .update({ last_polled_at: nowIso, last_error: "unreachable", nvr_unreachable_since: sinceIso })
        .eq("id", inst.id);
      results.push({ instance: inst.name, reachable: false });
      continue;
    }

    const channels = await fetchChannels(inst);
    if (!channels) {
      await supabase.from("hikvision_instances")
        .update({ last_polled_at: nowIso, last_error: "channel list fetch failed", last_seen_at: nowIso, nvr_unreachable_since: null, nvr_unreachable_alerted_since: null })
        .eq("id", inst.id);
      results.push({ instance: inst.name, reachable: true, channels: null });
      continue;
    }

    // Upsert hikvision_channels.
    if (channels.length) {
      await supabase.from("hikvision_channels").upsert(
        channels.map((c) => ({
          organization_id: inst.organization_id,
          instance_id: inst.id,
          channel_id: c.id,
          name: c.name,
        })),
        { onConflict: "instance_id,channel_id" },
      );
    }
    // Sync camera_status (key by friendly name to stay consistent with ingest).
    const { data: existing } = await supabase.from("camera_status").select("*").eq("instance_id", inst.id);
    const map = new Map<string, any>((existing ?? []).map((r: any) => [r.camera, r]));
    const upserts: any[] = [];
    for (const c of channels) {
      const prev = map.get(c.name);
      const since = (!prev || prev.online !== c.online) ? nowIso : prev.since;
      upserts.push({ instance_id: inst.id, organization_id: inst.organization_id, camera: c.name, online: c.online, since, last_checked: nowIso });
    }
    if (upserts.length) {
      await supabase.from("camera_status").upsert(upserts, { onConflict: "instance_id,camera" });
    }
    // Prune cameras no longer present.
    const currentNames = new Set(channels.map((c) => c.name));
    const stale = (existing ?? []).filter((r: any) => !currentNames.has(r.camera)).map((r: any) => r.camera);
    if (stale.length) {
      await supabase.from("camera_status").delete().eq("instance_id", inst.id).in("camera", stale);
      await supabase.from("camera_offline_alerts").delete().eq("instance_id", inst.id).in("camera", stale);
    }

    await supabase.from("hikvision_instances")
      .update({ last_polled_at: nowIso, last_seen_at: nowIso, last_error: null, nvr_unreachable_since: null, nvr_unreachable_alerted_since: null })
      .eq("id", inst.id);

    results.push({ instance: inst.name, reachable: true, channels: channels.length });
  }

  return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
