// Extracts snapshot/clip URLs from MQTT message payloads.

export type MediaItem = {
  kind: "snapshot" | "clip";
  url: string;
  camera: string; // inferred camera name
  ts: number;
  topic: string;
  thumbnail?: string;
};

const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i;
const VID_EXT = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

const SNAPSHOT_KEYS = ["snapshot", "snapshot_url", "snapshotUrl", "image", "image_url", "imageUrl", "thumbnail", "thumb"];
const CLIP_KEYS = ["clip", "clip_url", "clipUrl", "video", "video_url", "videoUrl", "recording", "recording_url"];

function isUrl(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^https?:\/\//i.test(s) || s.startsWith("/") || s.startsWith("data:image") || s.startsWith("data:video");
}

function pickKey(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    if (k in obj && isUrl(obj[k])) return obj[k] as string;
  }
  return undefined;
}

export function inferCamera(topic: string): string {
  // common patterns: cameras/<name>/..., frigate/<name>/..., <name>/snapshot
  const parts = topic.split("/").filter(Boolean);
  const known = ["cameras", "camera", "frigate", "cam", "ipcam", "unifi", "protect"];
  for (let i = 0; i < parts.length - 1; i++) {
    if (known.includes(parts[i].toLowerCase())) return parts[i + 1];
  }
  // fallback: second-to-last segment, or first
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] ?? "unknown";
}

export function extractMedia(topic: string, payload: string, ts: number): MediaItem[] {
  const items: MediaItem[] = [];
  const camera = inferCamera(topic);

  const trimmed = payload.trim();

  // 1. Bare URL string
  if (IMG_EXT.test(trimmed) && isUrl(trimmed)) {
    items.push({ kind: "snapshot", url: trimmed, camera, ts, topic });
    return items;
  }
  if (VID_EXT.test(trimmed) && isUrl(trimmed)) {
    items.push({ kind: "clip", url: trimmed, camera, ts, topic });
    return items;
  }

  // 2. JSON payload
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const obj = JSON.parse(trimmed);
      const objs = Array.isArray(obj) ? obj : [obj];
      for (const o of objs) {
        if (!o || typeof o !== "object") continue;
        const rec = o as Record<string, unknown>;
        const snap = pickKey(rec, SNAPSHOT_KEYS);
        const clip = pickKey(rec, CLIP_KEYS);
        const cam = (typeof rec.camera === "string" && rec.camera) ||
                    (typeof rec.device === "string" && rec.device) ||
                    (typeof rec.name === "string" && rec.name) ||
                    camera;
        if (snap) items.push({ kind: "snapshot", url: snap, camera: cam, ts, topic });
        if (clip) items.push({ kind: "clip", url: clip, camera: cam, ts, topic, thumbnail: snap });
      }
    } catch {
      // not JSON, ignore
    }
  }

  return items;
}
