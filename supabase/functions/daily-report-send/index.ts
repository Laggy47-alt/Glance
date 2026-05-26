// Sends the daily NVR reports.
// - GET/POST without body: processes ALL enabled configs (used by cron at 06:00 UTC = 08:00 SAST)
// - POST { config_id, preview?: true } : sends/preview a single config (used by "Send test" button)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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
  cameras: string[];
  label: string | null;
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
  smtp_host: string | null;
  smtp_port: number;
  smtp_username: string | null;
  smtp_password: string | null;
  smtp_secure: string; // 'none' | 'starttls' | 'tls'
};

type CamState = { name: string; online: boolean; since: string };

function trimUrl(u: string) { return u.replace(/\/+$/, ""); }

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${h}h ${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

async function fetchFrigateStats(inst: Instance): Promise<{ online: string[]; offline: string[]; reachable: boolean }> {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (inst.api_key) headers["Authorization"] = `Bearer ${inst.api_key}`;
    const r = await fetch(`${trimUrl(inst.base_url)}/api/stats`, { headers, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { online: [], offline: [], reachable: false };
    const j: any = await r.json();
    const cams = j?.cameras ?? {};
    const online: string[] = [];
    const offline: string[] = [];
    for (const [name, data] of Object.entries<any>(cams)) {
      const camFps = Number(data?.camera_fps ?? 0);
      if (camFps > 0) online.push(name); else offline.push(name);
    }
    return { online: online.sort(), offline: offline.sort(), reachable: true };
  } catch {
    return { online: [], offline: [], reachable: false };
  }
}

async function fetchAndUploadSnapshot(supabase: any, inst: Instance, camera: string): Promise<{ name: string; url: string } | null> {
  try {
    const headers: Record<string, string> = {};
    if (inst.api_key) headers["Authorization"] = `Bearer ${inst.api_key}`;
    const r = await fetch(`${trimUrl(inst.base_url)}/api/${encodeURIComponent(camera)}/latest.jpg?h=400`, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!blob.type.startsWith("image/")) return null;
    const safe = camera.replace(/[^a-zA-Z0-9_-]/g, "_");
    const path = `${inst.id}/${safe}.jpg`;
    await supabase.storage.from("camera-snapshots").upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "60" });
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    return { name: camera, url: `${supabaseUrl}/storage/v1/object/public/camera-snapshots/${path}` };
  } catch { return null; }
}


async function reconcileStatus(supabase: any, instId: string, online: string[], offline: string[]): Promise<Map<string, CamState>> {
  const now = new Date().toISOString();
  const { data: existing } = await supabase.from("camera_status").select("*").eq("instance_id", instId);
  const map = new Map<string, any>((existing ?? []).map((r: any) => [r.camera, r]));
  const result = new Map<string, CamState>();
  const upserts: any[] = [];
  const all = [...online.map((n) => ({ n, online: true })), ...offline.map((n) => ({ n, online: false }))];
  for (const { n, online: isOnline } of all) {
    const prev = map.get(n);
    if (!prev || prev.online !== isOnline) {
      upserts.push({ instance_id: instId, camera: n, online: isOnline, since: now, last_checked: now });
      result.set(n, { name: n, online: isOnline, since: now });
    } else {
      upserts.push({ instance_id: instId, camera: n, online: isOnline, since: prev.since, last_checked: now });
      result.set(n, { name: n, online: isOnline, since: prev.since });
    }
  }
  if (upserts.length) {
    await supabase.from("camera_status").upsert(upserts, { onConflict: "instance_id,camera" });
  }
  return result;
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

async function listStoredSnapshots(supabase: any, instanceId: string): Promise<Array<{ name: string; url: string }>> {
  const { data: files } = await supabase.storage.from("camera-snapshots").list(instanceId, { limit: 1000 });
  if (!files?.length) return [];
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  return files
    .filter((f: any) => f.name?.endsWith(".jpg"))
    .map((f: any) => ({
      name: f.name.replace(/\.jpg$/, ""),
      url: `${supabaseUrl}/storage/v1/object/public/camera-snapshots/${instanceId}/${f.name}`,
    }));
}

function render(template: string, data: Record<string, string>) {
  return template.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);
}

function esc(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
}

function nl2br(s: string) {
  return s.split("\n").map((l) => esc(l)).join("<br/>");
}

