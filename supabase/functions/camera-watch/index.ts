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
  whatsapp_alert_enabled: boolean;
  whatsapp_recipients: string[];
  master_alert_recipients: string[] | null;
  whatsapp_alert_minutes: number | null;
  multi_client: boolean;
  camera_whatsapp_recipients: Record<string, string[]> | null;
  nvr_unreachable_since: string | null;
  nvr_unreachable_alerted_since: string | null;
};

const isWaRecipient = (r: string) =>
  /^\+?\d{6,}$/.test(r) || /@(g\.us|s\.whatsapp\.net|c\.us|broadcast)$/i.test(r);


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
    .select("id, organization_id, name, base_url, api_key, is_local, offline_alert_enabled, offline_alert_minutes, offline_alert_recipients, whatsapp_alert_enabled, whatsapp_recipients, master_alert_recipients, whatsapp_alert_minutes, multi_client, camera_whatsapp_recipients, nvr_unreachable_since, nvr_unreachable_alerted_since")
    .eq("enabled", true);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Fetch WhatsApp settings per org once.
  const orgIds = Array.from(new Set((instances ?? []).map((i: any) => i.organization_id)));
  const { data: waSettings } = orgIds.length
    ? await supabase.from("whatsapp_settings").select("organization_id, enabled, include_nvr_unreachable, send_recovery, recovery_template").in("organization_id", orgIds)
    : { data: [] as any[] };
  const waByOrg = new Map<string, { enabled: boolean; include_nvr_unreachable: boolean; send_recovery: boolean; recovery_template: string }>(
    (waSettings ?? []).map((s: any) => [s.organization_id, {
      enabled: !!s.enabled,
      include_nvr_unreachable: !!s.include_nvr_unreachable,
      send_recovery: !!s.send_recovery,
      recovery_template: s.recovery_template ?? "✅ *{{nvr}}* — {{camera}} back online",
    }]),
  );

  // Merge per-NVR client recipients with the NVR's master-alert recipients (dedup).
  // Global recipients are NOT included for per-event offline/online alerts — they only
  // receive the daily 8am consolidated broadcast.
  const mergeWithMaster = (inst: Instance, perNvr: string[]) => {
    const master = (inst.master_alert_recipients ?? []).map((r) => String(r).trim()).filter(isWaRecipient);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of [...perNvr, ...master]) {
      if (!isWaRecipient(r)) continue;
      if (seen.has(r)) continue;
      seen.add(r); out.push(r);
    }
    return out;
  };


  const renderRecovery = (tpl: string, vars: Record<string, string | number>) =>
    tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));

  const sendWaMessage = async (orgId: string, recipients: string[], message: string) => {
    try {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/escalate-offline-whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ organization_id: orgId, recipients, message }),
      });
      return await res.json().catch(() => ({ status: res.status }));
    } catch (e: any) { return { error: String(e?.message ?? e) }; }
  };

  const results: any[] = [];

  for (const inst of (instances ?? []) as Instance[]) {
    const stats = await fetchStats(inst);
    if (!stats) {
      // NVR unreachable — set since timestamp, fire one WhatsApp alert past threshold.
      const nowIso = new Date().toISOString();
      const sinceIso = inst.nvr_unreachable_since ?? nowIso;
      const mins = Math.floor((Date.now() - new Date(sinceIso).getTime()) / 60_000);
      const thresholdMin = Math.max(1, inst.whatsapp_alert_minutes ?? inst.offline_alert_minutes);
      const wa = waByOrg.get(inst.organization_id);
      const shouldAlert =
        wa?.enabled && wa.include_nvr_unreachable &&
        inst.whatsapp_alert_enabled &&
        mins >= thresholdMin &&
        inst.nvr_unreachable_alerted_since !== sinceIso;

      const nvrWa = (inst.whatsapp_recipients ?? []).map((r) => r.trim()).filter(isWaRecipient);
      const unreachableRecipients = mergeWithMaster(inst, nvrWa);
      let waResult: any = null;
      if (shouldAlert && unreachableRecipients.length) {
        try {
          const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/escalate-offline-whatsapp`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({
              organization_id: inst.organization_id,
              recipients: unreachableRecipients,
              message: `🚨 *${inst.name}* — NVR UNREACHABLE for ${mins}m. Cameras cannot be polled.`,
            }),
          });
          waResult = await res.json().catch(() => ({ status: res.status }));
        } catch (e: any) { waResult = { error: String(e?.message ?? e) }; }
      }

      const patch: any = { nvr_unreachable_since: sinceIso };
      if (shouldAlert) patch.nvr_unreachable_alerted_since = sinceIso;
      await supabase.from("frigate_instances").update(patch).eq("id", inst.id);
      results.push({ instance: inst.name, reachable: false, mins, alerted: shouldAlert, waResult });
      continue;
    }

    // Reachable — clear unreachable markers if previously set, and send NVR-recovery WA.
    const wasUnreachableAlerted = !!inst.nvr_unreachable_alerted_since;
    if (inst.nvr_unreachable_since || inst.nvr_unreachable_alerted_since) {
      await supabase.from("frigate_instances")
        .update({ nvr_unreachable_since: null, nvr_unreachable_alerted_since: null })
        .eq("id", inst.id);
    }
    const waCfg = waByOrg.get(inst.organization_id);
    if (wasUnreachableAlerted && waCfg?.enabled && waCfg.send_recovery && inst.whatsapp_alert_enabled) {
      const nvrWa = (inst.whatsapp_recipients ?? []).map((r) => r.trim()).filter(isWaRecipient);
      const recoveryRecipients = mergeWithGlobal(inst.organization_id, nvrWa);
      if (recoveryRecipients.length) {
        const msg = `✅ *${inst.name}* — NVR reachable again.`;
        await sendWaMessage(inst.organization_id, recoveryRecipients, msg);
      }
    }

    const states = await reconcile(supabase, inst.id, inst.organization_id, stats.online, stats.offline);
    const now = Date.now();
    const thresholdMs = Math.max(1, inst.offline_alert_minutes) * 60_000;

    // Cameras now back online — send recovery WA for any that had an active alert row, then clear.
    const onlineNames = states.filter((s) => s.online).map((s) => s.camera);
    if (onlineNames.length) {
      const { data: clearedAlerts } = await supabase.from("camera_offline_alerts")
        .select("camera")
        .eq("instance_id", inst.id).in("camera", onlineNames);
      const recoveredCams = (clearedAlerts ?? []).map((r: any) => r.camera);
      if (recoveredCams.length && waCfg?.enabled && waCfg.send_recovery && inst.whatsapp_alert_enabled) {
        // Build per-recipient buckets like alerts do
        const buckets = new Map<string, { recipients: string[]; cameras: string[] }>();
        const nvrWa = (inst.whatsapp_recipients ?? []).map((r) => r.trim()).filter(isWaRecipient);
        if (inst.multi_client) {
          const map = (inst.camera_whatsapp_recipients ?? {}) as Record<string, string[]>;
          for (const cam of recoveredCams) {
            const camRaw = (map[cam] ?? []).map((r) => r.trim()).filter(isWaRecipient);
            const recips = camRaw.length ? camRaw : nvrWa;
            if (!recips.length) continue;
            const key = recips.slice().sort().join("|");
            if (!buckets.has(key)) buckets.set(key, { recipients: recips, cameras: [] });
            buckets.get(key)!.cameras.push(cam);
          }
        } else if (nvrWa.length) {
          buckets.set(nvrWa.slice().sort().join("|"), { recipients: nvrWa, cameras: recoveredCams });
        }
        // Global recipients always get a consolidated summary across all recovered cameras.
        const globalRecips = waByOrg.get(inst.organization_id)?.globalRecipients ?? [];
        if (globalRecips.length && recoveredCams.length) {
          buckets.set("__global__", { recipients: globalRecips, cameras: recoveredCams });
        }
        for (const { recipients, cameras } of buckets.values()) {
          const msg = cameras
            .map((cam) => renderRecovery(waCfg.recovery_template, { nvr: inst.name, camera: cam }))
            .join("\n");
          await sendWaMessage(inst.organization_id, recipients, msg);
        }
      }
      await supabase.from("camera_offline_alerts").delete()
        .eq("instance_id", inst.id).in("camera", onlineNames);
    }


    if (!inst.offline_alert_enabled && !inst.whatsapp_alert_enabled) { results.push({ instance: inst.name, alerted: 0 }); continue; }

    const waThresholdMs = Math.max(1, inst.whatsapp_alert_minutes ?? inst.offline_alert_minutes) * 60_000;
    let due = states.filter((s) => !s.online && (now - new Date(s.since).getTime()) >= Math.min(thresholdMs, waThresholdMs));
    if (!due.length) { results.push({ instance: inst.name, alerted: 0 }); continue; }


    // Skip disarmed cameras — don't email when a schedule has them off.
    const { data: armedRows } = await supabase
      .from("camera_armed_state")
      .select("camera, armed")
      .eq("instance_id", inst.id)
      .in("camera", due.map((d) => d.camera));
    const disarmed = new Set<string>((armedRows ?? []).filter((r: any) => r.armed === false).map((r: any) => r.camera));
    if (disarmed.size) due = due.filter((d) => !disarmed.has(d.camera));
    if (!due.length) { results.push({ instance: inst.name, alerted: 0, skipped_disarmed: disarmed.size }); continue; }

    // Skip ones already alerted for this streak
    const { data: existingAlerts } = await supabase
      .from("camera_offline_alerts")
      .select("camera, since")
      .eq("instance_id", inst.id)
      .in("camera", due.map((d) => d.camera));
    const alreadyKey = new Set((existingAlerts ?? []).map((a: any) => `${a.camera}|${new Date(a.since).toISOString()}`));
    const toAlert = due.filter((d) => !alreadyKey.has(`${d.camera}|${new Date(d.since).toISOString()}`));
    if (!toAlert.length) { results.push({ instance: inst.name, alerted: 0 }); continue; }

    const recipients = inst.offline_alert_enabled ? await recipientsForInstance(supabase, inst) : [];
    const nvrWa = (inst.whatsapp_recipients ?? []).map((r) => r.trim()).filter(isWaRecipient);

    if (inst.offline_alert_enabled && !recipients.length && !inst.whatsapp_alert_enabled) {
      results.push({ instance: inst.name, alerted: 0, error: "no recipients" });
      continue;
    }

    const minsFor = (since: string) => Math.floor((now - new Date(since).getTime()) / 60_000);
    const minsList = toAlert.map((d) => `${d.camera} (offline ${minsFor(d.since)}m)`);
    const channelResults: Record<string, any> = {};

    if (inst.offline_alert_enabled && recipients.length) {
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/escalate-offline`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({
            recipients,
            organization_id: inst.organization_id,
            subject: `[Alert] ${toAlert.length} camera${toAlert.length === 1 ? "" : "s"} offline on ${inst.name}`,
            note: `Cameras have been offline for at least ${inst.offline_alert_minutes} minute${inst.offline_alert_minutes === 1 ? "" : "s"}.`,
            nvrs: [{ name: inst.name, reachable: true, offlineCameras: minsList }],
          }),
        });
        if (!res.ok) throw new Error(`escalate-offline ${res.status}: ${await res.text()}`);
        channelResults.email = recipients.length;
      } catch (e: any) { channelResults.email_error = String(e?.message ?? e); }
    }

    if (inst.whatsapp_alert_enabled) {
      // Build recipient -> cameras buckets.
      // Multi-client: route each camera to its per-camera recipients (fallback to NVR recipients if none).
      // Single-client: one bucket using the NVR recipients.
      const buckets = new Map<string, { recipients: string[]; cameras: typeof toAlert }>();
      if (inst.multi_client) {
        const map = (inst.camera_whatsapp_recipients ?? {}) as Record<string, string[]>;
        for (const d of toAlert) {
          const camRaw = (map[d.camera] ?? []).map((r) => r.trim()).filter(isWaRecipient);
          const recips = camRaw.length ? camRaw : nvrWa;
          if (!recips.length) continue;
          const key = recips.slice().sort().join("|");
          if (!buckets.has(key)) buckets.set(key, { recipients: recips, cameras: [] });
          buckets.get(key)!.cameras.push(d);
        }
      } else if (nvrWa.length) {
        buckets.set(nvrWa.slice().sort().join("|"), { recipients: nvrWa, cameras: toAlert });
      }
      // Global recipients always get a consolidated summary across all offline cameras for this NVR.
      const globalRecips = waByOrg.get(inst.organization_id)?.globalRecipients ?? [];
      if (globalRecips.length && toAlert.length) {
        buckets.set("__global__", { recipients: globalRecips, cameras: toAlert });
      }

      const waOut: any[] = [];
      for (const { recipients: waRecipients, cameras } of buckets.values()) {
        const list = cameras.map((d) => `${d.camera} (offline ${minsFor(d.since)}m)`);
        try {
          const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/escalate-offline-whatsapp`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({
              organization_id: inst.organization_id,
              recipients: waRecipients,
              minutes: inst.whatsapp_alert_minutes ?? inst.offline_alert_minutes,
              nvrs: [{ name: inst.name, reachable: true, offlineCameras: list }],
            }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(`whatsapp ${res.status}: ${JSON.stringify(j)}`);
          waOut.push({ recipients: waRecipients.length, cameras: cameras.length, result: j });
        } catch (e: any) { waOut.push({ recipients: waRecipients.length, cameras: cameras.length, error: String(e?.message ?? e) }); }
      }
      channelResults.whatsapp = waOut;
    }

    await supabase.from("camera_offline_alerts").insert(
      toAlert.map((d) => ({
        organization_id: inst.organization_id,
        instance_id: inst.id, camera: d.camera, since: d.since,
      })),
    );
    results.push({ instance: inst.name, alerted: toAlert.length, ...channelResults });

  }

  return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
