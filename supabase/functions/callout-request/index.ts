// Sends an email when a customer requests a callout.
// Body: { callout_id, nvr_name, camera, reason, requester_name }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const nvr_name = String(body?.nvr_name ?? "Unknown NVR");
    const camera = body?.camera ? String(body.camera) : null;
    const reason = body?.reason ? String(body.reason) : "";
    const requester = String(body?.requester_name ?? "A customer");
    const organization_id = body?.organization_id ? String(body.organization_id) : null;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Single-tenant: no subscription gating.


    let settingsQ = supabase.from("callout_settings").select("*").limit(1);
    let smtpQ = supabase.from("daily_report_settings").select("*").limit(1);
    if (organization_id) {
      settingsQ = settingsQ.eq("organization_id", organization_id);
      smtpQ = smtpQ.eq("organization_id", organization_id);
    }
    const [{ data: settings }, { data: smtp }] = await Promise.all([
      settingsQ.maybeSingle(),
      smtpQ.maybeSingle(),
    ]);

    const recipients: string[] = (settings?.recipients ?? []).filter((r: string) => typeof r === "string" && r.includes("@"));
    if (!recipients.length) {
      return new Response(JSON.stringify({ error: "No callout recipients configured. Configure them in Callout Requests → Notification settings." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!smtp?.smtp_host) {
      return new Response(JSON.stringify({ error: "SMTP not configured. Set it up in Daily Reports settings." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const subjTpl: string = settings?.subject || "Callout request — {{nvr_name}}";
    const subject = subjTpl
      .replaceAll("{{nvr_name}}", nvr_name)
      .replaceAll("{{camera}}", camera ?? "")
      .replaceAll("{{requester}}", requester);

    const cameraList = (camera ?? "")
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const camerasHtml = cameraList.length
      ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;">Camera${cameraList.length === 1 ? "" : "s"}</td><td>${cameraList.map((c) => `<div>${esc(c)}</div>`).join("")}</td></tr>`
      : "";

    const when = new Date().toLocaleString();
    const reasonHtml = reason
      ? `<div style="margin:14px 0;padding:10px 12px;background:#fff7ed;border-left:3px solid #ea580c;color:#7c2d12;white-space:pre-wrap;">${esc(reason)}</div>`
      : "";

    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111;"><h2 style="margin:0 0 6px;color:#b45309;">Callout request</h2><div style="color:#6b7280;font-size:12px;margin-bottom:14px;">Submitted ${esc(when)}</div><table style="border-collapse:collapse;font-size:14px;"><tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Customer</td><td><strong>${esc(requester)}</strong></td></tr><tr><td style="padding:4px 12px 4px 0;color:#6b7280;">NVR</td><td><strong>${esc(nvr_name)}</strong></td></tr>${camerasHtml}</table>${reasonHtml}</div>`;

    const text = [
      `Callout request (${when})`,
      `Customer: ${requester}`,
      `NVR: ${nvr_name}`,
      cameraList.length ? `Camera${cameraList.length === 1 ? "" : "s"}:\n${cameraList.map((c) => `  - ${c}`).join("\n")}` : "",
      "",
      reason ? `Details:\n${reason}` : "",
    ].filter(Boolean).join("\n");

    const tls = smtp.smtp_secure === "tls";
    const client = new SMTPClient({
      connection: {
        hostname: smtp.smtp_host,
        port: smtp.smtp_port || (tls ? 465 : 587),
        tls,
        auth: smtp.smtp_username && smtp.smtp_password ? { username: smtp.smtp_username, password: smtp.smtp_password } : undefined,
      },
    });
    try {
      await client.send({
        from: `${smtp.from_name} <${smtp.from_email}>`,
        to: recipients,
        replyTo: smtp.reply_to || undefined,
        subject,
        content: text,
        html,
      });
    } finally {
      await client.close();
    }




    return new Response(JSON.stringify({ ok: true, recipients, subject }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
