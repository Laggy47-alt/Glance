// unifi-offline-check — cron-driven. Finds UniFi cameras that have been
// offline longer than the per-NVR threshold and sends WhatsApp alerts via
// the existing whatsapp-send edge function (Mudslide). Also sends recovery
// notifications when a camera comes back.
//
// Runs 24/7 (ignores unifi_alert_schedules — those only gate event alerts).
//
// GET or POST /functions/v1/unifi-offline-check

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Recipient = { type?: "number" | "group"; value: string; label?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const { data: settings } = await supabase
    .from("unifi_offline_alert_settings")
    .select("*")
    .eq("enabled", true);
  if (!settings?.length) return json({ ok: true, checked: 0 });

  const { data: instances } = await supabase
    .from("unifi_instances")
    .select("id, name, organization_id");
  const instMap = new Map<string, any>((instances ?? []).map((i: any) => [i.id, i]));

  let alertsSent = 0;
  let recoveriesSent = 0;
  const errors: string[] = [];

  // Resolve fallback WhatsApp org (ABC) once per run. Any UniFi instance whose
  // own organization has no enabled whatsapp_settings row will send via this
  // fallback org so alerts still go out on the shared Mudslide connection.
  let fallbackOrgId: string | null = null;
  {
    const { data: abcOrg } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", "abc-2026")
      .maybeSingle();
    fallbackOrgId = abcOrg?.id ?? null;
  }

  // Cache whatsapp_settings per org (with ABC fallback) so we only fetch once.
  const wsCache = new Map<string, any | null>();
  async function getWhatsAppSettings(orgId: string): Promise<any | null> {
    if (wsCache.has(orgId)) return wsCache.get(orgId)!;
    const { data } = await supabase
      .from("whatsapp_settings")
      .select("mudslide_url, mudslide_token, enabled")
      .eq("organization_id", orgId)
      .eq("enabled", true)
      .maybeSingle();
    let ws = data;
    if ((!ws || !ws.mudslide_url) && fallbackOrgId && fallbackOrgId !== orgId) {
      const { data: fb } = await supabase
        .from("whatsapp_settings")
        .select("mudslide_url, mudslide_token, enabled")
        .eq("organization_id", fallbackOrgId)
        .eq("enabled", true)
        .maybeSingle();
      ws = fb ?? null;
    }
    wsCache.set(orgId, ws ?? null);
    return ws ?? null;
  }


  for (const s of settings as any[]) {
    const inst = instMap.get(s.unifi_instance_id);
    if (!inst) continue;
    const thresholdMs = Math.max(1, Number(s.threshold_minutes) || 5) * 60_000;
    const cooldownMs = Math.max(1, Number(s.cooldown_minutes) || 60) * 60_000;

    const { data: cams } = await supabase
      .from("unifi_camera_status")
      .select("camera_id, name, is_online, last_offline_at, last_online_at, last_alert_sent_at, last_recovery_sent_at")
      .eq("instance_id", inst.id);

    const dueOffline: any[] = [];
    const dueRecovery: any[] = [];
    for (const c of cams ?? []) {
      const offMs = c.last_offline_at ? new Date(c.last_offline_at).getTime() : 0;
      const onMs = c.last_online_at ? new Date(c.last_online_at).getTime() : 0;
      const lastAlert = c.last_alert_sent_at ? new Date(c.last_alert_sent_at).getTime() : 0;
      const lastRec = c.last_recovery_sent_at ? new Date(c.last_recovery_sent_at).getTime() : 0;

      if (!c.is_online && offMs && (nowMs - offMs) >= thresholdMs) {
        if (!lastAlert || (nowMs - lastAlert) >= cooldownMs) dueOffline.push(c);
      }
      if (s.notify_on_recovery && c.is_online && onMs && lastAlert && onMs > lastAlert && (!lastRec || lastRec < onMs)) {
        dueRecovery.push(c);
      }
    }

    if (!dueOffline.length && !dueRecovery.length) continue;

    const recipients: Recipient[] = Array.isArray(s.recipients) ? s.recipients : [];
    const recipientValues = recipients
      .map((r) => (typeof r === "string" ? r : r?.value))
      .map((v: any) => String(v ?? "").trim())
      .filter(Boolean);
    if (!recipientValues.length) continue;

    // OFFLINE alert (single message per NVR listing all offline cameras)
    if (dueOffline.length) {
      const list = dueOffline.map((c) => `• ${c.name || c.camera_id}`).join("\n");
      const message = `🚨 UniFi *${inst.name}* — ${dueOffline.length} camera${dueOffline.length === 1 ? "" : "s"} offline (>${s.threshold_minutes} min):\n${list}`;
      const ws = await getWhatsAppSettings(inst.organization_id);
      const res = await sendWhatsApp(ws, recipientValues, message);
      if (!res.ok) {
        errors.push(`${inst.name} offline: ${res.error}`);
      } else {
        alertsSent += dueOffline.length;
        await supabase.from("unifi_camera_status")
          .update({ last_alert_sent_at: nowIso })
          .eq("instance_id", inst.id)
          .in("camera_id", dueOffline.map((c) => c.camera_id));
      }
    }

    // RECOVERY alerts (also grouped)
    if (dueRecovery.length) {
      const list = dueRecovery.map((c) => `• ${c.name || c.camera_id}`).join("\n");
      const message = `✅ UniFi *${inst.name}* — ${dueRecovery.length} camera${dueRecovery.length === 1 ? "" : "s"} back online:\n${list}`;
      const ws = await getWhatsAppSettings(inst.organization_id);
      const res = await sendWhatsApp(ws, recipientValues, message);
      if (!res.ok) {
        errors.push(`${inst.name} recovery: ${res.error}`);
      } else {
        recoveriesSent += dueRecovery.length;
        await supabase.from("unifi_camera_status")
          .update({ last_recovery_sent_at: nowIso })
          .eq("instance_id", inst.id)
          .in("camera_id", dueRecovery.map((c) => c.camera_id));
      }
    }
  }

  return json({ ok: true, alertsSent, recoveriesSent, errors });
});

async function sendWhatsApp(
  ws: { mudslide_url: string | null; mudslide_token: string | null } | null,
  recipients: string[],
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!ws || !ws.mudslide_url) {
    return { ok: false, error: "no enabled whatsapp_settings (Mudslide URL missing) for org or fallback" };
  }
  const url = ws.mudslide_url.replace(/\/+$/, "") + "/send";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ws.mudslide_token) headers["Authorization"] = `Bearer ${ws.mudslide_token}`;

  const errors: string[] = [];
  for (const raw of recipients) {
    const to = raw === "me" || /@/.test(raw) ? raw : raw.replace(/^\+/, "");
    let sent = false;
    let lastErr = "";
    for (let attempt = 0; attempt < 2 && !sent; attempt++) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ to, message }),
          signal: AbortSignal.timeout(30000),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          lastErr = `Mudslide ${r.status}: ${t.slice(0, 200)}`;
        } else {
          await r.text().catch(() => "");
          sent = true;
        }
      } catch (e) {
        lastErr = (e as Error).message;
      }
      if (!sent && attempt === 0) await new Promise((res) => setTimeout(res, 2000));
    }
    if (!sent) errors.push(`${to}: ${lastErr}`);
  }
  if (errors.length) return { ok: false, error: errors.join("; ") };
  return { ok: true };
}

