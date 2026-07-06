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

function resolveMediaUrl(u: string | null | undefined): { url: string; authNeeded: boolean } | null {
  if (!u) return null;
  const raw = String(u).trim();
  if (!raw) return null;
  // Already absolute
  if (/^https?:\/\//i.test(raw)) return { url: raw, authNeeded: false };
  // Relative — assume this is a frigate-proxy path served by our own Supabase project.
  // Example stored value: "/<org-id>/api/events/<eid>/snapshot.jpg"
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!base) return null;
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return { url: `${base}/functions/v1/frigate-proxy${path}`, authNeeded: true };
}

async function fetchAsBase64(target: { url: string; authNeeded: boolean }): Promise<string | null> {
  try {
    const headers: Record<string, string> = {};
    if (target.authNeeded) {
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (key) {
        headers["Authorization"] = `Bearer ${key}`;
        headers["apikey"] = key;
      }
    }
    const r = await fetch(target.url, { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) {
      console.warn(`snapshot fetch ${r.status} for ${target.url}`);
      return null;
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    return btoa(binary);
  } catch (e) {
    console.warn(`snapshot fetch error: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

async function sendViaMudslide(
  mudslideUrl: string,
  token: string | null,
  to: string,
  message: string,
  extras: { image_base64?: string | null; image_url?: string | null; video_url?: string | null } = {},
) {
  const url = mudslideUrl.replace(/\/+$/, "") + "/send";
  const payload: Record<string, unknown> = { to, message };
  if (extras.image_base64) payload.image_base64 = extras.image_base64;
  else if (extras.image_url) payload.image_url = extras.image_url;
  if (extras.video_url) payload.video_url = extras.video_url;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000),
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
      .select("id, kind, url, clip_url, camera, topic, ts, event_id, instance_id")
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

    // Resolve possibly-relative frigate-proxy paths into absolute URLs.
    const snapshotTarget = resolveMediaUrl(snapshotUrl);
    const videoTarget = resolveMediaUrl(videoUrl);
    const snapshotAbs = snapshotTarget?.url ?? null;
    const videoAbs = videoTarget?.url ?? null;

    const lines: string[] = [];
    lines.push("✅ *Positive incident confirmed*");
    lines.push(`Camera: ${media?.camera ?? "unknown"}`);
    if (media?.topic) lines.push(`Source: ${media.topic}`);
    lines.push(`Time: ${timeStr}`);
    lines.push(`Tagged by: ${operatorName}`);
    lines.push(`Tag: ${tag.tag}`);
    if (tag.note && tag.note.trim()) lines.push(`Note: ${tag.note.trim()}`);
    if (videoAbs) lines.push(`\nVideo: ${videoAbs}`);
    if (settings.reply_footer) lines.push(`\n${settings.reply_footer}`);

    // Re-derive message after we know the resolved video URL.
    const message = lines.slice(0, 7 + (tag.note && tag.note.trim() ? 1 : 0)).join("\n");
    void message; // (kept for parity — full message below)
    const fullMessage = lines.join("\n");

    // Fetch snapshot as base64 so the listener host doesn't need outbound access.
    let imageB64: string | null = null;
    if (snapshotTarget) imageB64 = await fetchAsBase64(snapshotTarget);

    let sendError: string | null = null;
    let sentWithImage = false;
    try {
      await sendViaMudslide(settings.mudslide_url, settings.mudslide_token, groupJid, fullMessage, {
        image_base64: imageB64,
        // Only pass an absolute URL if we couldn't base64 it ourselves.
        image_url: imageB64 ? null : snapshotAbs,
      });
      sentWithImage = Boolean(imageB64);
    } catch (e) {
      sendError = (e as Error)?.message ?? String(e);
      console.warn(`media send failed, falling back to text: ${sendError}`);
      const textOnly = snapshotAbs
        ? `${fullMessage}\n\nSnapshot: ${snapshotAbs}`
        : fullMessage;
      try {
        await sendViaMudslide(settings.mudslide_url, settings.mudslide_token, groupJid, textOnly);
      } catch (e2) {
        return j(502, { error: `send failed: ${sendError}; fallback: ${(e2 as Error)?.message ?? e2}` });
      }
    }

    await supabase.from("positive_alert_dispatches").insert({
      organization_id: orgId,
      media_id: tag.media_id,
      tag_id: tag.id,
      group_jid: groupJid,
    });

    return j(200, { ok: true, sent: true, group: groupJid, with_image: sentWithImage, fallback: sendError });
  } catch (e) {
    return j(500, { error: String((e as Error)?.message ?? e) });
  }
});
