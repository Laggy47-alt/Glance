// Sends an email to platform support when an org admin submits a "Request Callout (Admin)".
// Body: { subject, message, requester_name, organization_name }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPPORT_EMAIL = "charl@firstglance.digital";
const FROM_EMAIL = "Glance Support <onboarding@resend.dev>";

const esc = (s: string) =>
  s.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const subject = String(body?.subject ?? "").trim();
    const message = String(body?.message ?? "").trim();
    const requester = String(body?.requester_name ?? "An admin").trim() || "An admin";
    const orgName = String(body?.organization_name ?? "").trim();

    if (!subject) {
      return new Response(JSON.stringify({ error: "Subject is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fullSubject = `[Glance Support] ${subject}${orgName ? ` — ${orgName}` : ""}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222">
        <h2 style="margin:0 0 12px">New admin support request</h2>
        <p style="margin:0 0 6px"><strong>From:</strong> ${esc(requester)}</p>
        ${orgName ? `<p style="margin:0 0 6px"><strong>Organization:</strong> ${esc(orgName)}</p>` : ""}
        <p style="margin:0 0 6px"><strong>Subject:</strong> ${esc(subject)}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
        <p style="white-space:pre-wrap;margin:0">${esc(message || "(no details provided)")}</p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [SUPPORT_EMAIL],
        subject: fullSubject,
        html,
        reply_to: body?.reply_to ? String(body.reply_to) : undefined,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.message ?? `Resend ${res.status}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: data?.id ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
