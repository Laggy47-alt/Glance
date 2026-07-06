// Sends a WhatsApp message to a per-organization group when an operator
// tags a media item as a "positive" incident.
//
// POST body: { media_tag_id: string }
//
// Reads the same whatsapp_settings row that offline alerts use (mudslide_url,
// mudslide_token) plus three new columns:
//   positive_alert_enabled
//   positive_alert_group_jid
//   positive_alert_cooldown_seconds
//
// Dedupes on media_id within the cooldown window using
// positive_alert_dispatches.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendViaMudslide(
  mudslideUrl: string,
  token: string | null,
  to: string,
  message: string,
  extras: { image_url?: string | null; video_url?: string | null } = {},
) {
  const url = mudslideUrl.replace(/\/+$/, "") + "/send";
  const payload: Record<string, unknown> = { to, message };
  if (extras.image_url) payload.image_url = extras.image_url;
  if (extras.video_url) payload.video_url = extras.video_url;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Mudslide ${r.status}: ${t.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return j(401, { error: "unauthorized" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify the JWT is real (we just need a valid user).
    const { data: userData } = await supabase.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!userData?.user) return j(401, { error: "unauthorized" });

    const body = await req.json().catch(() => ({}));
    const mediaTagId: string | undefined = body?.media_tag_id;
    if (!mediaTagId) return j(400, { error: "media_tag_id required" });

    // Load the tag + parent media in two lookups (avoid PostgREST relationship inference).
    const { data: tag, error: tagErr } = await supabase
      .from("media_tags")
      .select("id, media_id, tag, note, created_by, organization_id, created_at")
      .eq("id", mediaTagId)
      .maybeSingle();
    if (tagErr || !tag) return j(404, { error: "tag not found" });
    if (!/^positive/i.test(tag.tag ?? "")) {
      return j(200, { ok: true, skipped: "not_positive" });
    }

    const orgId = tag.organization_id as string;

    const { data: settings } = await supabase
      .from("whatsapp_settings")
      .select("mudslide_url, mudslide_token, positive_alert_enabled, positive_alert_group_jid, positive_alert_cooldown_seconds, reply_footer")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!settings) return j(200, { ok: true, skipped: "no_settings" });
    if (!settings.positive_alert_enabled) return j(200, { ok: true, skipped: "disabled" });
    const groupJid = String(settings.positive_alert_group_jid ?? "").trim();
    if (!groupJid) return j(200, { ok: true, skipped: "no_group_jid" });
    if (!settings.mudslide_url) return j(200, { ok: true, skipped: "no_mudslide_url" });

    const cooldownSec = Math.max(0, Number(settings.positive_alert_cooldown_seconds ?? 60));
    if (cooldownSec > 0) {
      const since = new Date(Date.now() - cooldownSec * 1000).toISOString();
      const { data: recent } = await supabase
        .from("positive_alert_dispatches")
        .select("id")
        .eq("media_id", tag.media_id)
        .gte("sent_at", since)
        .limit(1);
      if (recent && recent.length > 0) return j(200, { ok: true, skipped: "cooldown" });
    }

    // Load the media item + any sibling clip for the same event so we can
    // include both snapshot and video URLs.
    const { data: media } = await supabase
      .from("media_items")
      .select("id, kind, url, clip_url, camera, topic, ts, event_id")
      .eq("id", tag.media_id)
      .maybeSingle();

    let snapshotUrl: string | null = null;
    let videoUrl: string | null = null;

    if (media) {
      if (media.kind === "snapshot") snapshotUrl = media.url ?? null;
      if (media.kind === "clip") videoUrl = media.url ?? null;
      if (!videoUrl && media.clip_url) videoUrl = media.clip_url;

      // If the media is a snapshot without a clip_url, try to find a sibling
      // clip on the same event.
      if (!videoUrl && media.event_id) {
        const { data: sibling } = await supabase
          .from("media_items")
          .select("url, kind")
          .eq("event_id", media.event_id)
          .eq("kind", "clip")
          .limit(1)
          .maybeSingle();
        if (sibling?.url) videoUrl = sibling.url;
      }
      // Same for snapshot when the tagged item is a clip.
      if (!snapshotUrl && media.kind === "clip" && media.event_id) {
        const { data: sibling } = await supabase
          .from("media_items")
          .select("url, kind")
          .eq("event_id", media.event_id)
          .eq("kind", "snapshot")
          .limit(1)
          .maybeSingle();
        if (sibling?.url) snapshotUrl = sibling.url;
      }
    }

    // Operator display name
    let operatorName = "operator";
    if (tag.created_by) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, username")
        .eq("user_id", tag.created_by)
        .maybeSingle();
      operatorName = profile?.display_name || profile?.username || "operator";
    }

    const when = media?.ts ? new Date(media.ts) : new Date(tag.created_at);
    const timeStr = when.toLocaleString("en-GB", { timeZone: "Africa/Johannesburg" });

    const lines: string[] = [];
    lines.push("✅ *Positive incident confirmed*");
    lines.push(`Camera: ${media?.camera ?? "unknown"}`);
    if (media?.topic) lines.push(`Source: ${media.topic}`);
    lines.push(`Time: ${timeStr}`);
    lines.push(`Tagged by: ${operatorName}`);
    lines.push(`Tag: ${tag.tag}`);
    if (tag.note && tag.note.trim()) lines.push(`Note: ${tag.note.trim()}`);
    if (snapshotUrl) lines.push(`\nSnapshot: ${snapshotUrl}`);
    if (videoUrl) lines.push(`Video: ${videoUrl}`);
    if (settings.reply_footer) lines.push(`\n${settings.reply_footer}`);

    const message = lines.join("\n");

    await sendViaMudslide(settings.mudslide_url, settings.mudslide_token, groupJid, message);

    await supabase.from("positive_alert_dispatches").insert({
      organization_id: orgId,
      media_id: tag.media_id,
      tag_id: tag.id,
      group_jid: groupJid,
    });

    return j(200, { ok: true, sent: true, group: groupJid });
  } catch (e) {
    return j(500, { error: String((e as Error)?.message ?? e) });
  }
});
