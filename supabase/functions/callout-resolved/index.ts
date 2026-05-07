// Sends an email to the customer's contact_email when their callout is marked resolved.
// Body: { callout_id }

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
    const callout_id = String(body?.callout_id ?? "");
    if (!callout_id) {
      return new Response(JSON.stringify({ error: "callout_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: callout, error: cErr } = await supabase
      .from("callout_requests")
      .select("id, instance_id, camera, reason, requested_by, requester_name, admin_note, resolved_at, organization_id")
      .eq("id", callout_id)
      .maybeSingle();
    if (cErr || !callout) {
      return new Response(JSON.stringify({ error: "callout not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!callout.requested_by) {
      return new Response(JSON.stringify({ error: "callout has no requester" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("contact_email, display_name, username")
      .eq("user_id", callout.requested_by)
      .maybeSingle();

    const recipient = profile?.contact_email;
    if (!recipient) {
      return new Response(JSON.stringify({ error: "Customer has no contact email on file." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: nvr } = await supabase
      .from("frigate_instances")
      .select("name")
      .eq("id", callout.instance_id)
      .maybeSingle();

    const { data: smtp } = await supabase.from("daily_report_settings")
      .select("*").eq("organization_id", callout.organization_id).limit(1).maybeSingle();
    if (!smtp?.smtp_host) {
      return new Response(JSON.stringify({ error: "SMTP not configured. Set it up in Daily Reports settings." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nvr_name = nvr?.name ?? "your site";
    const customer = profile?.display_name || profile?.username || callout.requester_name || "there";
    const when = new Date(callout.resolved_at ?? new Date().toISOString()).toLocaleString();
    const subject = `Callout resolved — ${nvr_name}`;

    const cameraList = (callout.camera ?? "")
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const camerasHtml = cameraList.length
      ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;">Camera${cameraList.length === 1 ? "" : "s"}</td><td>${cameraList.map((c) => `<div>${esc(c)}</div>`).join("")}</td></tr>`
      : "";

    const reasonHtml = callout.reason
      ? `<div style="margin:6px 0 4px;color:#6b7280;font-size:12px;">Original reason</div><div style="margin:0 0 14px;padding:10px 12px;background:#f9fafb;border-left:3px solid #9ca3af;color:#374151;white-space:pre-wrap;">${esc(callout.reason)}</div>`
      : "";

    const noteHtml = callout.admin_note
      ? `<div style="margin:6px 0 4px;color:#6b7280;font-size:12px;">How it was resolved</div><div style="margin:0 0 14px;padding:10px 12px;background:#ecfdf5;border-left:3px solid #16a34a;color:#14532d;white-space:pre-wrap;">${esc(callout.admin_note)}</div>`
      : `<p style="color:#6b7280;font-style:italic;">No additional notes were added.</p>`;

    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111;"><h2 style="margin:0 0 6px;color:#15803d;">Your callout has been resolved</h2><div style="color:#6b7280;font-size:12px;margin-bottom:14px;">Resolved ${esc(when)}</div><p style="margin:0 0 12px;">Hi ${esc(customer)},</p><p style="margin:0 0 12px;">Your callout request for <strong>${esc(nvr_name)}</strong> has been marked as resolved.</p><table style="border-collapse:collapse;font-size:14px;margin-bottom:14px;"><tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Site</td><td><strong>${esc(nvr_name)}</strong></td></tr>${camerasHtml}</table>${reasonHtml}${noteHtml}<p style="color:#6b7280;font-size:12px;margin-top:18px;">Thank you,<br/>The operations team</p></div>`;

    const text = [
      `Your callout has been resolved (${when})`,
      `Site: ${nvr_name}`,
      cameraList.length ? `Camera${cameraList.length === 1 ? "" : "s"}:\n${cameraList.map((c) => `  - ${c}`).join("\n")}` : "",
      "",
      callout.reason ? `Original reason:\n${callout.reason}` : "",
      "",
      callout.admin_note ? `How it was resolved:\n${callout.admin_note}` : "No additional notes were added.",
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
        to: [recipient],
        replyTo: smtp.reply_to || undefined,
        subject,
        content: text,
        html,
      });
    } finally {
      await client.close();
    }

    return new Response(JSON.stringify({ ok: true, recipient }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