async function buildEmail(cfg: Cfg, inst: Instance, providedSnapshots?: Array<{ name: string; url: string }>) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [statsAll, incidentsAll] = await Promise.all([
    fetchFrigateStats(inst),
    fetchPositiveIncidents(supabase, inst.id, since),
  ]);

  // Optional camera filter for multi-site NVRs
  const filter = (cfg.cameras && cfg.cameras.length > 0) ? new Set(cfg.cameras) : null;

  // If NVR unreachable from cloud, fall back to last-known camera_status so we
  // don't wipe history and report bogus 0/0 counts.
  let effective = statsAll;
  if (!statsAll.reachable) {
    const { data: known } = await supabase.from("camera_status").select("camera, online").eq("instance_id", inst.id);
    effective = {
      online: (known ?? []).filter((r: any) => r.online).map((r: any) => r.camera).sort(),
      offline: (known ?? []).filter((r: any) => !r.online).map((r: any) => r.camera).sort(),
      reachable: false,
    };
  }
  const stats = filter
    ? { online: effective.online.filter((c) => filter.has(c)), offline: effective.offline.filter((c) => filter.has(c)) }
    : { online: effective.online, offline: effective.offline };
  const incidents = filter ? incidentsAll.filter((i: any) => filter.has(i.camera)) : incidentsAll;

  // Only reconcile camera_status when we actually reached the NVR; otherwise
  // preserve the existing `since` timestamps maintained by camera-watch.
  const status = statsAll.reachable
    ? await reconcileStatus(supabase, inst.id, statsAll.online, statsAll.offline)
    : new Map<string, CamState>(
        ((await supabase.from("camera_status").select("camera, online, since").eq("instance_id", inst.id)).data ?? [])
          .map((r: any) => [r.camera, { name: r.camera, online: r.online, since: r.since }]),
      );
  const now = Date.now();
  const offlineWithDur = stats.offline.map((n) => {
    const st = status.get(n);
    const dur = st ? now - new Date(st.since).getTime() : 0;
    return { name: n, since: st?.since ?? null, duration: formatDuration(dur) };
  });

  let snapshots = providedSnapshots?.length
    ? providedSnapshots
    : await listStoredSnapshots(supabase, inst.id);
  if (filter) snapshots = snapshots.filter((s) => filter.has(s.name));

  // If reachable and missing snapshots for some online cameras, fetch them now.
  if (statsAll.reachable) {
    const have = new Set(snapshots.map((s) => s.name));
    const missing = stats.online.filter((c) => !have.has(c));
    if (missing.length) {
      const fetched = await Promise.all(missing.map((c) => fetchAndUploadSnapshot(supabase, inst, c)));
      for (const f of fetched) if (f) snapshots.push(f);
    }
  }


  const date = new Date().toISOString().slice(0, 10);
  const siteName = cfg.label?.trim() || inst.name;
  const data: Record<string, string> = {
    nvr_name: inst.name,
    site_name: siteName,
    date,
    cameras_online_count: String(stats.online.length),
    cameras_offline_count: String(stats.offline.length),
    cameras_online_list: stats.online.length ? stats.online.map((c) => `• ${c}`).join("\n") : "(none)",
    cameras_offline_list: offlineWithDur.length
      ? offlineWithDur.map((o) => `• ${o.name} — offline for ${o.duration}`).join("\n")
      : "(none)",
    positive_incidents_count: String(incidents.length),
    positive_incidents_list: incidents.length
      ? incidents.map((i: any) => `• ${i.camera} @ ${new Date(i.ts).toLocaleString()}${i.note ? " — " + i.note : ""}`).join("\n")
      : "(none)",
  };

  const text = render(cfg.body_template, data);

  // Build HTML with snapshots gallery
  const snapsHtml = snapshots.map((s) => `
    <div style="display:inline-block;margin:4px;text-align:center;vertical-align:top;">
      <img src="${esc(s.url)}" alt="${esc(s.name)}" style="max-width:240px;height:auto;border-radius:6px;border:1px solid #ddd;display:block;" />
      <div style="font-size:12px;color:#444;margin-top:2px;">${esc(s.name)}</div>
    </div>`).join("");
  const offlineHtml = offlineWithDur.length
    ? `<ul style="margin:8px 0;padding-left:20px;">${offlineWithDur.map((o) => `<li><strong>${esc(o.name)}</strong> — offline for ${esc(o.duration)}</li>`).join("")}</ul>`
    : "";

  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111">
    ${nl2br(text)}
    ${offlineWithDur.length ? `<h3 style="margin-top:20px;color:#b91c1c;">Offline cameras</h3>${offlineHtml}` : ""}
    ${snapsHtml ? `<h3 style="margin-top:20px;">Latest snapshots</h3><div>${snapsHtml}</div>` : ""}
  </div>`;

  return { subject: render(cfg.subject, data), text, html };
}

async function sendViaSmtp(s: Settings, opts: { from: string; to: string[]; replyTo?: string | null; subject: string; html: string; text: string; }) {
  if (!s.smtp_host) throw new Error("SMTP not configured (host missing)");
  const tls = s.smtp_secure === "tls";
  const client = new SMTPClient({
    connection: {
      hostname: s.smtp_host,
      port: s.smtp_port || (tls ? 465 : 587),
      tls,
      auth: s.smtp_username && s.smtp_password
        ? { username: s.smtp_username, password: s.smtp_password }
        : undefined,
    },
  });
  try {
    await client.send({
      from: opts.from,
      to: opts.to,
      replyTo: opts.replyTo || undefined,
      subject: opts.subject,
      content: opts.text,
      html: opts.html,
    });
  } finally {
    await client.close();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* */ } }

  const onlyConfigId: string | undefined = body?.config_id;
  const preview: boolean = !!body?.preview;
  const overrideRecipients: string[] | undefined = body?.recipients;
  const providedSnapshots: Array<{ name: string; url: string }> | undefined = body?.snapshots;

  let q = supabase.from("daily_report_configs").select("*");
  if (onlyConfigId) q = q.eq("id", onlyConfigId); else q = q.eq("enabled", true);
  const { data: cfgs, error: cfgErr } = await q;
  if (cfgErr) return new Response(JSON.stringify({ error: cfgErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Cache per-org SMTP settings
  const settingsCache = new Map<string, Settings>();
  async function getSettingsForOrg(orgId: string): Promise<Settings> {
    if (settingsCache.has(orgId)) return settingsCache.get(orgId)!;
    const { data } = await supabase.from("daily_report_settings").select("*").eq("organization_id", orgId).limit(1).maybeSingle();
    const s = (data ?? {
      from_name: "Glance", from_email: "noreply@example.com", reply_to: null,
      smtp_host: null, smtp_port: 587, smtp_username: null, smtp_password: null, smtp_secure: "starttls",
    }) as Settings;
    settingsCache.set(orgId, s);
    return s;
  }

  const results: any[] = [];
  for (const cfg of (cfgs ?? []) as (Cfg & { organization_id: string })[]) {
    const { data: inst } = await supabase.from("frigate_instances").select("id, name, base_url, api_key").eq("id", cfg.instance_id).maybeSingle();
    if (!inst) { results.push({ config_id: cfg.id, status: "skipped", error: "instance missing" }); continue; }
    const s = await getSettingsForOrg(cfg.organization_id);
    const fromHeader = `${s.from_name} <${s.from_email}>`;
    const email = await buildEmail(cfg, inst as Instance, providedSnapshots);
    const recipients = overrideRecipients?.length ? overrideRecipients : cfg.recipients;
    if (preview) { results.push({ config_id: cfg.id, preview: email }); continue; }
    if (!recipients?.length) {
      await supabase.from("daily_report_runs").insert({ organization_id: cfg.organization_id, config_id: cfg.id, instance_id: cfg.instance_id, recipients: [], status: "skipped", error: "no recipients", subject: email.subject });
      results.push({ config_id: cfg.id, status: "skipped", error: "no recipients" });
      continue;
    }
    try {
      await sendViaSmtp(s, { from: fromHeader, to: recipients, replyTo: s.reply_to, subject: email.subject, html: email.html, text: email.text });
      await supabase.from("daily_report_runs").insert({ organization_id: cfg.organization_id, config_id: cfg.id, instance_id: cfg.instance_id, recipients, status: "sent", subject: email.subject });
      await supabase.from("daily_report_configs").update({ last_sent_at: new Date().toISOString() }).eq("id", cfg.id);
      results.push({ config_id: cfg.id, status: "sent", recipients });
    } catch (e: any) {
      await supabase.from("daily_report_runs").insert({ organization_id: cfg.organization_id, config_id: cfg.id, instance_id: cfg.instance_id, recipients, status: "failed", error: String(e?.message ?? e), subject: email.subject });
      results.push({ config_id: cfg.id, status: "failed", error: String(e?.message ?? e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
