// Sends WhatsApp alerts via a self-hosted Mudslide instance.
//
// POST body: {
//   organization_id: string,
//   recipients?: string[],          // optional override; otherwise default_recipients from settings
//   message?: string,               // optional pre-rendered message
//   nvrs?: Array<{ name: string; reachable: boolean; offlineCameras: string[] }>,
//   minutes?: number,               // for template rendering
//   test?: boolean,                 // test ping
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Settings = {
  enabled: boolean;
  mudslide_url: string | null;
  mudslide_token: string | null;
  default_recipients: string[];
  alert_template: string;
  recovery_template: string;
  reply_footer: string | null;
  quiet_hours_enabled: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  quiet_timezone: string;
  max_alerts_per_hour: number;
  last_sent_at: string | null;
};

function render(tpl: string, vars: Record<string, string | number>) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
}

function inQuietHours(s: Settings): boolean {
  if (!s.quiet_hours_enabled || !s.quiet_start || !s.quiet_end) return false;
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: s.quiet_timezone || "UTC",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.format(now); // "HH:MM"
    const [h, m] = parts.split(":").map(Number);
    const cur = h * 60 + m;
    const [sh, sm] = s.quiet_start.split(":").map(Number);
    const [eh, em] = s.quiet_end.split(":").map(Number);
    const start = sh * 60 + sm, end = eh * 60 + em;
    if (start === end) return false;
    return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
  } catch { return false; }
}

async function sendViaMudslide(s: Settings, recipient: string, message: string) {
  const url = s.mudslide_url!.replace(/\/+$/, "") + "/send-message";
  const headers = {
    "Content-Type": "application/json",
    ...(s.mudslide_token ? { "Authorization": `Bearer ${s.mudslide_token}` } : {}),
  };
  const body = JSON.stringify({ recipient, message });

  let lastErr: unknown = null;
  // 1 initial attempt + 1 retry after 2s for transient socket timeouts
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`Mudslide ${r.status}: ${t.slice(0, 200)}`);
      }
      return; // success
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((res) => setTimeout(res, 2000));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const organization_id: string | undefined = body?.organization_id;
    if (!organization_id) {
      return new Response(JSON.stringify({ error: "organization_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: settings } = await supabase
      .from("whatsapp_settings")
      .select("*")
      .eq("organization_id", organization_id)
      .maybeSingle();

    const s = settings as Settings | null;
    if (!s) return new Response(JSON.stringify({ error: "WhatsApp settings not configured" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!s.enabled) return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!s.mudslide_url) return new Response(JSON.stringify({ error: "mudslide_url not set" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (!body?.test && inQuietHours(s)) {
      return new Response(JSON.stringify({ ok: true, skipped: "quiet_hours" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const recipients: string[] = Array.isArray(body?.recipients) && body.recipients.length
      ? body.recipients
      : (s.default_recipients ?? []);
    const isValidRecipient = (r: string) => /^\+?\d{6,}$/.test(r) || /@(g\.us|s\.whatsapp\.net|c\.us|broadcast)$/i.test(r);
    const cleaned = recipients.map((r) => String(r).trim()).filter(isValidRecipient);
    if (!cleaned.length) {
      return new Response(JSON.stringify({ error: "No valid E.164 recipients" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let message: string = typeof body?.message === "string" && body.message.trim() ? body.message : "";
    if (!message) {
      const nvrs = Array.isArray(body?.nvrs) ? body.nvrs : [];
      const minutes = Number(body?.minutes ?? 0);
      const blocks: string[] = [];
      for (const n of nvrs) {
        const cams: string[] = n.offlineCameras ?? [];
        const camsStr = cams.map((c: string) => `• ${c}`).join("\n");
        blocks.push(render(s.alert_template, {
          nvr: n.name, count: cams.length, minutes, cameras: camsStr,
          status: n.reachable ? "online" : "UNREACHABLE",
        }));
      }
      message = blocks.join("\n\n");
    }
    if (!message.trim()) message = "ABC Glance alert";
    if (s.reply_footer) {
      message = message.trim() + "\n\n" + s.reply_footer.trim();
    }

    // Rate limit (global per org, last hour)
    if (!body?.test && s.max_alerts_per_hour > 0) {
      const since = new Date(Date.now() - 60 * 60_000).toISOString();
      const { count } = await supabase
        .from("camera_offline_alerts")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organization_id)
        .gte("created_at", since);
      if ((count ?? 0) >= s.max_alerts_per_hour) {
        return new Response(JSON.stringify({ ok: true, skipped: "rate_limited" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const errors: string[] = [];
    // Send sequentially, one at a time, with a delay between recipients so
    // Mudslide / WhatsApp doesn't get hit with a burst.
    const delayMs = Number(Deno.env.get("WHATSAPP_SEND_DELAY_MS") ?? 1500);
    for (let i = 0; i < cleaned.length; i++) {
      const r = cleaned[i];
      try { await sendViaMudslide(s, r, message); }
      catch (e: any) { errors.push(`${r}: ${String(e?.message ?? e)}`); }
      if (i < cleaned.length - 1 && delayMs > 0) {
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }

    await supabase.from("whatsapp_settings")
      .update({ last_sent_at: new Date().toISOString() })
      .eq("organization_id", organization_id);

    return new Response(JSON.stringify({ ok: errors.length === 0, sent: cleaned.length - errors.length, errors }), {
      status: errors.length && errors.length === cleaned.length ? 502 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
