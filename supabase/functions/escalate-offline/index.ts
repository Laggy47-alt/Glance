// Sends an escalation email about offline cameras / NVRs using the same
// SMTP settings configured in `daily_report_settings`.
//
// POST body: {
//   recipients: string[],
//   subject?: string,
//   note?: string,
//   nvrs: Array<{ name: string; reachable: boolean; offlineCameras: string[] }>
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Settings = {
  from_name: string;
  from_email: string;
  reply_to: string | null;
  smtp_host: string | null;
  smtp_port: number;
  smtp_username: string | null;
  smtp_password: string | null;
  smtp_secure: string;
};

function esc(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const recipients: string[] = Array.isArray(body?.recipients) ? body.recipients.filter((x: any) => typeof x === "string" && x.includes("@")) : [];
    const note: string = typeof body?.note === "string" ? body.note : "";
    const nvrs: Array<{ name: string; reachable: boolean; offlineCameras: string[] }> = Array.isArray(body?.nvrs) ? body.nvrs : [];

    if (!recipients.length) {
      return new Response(JSON.stringify({ error: "No recipients provided" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const organization_id = body?.organization_id ? String(body.organization_id) : null;
    let settings: any = null;
    if (organization_id) {
      const { data } = await supabase.from("daily_report_settings").select("*").eq("organization_id", organization_id).limit(1).maybeSingle();
      settings = data;
    }
    if (!settings?.smtp_host) {
      const { data } = await supabase.from("daily_report_settings").select("*").not("smtp_host", "is", null).limit(1).maybeSingle();
      if (data) settings = data;
    }
    const s: Settings | null = settings as Settings | null;
    if (!s?.smtp_host) {
      return new Response(JSON.stringify({ error: "SMTP not configured. Set it up in Daily Reports settings." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const totalOfflineCams = nvrs.reduce((a, n) => a + n.offlineCameras.length, 0);
    const unreachable = nvrs.filter((n) => !n.reachable).length;
    const subject: string = body?.subject || `[Escalation] ${unreachable} NVR${unreachable === 1 ? "" : "s"} unreachable · ${totalOfflineCams} camera${totalOfflineCams === 1 ? "" : "s"} offline`;

    const when = new Date().toLocaleString();
    const sectionsHtml = nvrs.map((n) => `
      <div style="margin:12px 0;padding:10px 12px;border:1px solid #e5e7eb;border-radius:6px;background:#fafafa;">
        <div style="font-weight:600;color:#111;">${esc(n.name)} ${n.reachable ? "" : `<span style="color:#b91c1c;font-weight:500;">(unreachable)</span>`}</div>
        ${n.offlineCameras.length
          ? `<ul style="margin:6px 0 0;padding-left:20px;color:#374151;">${n.offlineCameras.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
          : `<div style="color:#6b7280;font-size:13px;margin-top:4px;">No offline cameras${n.reachable ? "" : " reported (NVR not reachable)"}.</div>`}
      </div>`).join("");

    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111;">
      <h2 style="margin:0 0 6px;color:#b91c1c;">Offline equipment escalation</h2>
      <div style="color:#6b7280;font-size:12px;margin-bottom:14px;">Reported at ${esc(when)}</div>
      ${note ? `<div style="margin:0 0 14px;padding:10px 12px;background:#fff7ed;border-left:3px solid #ea580c;color:#7c2d12;"><strong>Note:</strong><br/>${esc(note).replace(/\n/g, "<br/>")}</div>` : ""}
      <p><strong>${unreachable}</strong> NVR(s) unreachable · <strong>${totalOfflineCams}</strong> camera(s) offline.</p>
      ${sectionsHtml}
    </div>`;

    const text = [
      `Offline equipment escalation (${when})`,
      note ? `\nNote: ${note}\n` : "",
      `${unreachable} NVR(s) unreachable, ${totalOfflineCams} camera(s) offline.`,
      "",
      ...nvrs.map((n) => `${n.name}${n.reachable ? "" : " (unreachable)"}\n` + (n.offlineCameras.length ? n.offlineCameras.map((c) => `  - ${c}`).join("\n") : "  (no offline cameras reported)")),
    ].join("\n");

    const tls = s.smtp_secure === "tls";
    const client = new SMTPClient({
      connection: {
        hostname: s.smtp_host,
        port: s.smtp_port || (tls ? 465 : 587),
        tls,
        auth: s.smtp_username && s.smtp_password ? { username: s.smtp_username, password: s.smtp_password } : undefined,
      },
    });

    try {
      await client.send({
        from: `${s.from_name} <${s.from_email}>`,
        to: recipients,
        replyTo: s.reply_to || undefined,
        subject,
        content: text,
        html,
      });
    } finally {
      await client.close();
    }

    return new Response(JSON.stringify({ ok: true, recipients, subject }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
