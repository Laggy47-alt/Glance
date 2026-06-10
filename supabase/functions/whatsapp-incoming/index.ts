// Receives incoming WhatsApp replies forwarded from Mudslide (or any proxy).
// POST body: {
//   organization_id: string,
//   sender: string,         // E.164 or JID
//   message: string,
//   sender_name?: string,
//   message_id?: string,
// }
// Auth: Authorization: Bearer <incoming_webhook_secret> (if configured in whatsapp_settings)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Settings = {
  enabled: boolean;
  mudslide_url: string | null;
  incoming_webhook_secret: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const organization_id: string | undefined = body?.organization_id;
    if (!organization_id) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settings } = await supabase
      .from("whatsapp_settings")
      .select("enabled, mudslide_url, incoming_webhook_secret")
      .eq("organization_id", organization_id)
      .maybeSingle();

    const s = settings as Settings | null;
    if (!s) {
      return new Response(JSON.stringify({ error: "WhatsApp settings not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!s.enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify webhook secret if one is configured
    if (s.incoming_webhook_secret) {
      const auth = req.headers.get("authorization") ?? "";
      const expected = `Bearer ${s.incoming_webhook_secret}`;
      if (auth !== expected) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const sender = typeof body?.sender === "string" ? body.sender.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!sender || !message) {
      return new Response(JSON.stringify({ error: "sender and message are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await supabase.from("whatsapp_incoming_messages").insert({
      organization_id,
      sender,
      sender_name: typeof body?.sender_name === "string" ? body.sender_name.trim() : null,
      message,
      message_id: typeof body?.message_id === "string" ? body.message_id.trim() : null,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
