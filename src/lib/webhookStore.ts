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
};

type Listener = () => void;

class WebhookStore {
  sources: WebhookSource[] = [];
  events: WebhookEvent[] = [];
  rules: AutoReadRule[] = [];
  media: MediaItem[] = [];
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
      const [s, e, r, m] = await Promise.all([
        supabase.from("webhook_sources").select("*").order("created_at", { ascending: true }),
        supabase.from("webhook_events").select("*").order("ts", { ascending: false }).limit(500),
        supabase.from("auto_read_rules").select("*").order("created_at", { ascending: true }),
        supabase.from("media_items").select("*").order("ts", { ascending: false }).limit(200),
      ]);
      this.sources = (s.data ?? []) as WebhookSource[];
      this.events = (e.data ?? []) as WebhookEvent[];
      this.rules = (r.data ?? []) as AutoReadRule[];
      this.media = (m.data ?? []) as MediaItem[];
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
}

export const webhookStore = new WebhookStore();

export function webhookUrl(slug: string) {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co/functions/v1/webhook-ingest/${slug}`;
}
