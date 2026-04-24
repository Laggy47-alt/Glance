import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type WebhookSource = {
  id: string;
  name: string;
  slug: string;
  secret: string;
  color: string;
  enabled: boolean;
  created_at: string;
};

export type WebhookEvent = {
  id: string;
  source_id: string;
  topic: string;
  payload: Record<string, unknown> | unknown[];
  payload_text: string | null;
  headers: Record<string, string>;
  read: boolean;
  archived: boolean;
  ts: string;
  frigate_event_id?: string | null;
  label?: string | null;
  camera?: string | null;
  score?: number | null;
  kind?: string | null;
};

export type AutoReadRule = {
  id: string;
  source_id: string | null;
  pattern: string;
  enabled: boolean;
  created_at: string;
};

export type MediaItem = {
  id: string;
  source_id: string;
  event_id: string | null;
  kind: "snapshot" | "clip";
  url: string;
  camera: string | null;
  topic: string | null;
  ts: string;
  instance_id?: string | null;
  frigate_event_id?: string | null;
};

export type FrigateInstance = {
  id: string;
  source_id: string;
  name: string;
  base_url: string;
  api_key: string | null;
  color: string;
  enabled: boolean;
  poll_enabled: boolean;
  poll_interval_seconds: number;
  last_polled_at: string | null;
  last_event_ts: string | null;
  last_error: string | null;
  is_local: boolean;
  created_at: string;
};

type Listener = () => void;

class WebhookStore {
  sources: WebhookSource[] = [];
  events: WebhookEvent[] = [];
  rules: AutoReadRule[] = [];
  media: MediaItem[] = [];
  frigates: FrigateInstance[] = [];
  loaded = false;
  error: string | null = null;

  private listeners = new Set<Listener>();
  private channels: RealtimeChannel[] = [];
  private initialized = false;

  subscribe(l: Listener) {
    this.listeners.add(l);
    if (!this.initialized) {
      this.initialized = true;
      this.init();
    }
    return () => this.listeners.delete(l);
  }

  private emit() { this.listeners.forEach((l) => l()); }

  private async init() {
    await this.refreshAll();
    this.subscribeRealtime();
  }

  async refreshAll() {
    try {
      const [s, e, r, m, f] = await Promise.all([
        supabase.from("webhook_sources").select("*").order("created_at", { ascending: true }),
        supabase.from("webhook_events").select("*").order("ts", { ascending: false }).limit(500),
        supabase.from("auto_read_rules").select("*").order("created_at", { ascending: true }),
        supabase.from("media_items").select("*").order("ts", { ascending: false }).limit(200),
        supabase.from("frigate_instances").select("*").order("created_at", { ascending: true }),
      ]);
      this.sources = (s.data ?? []) as WebhookSource[];
      this.events = (e.data ?? []) as WebhookEvent[];
      this.rules = (r.data ?? []) as AutoReadRule[];
      this.media = (m.data ?? []) as MediaItem[];
      this.frigates = (f.data ?? []) as FrigateInstance[];
      this.loaded = true;
      this.error = null;
    } catch (err) {
      this.error = (err as Error).message;
    }
    this.emit();
  }

  private subscribeRealtime() {
    const ch = supabase
      .channel("webhook-store")
      .on("postgres_changes", { event: "*", schema: "public", table: "webhook_sources" }, (p) => {
        if (p.eventType === "INSERT") this.sources = [...this.sources, p.new as WebhookSource];
        else if (p.eventType === "UPDATE") this.sources = this.sources.map((x) => x.id === (p.new as WebhookSource).id ? (p.new as WebhookSource) : x);
        else if (p.eventType === "DELETE") this.sources = this.sources.filter((x) => x.id !== (p.old as WebhookSource).id);
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "webhook_events" }, (p) => {
        if (p.eventType === "INSERT") this.events = [p.new as WebhookEvent, ...this.events].slice(0, 500);
        else if (p.eventType === "UPDATE") this.events = this.events.map((x) => x.id === (p.new as WebhookEvent).id ? (p.new as WebhookEvent) : x);
        else if (p.eventType === "DELETE") this.events = this.events.filter((x) => x.id !== (p.old as WebhookEvent).id);
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "auto_read_rules" }, (p) => {
        if (p.eventType === "INSERT") this.rules = [...this.rules, p.new as AutoReadRule];
        else if (p.eventType === "UPDATE") this.rules = this.rules.map((x) => x.id === (p.new as AutoReadRule).id ? (p.new as AutoReadRule) : x);
        else if (p.eventType === "DELETE") this.rules = this.rules.filter((x) => x.id !== (p.old as AutoReadRule).id);
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "media_items" }, (p) => {
        if (p.eventType === "INSERT") this.media = [p.new as MediaItem, ...this.media].slice(0, 200);
        else if (p.eventType === "DELETE") this.media = this.media.filter((x) => x.id !== (p.old as MediaItem).id);
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "frigate_instances" }, (p) => {
        if (p.eventType === "INSERT") this.frigates = [...this.frigates, p.new as FrigateInstance];
        else if (p.eventType === "UPDATE") this.frigates = this.frigates.map((x) => x.id === (p.new as FrigateInstance).id ? (p.new as FrigateInstance) : x);
        else if (p.eventType === "DELETE") this.frigates = this.frigates.filter((x) => x.id !== (p.old as FrigateInstance).id);
        this.emit();
      })
      .subscribe();
    this.channels.push(ch);
  }

