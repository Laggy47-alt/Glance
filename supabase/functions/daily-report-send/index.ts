// Sends the daily NVR reports.
// - GET/POST without body: processes ALL enabled configs (used by cron at 06:00 UTC = 08:00 SAST)
// - POST { config_id, preview?: true } : sends/preview a single config (used by "Send test" button)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type Cfg = {
  id: string;
  instance_id: string;
  recipients: string[];
  subject: string;
  body_template: string;
  enabled: boolean;
};

type Instance = {
  id: string;
  name: string;
  base_url: string;
  api_key: string | null;
};

type Settings = {
  from_name: string;
  from_email: string;
  reply_to: string | null;
};

function trimUrl(u: string) { return u.replace(/\/+$/, ""); }

async function fetchFrigateStats(inst: Instance): Promise<{ online: string[]; offline: string[] }> {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (inst.api_key) headers["Authorization"] = `Bearer ${inst.api_key}`;
    const r = await fetch(`${trimUrl(inst.base_url)}/api/stats`, { headers, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { online: [], offline: [] };
    const j: any = await r.json();
    const cams = j?.cameras ?? {};
    const online: string[] = [];
    const offline: string[] = [];
    for (const [name, data] of Object.entries<any>(cams)) {
      const camFps = Number(data?.camera_fps ?? 0);
      if (camFps > 0) online.push(name); else offline.push(name);
    }
    return { online: online.sort(), offline: offline.sort() };
  } catch {
    return { online: [], offline: [] };
  }
}

async function fetchPositiveIncidents(supabase: any, instanceId: string, since: string) {
  const { data: media } = await supabase
    .from("media_items")
    .select("id, camera, ts")
    .eq("instance_id", instanceId)
    .gte("ts", since);
  if (!media?.length) return [];
  const ids = media.map((m: any) => m.id);
  const { data: tags } = await supabase
    .from("media_tags")
    .select("media_id, tag, note, created_at")
    .in("media_id", ids)
    .ilike("tag", "positive%");
  if (!tags?.length) return [];
  const byMedia = new Map(media.map((m: any) => [m.id, m]));
  return tags.map((t: any) => ({
    camera: byMedia.get(t.media_id)?.camera ?? "—",
    ts: t.created_at,
    note: t.note ?? "",
  }));
}

function render(template: string, data: Record<string, string>) {
  return template.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);
}

function nl2br(s: string) {
  return s.split("\n").map((l) => l.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))).join("<br/>");
}

async function buildEmail(cfg: Cfg, inst: Instance) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [stats, incidents] = await Promise.all([
    fetchFrigateStats(inst),
    fetchPositiveIncidents(supabase, inst.id, since),
  ]);
  const date = new Date().toISOString().slice(0, 10);
  const data: Record<string, string> = {
    nvr_name: inst.name,
    date,
    cameras_online_count: String(stats.online.length),
    cameras_offline_count: String(stats.offline.length),
    cameras_online_list: stats.online.length ? stats.online.map((c) => `• ${c}`).join("\n") : "(none)",
    cameras_offline_list: stats.offline.length ? stats.offline.map((c) => `• ${c}`).join("\n") : "(none)",
    positive_incidents_count: String(incidents.length),
    positive_incidents_list: incidents.length
      ? incidents.map((i: any) => `• ${i.camera} @ ${new Date(i.ts).toLocaleString()}${i.note ? " — " + i.note : ""}`).join("\n")
      : "(none)",
  };
  return {
    subject: render(cfg.subject, data),
    text: render(cfg.body_template, data),
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111">${nl2br(render(cfg.body_template, data))}</div>`,
  };
}

async function sendViaResend(opts: { from: string; to: string[]; replyTo?: string | null; subject: string; html: string; text: string; }) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not configured");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      reply_to: opts.replyTo || undefined,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Resend ${r.status}: ${body}`);
  return body;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* empty body is fine */ } }

  const onlyConfigId: string | undefined = body?.config_id;
  const preview: boolean = !!body?.preview;
  const overrideRecipients: string[] | undefined = body?.recipients;

  const { data: settings } = await supabase.from("daily_report_settings").select("*").limit(1).maybeSingle();
  const s: Settings = settings ?? { from_name: "ABC Glance", from_email: "onboarding@resend.dev", reply_to: null };
  const fromHeader = `${s.from_name} <${s.from_email}>`;

  let q = supabase.from("daily_report_configs").select("*");
  if (onlyConfigId) q = q.eq("id", onlyConfigId); else q = q.eq("enabled", true);
  const { data: cfgs, error: cfgErr } = await q;
  if (cfgErr) return new Response(JSON.stringify({ error: cfgErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const results: any[] = [];
  for (const cfg of (cfgs ?? []) as Cfg[]) {
    const { data: inst } = await supabase.from("frigate_instances").select("id, name, base_url, api_key").eq("id", cfg.instance_id).maybeSingle();
    if (!inst) { results.push({ config_id: cfg.id, status: "skipped", error: "instance missing" }); continue; }
    const email = await buildEmail(cfg, inst as Instance);
    const recipients = overrideRecipients?.length ? overrideRecipients : cfg.recipients;
    if (preview) { results.push({ config_id: cfg.id, preview: email }); continue; }
    if (!recipients?.length) {
      await supabase.from("daily_report_runs").insert({ config_id: cfg.id, instance_id: cfg.instance_id, recipients: [], status: "skipped", error: "no recipients", subject: email.subject });
      results.push({ config_id: cfg.id, status: "skipped", error: "no recipients" });
      continue;
    }
    try {
      await sendViaResend({ from: fromHeader, to: recipients, replyTo: s.reply_to, subject: email.subject, html: email.html, text: email.text });
      await supabase.from("daily_report_runs").insert({ config_id: cfg.id, instance_id: cfg.instance_id, recipients, status: "sent", subject: email.subject });
      await supabase.from("daily_report_configs").update({ last_sent_at: new Date().toISOString() }).eq("id", cfg.id);
      results.push({ config_id: cfg.id, status: "sent", recipients });
    } catch (e: any) {
      await supabase.from("daily_report_runs").insert({ config_id: cfg.id, instance_id: cfg.instance_id, recipients, status: "failed", error: String(e?.message ?? e), subject: email.subject });
      results.push({ config_id: cfg.id, status: "failed", error: String(e?.message ?? e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