  // ─── Sources ───
  async createSource(input: { name: string; slug: string; color?: string }) {
    const secret = crypto.randomUUID().replace(/-/g, "");
    const { error } = await supabase.from("webhook_sources").insert({
      name: input.name,
      slug: input.slug,
      color: input.color ?? "#06b6d4",
      secret,
    });
    if (error) throw error;
  }
  async updateSource(id: string, patch: Partial<Pick<WebhookSource, "name" | "enabled" | "color" | "secret">>) {
    const { error } = await supabase.from("webhook_sources").update(patch).eq("id", id);
    if (error) throw error;
  }
  async deleteSource(id: string) {
    const { error } = await supabase.from("webhook_sources").delete().eq("id", id);
    if (error) throw error;
  }
  async rotateSecret(id: string) {
    const secret = crypto.randomUUID().replace(/-/g, "");
    await this.updateSource(id, { secret });
  }

  // ─── Events ───
  async markRead(id: string, read = true) {
    await supabase.from("webhook_events").update({ read }).eq("id", id);
  }
  async markAllRead() {
    await supabase.from("webhook_events").update({ read: true }).eq("read", false);
  }
  async clearEvents() {
    await supabase.from("webhook_events").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }
  async clearMedia() {
    await supabase.from("media_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }

  // ─── Rules ───
  async addRule(pattern: string, source_id: string | null = null) {
    const { error } = await supabase.from("auto_read_rules").insert({ pattern, source_id, enabled: true });
    if (error) throw error;
  }
  async toggleRule(id: string, enabled: boolean) {
    await supabase.from("auto_read_rules").update({ enabled }).eq("id", id);
  }
  async removeRule(id: string) {
    await supabase.from("auto_read_rules").delete().eq("id", id);
  }

  // ─── Frigate instances ───
  async createFrigate(input: { name: string; base_url: string; api_key?: string; color?: string; is_local?: boolean }) {
    const slugBase = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "frigate";
    const slug = `frigate-${slugBase}-${crypto.randomUUID().slice(0, 6)}`;
    const secret = crypto.randomUUID().replace(/-/g, "");
    const color = input.color ?? "#3b82f6";

    // Paired webhook source so push notifications and polled events share the same source view
    const { data: src, error: srcErr } = await supabase.from("webhook_sources").insert({
      name: `Frigate · ${input.name}`,
      slug,
      color,
      secret,
    }).select("id").single();
    if (srcErr) throw srcErr;

    const { error } = await supabase.from("frigate_instances").insert({
      source_id: src.id,
      name: input.name,
      base_url: input.base_url.replace(/\/+$/, ""),
      api_key: input.api_key || null,
      color,
      is_local: input.is_local ?? false,
      // Cloud-poll won't reach LAN URLs, so disable polling by default for local instances
      poll_enabled: input.is_local ? false : true,
    });
    if (error) {
      // Roll back the orphan source
      await supabase.from("webhook_sources").delete().eq("id", src.id);
      throw error;
    }
  }
  async updateFrigate(id: string, patch: Partial<Pick<FrigateInstance, "name" | "base_url" | "api_key" | "color" | "enabled" | "poll_enabled" | "poll_interval_seconds" | "is_local">>) {
    const { error } = await supabase.from("frigate_instances").update(patch).eq("id", id);
    if (error) throw error;
  }
  async deleteFrigate(id: string) {
    const inst = this.frigates.find((f) => f.id === id);
    const { error } = await supabase.from("frigate_instances").delete().eq("id", id);
    if (error) throw error;
    if (inst?.source_id) await supabase.from("webhook_sources").delete().eq("id", inst.source_id);
  }
  async pollFrigateNow(id?: string) {
    const url = id ? `frigate-poll?instance_id=${id}` : "frigate-poll";
    const { data, error } = await supabase.functions.invoke(url, { method: "POST" });
    if (error) throw error;
    return data;
  }
}

export const webhookStore = new WebhookStore();

export function webhookUrl(slug: string) {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co/functions/v1/webhook-ingest/${slug}`;
}

export function frigateProxyUrl(relative: string) {
  // relative comes from frigate-poll as "/<instance_id>/api/..." (leading slash)
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const path = relative.startsWith("/") ? relative : "/" + relative;
  return `https://${projectId}.supabase.co/functions/v1/frigate-proxy${path}`;
}

/**
 * Returns the best URL for a Frigate API path, given an instance.
 * - For LOCAL instances (`is_local = true`), returns `<base_url><path>` so the
 *   browser talks directly to the NVR on the LAN (no cloud round-trip).
 * - Otherwise, returns the cloud Frigate proxy URL.
 *
 * `path` should start with `/api/...` (e.g. `/api/stats`).
 */
export function frigateUrl(instance: { id: string; base_url: string; is_local: boolean }, path: string) {
  const p = path.startsWith("/") ? path : "/" + path;
  if (instance.is_local) {
    return `${instance.base_url.replace(/\/+$/, "")}${p}`;
  }
  return frigateProxyUrl(`/${instance.id}${p}`);
}

export function resolveMediaUrl(url: string) {
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  return frigateProxyUrl(url);
}
