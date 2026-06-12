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
  archived?: boolean;
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
  mute_enabled: boolean;
  mute_start: string | null; // "HH:MM:SS"
  mute_end: string | null;   // "HH:MM:SS"
  offline_alert_enabled: boolean;
  offline_alert_minutes: number;
  offline_alert_recipients: string[];
  created_at: string;
};

/**
 * Returns true if the NVR's alert mute window covers `now` (local time).
 * Supports overnight windows (e.g. 22:00 → 06:00).
 */
export function isFrigateMutedNow(
  inst: Pick<FrigateInstance, "mute_enabled" | "mute_start" | "mute_end">,
  now: Date = new Date()
): boolean {
  if (!inst.mute_enabled || !inst.mute_start || !inst.mute_end) return false;
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const start = toMin(inst.mute_start);
  const end = toMin(inst.mute_end);
  const cur = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  // overnight window
  return cur >= start || cur < end;
}

type Listener = () => void;
// Grace buffer applied to the live cursor on each poll so an event whose
// start_time is slightly earlier than `cursor` (e.g. Frigate published it a
// few seconds before the poller picked it up) still surfaces.
const LIVE_CURSOR_GRACE_MS = 30_000;

class WebhookStore {
  sources: WebhookSource[] = [];
  events: WebhookEvent[] = [];
  rules: AutoReadRule[] = [];
  media: MediaItem[] = [];
  frigates: FrigateInstance[] = [];
  loaded = false;
  error: string | null = null;
  activeOrgId: string | null = null;

  private listeners = new Set<Listener>();
  private channels: RealtimeChannel[] = [];
  private initialized = false;
  // Cursor used by pollIncremental — events with ts <= cursor are considered
  // historical backlog and ignored. Initialized lazily on first poll so a
  // fresh page load never floods the wall with historical events.
  private liveCursorMs: number | null = null;

  // Set the active org so super-admin (who can see all orgs via RLS) only
  // surfaces rows for the currently-selected org. Regular members never see
  // other orgs anyway because RLS filters them out server-side.
  setActiveOrg(orgId: string | null) {
    if (this.activeOrgId === orgId) return;
    this.activeOrgId = orgId;
    if (this.initialized) void this.refreshAll();
  }

  private matchesOrg(row: unknown) {
    if (!this.activeOrgId) return true;
    const org = (row as { organization_id?: string | null } | null)?.organization_id;
    // Rows without org info (rare) are kept; otherwise must match active org.
    return !org || org === this.activeOrgId;
  }



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
    // Wait for the auth session to be restored before issuing RLS-protected queries.
    const { data } = await supabase.auth.getSession().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/lock request is aborted|aborterror/i.test(message)) throw error;
      return { data: { session: null } };
    });
    if (!data.session) {
      // Defer: when auth signs in, the listener below will trigger refreshAll.
    } else {
      await this.refreshAll();
    }
    this.subscribeRealtime();
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        // Tear down and re-subscribe so the realtime socket carries the fresh
        // JWT. RLS-enforced postgres_changes silently drops broadcasts when
        // the channel was opened before auth was applied.
        void this.resubscribeRealtime();
        void this.refreshAll();
      } else if (event === "SIGNED_OUT") {
        void this.refreshAll();
      }
    });
    // Safety-net polling: even if realtime stalls, surface new alerts within
    // a few seconds instead of waiting for the next frigate-poll cron run.
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => { void this.pollIncremental(); }, 5000);
    }
  }

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private async resubscribeRealtime() {
    for (const ch of this.channels) {
      try { await supabase.removeChannel(ch); } catch { /* noop */ }
    }
    this.channels = [];
    this.subscribeRealtime();
  }

  private async pollIncremental() {
    if (!this.loaded) return;
    if (this.liveCursorMs === null) {
      // First poll after init: anchor cursor at "now" so we don't replay
      // any historical events that were already in the database.
      this.liveCursorMs = Date.now();
    }
    const cursorIso = new Date(this.liveCursorMs - LIVE_CURSOR_GRACE_MS).toISOString();
    try {
      const [ev, md] = await Promise.all([
        supabase.from("webhook_events").select("*")
          .gt("ts", cursorIso)
          .order("ts", { ascending: false }).limit(100),
        supabase.from("media_items").select("*")
          .gt("ts", cursorIso)
          .order("ts", { ascending: false }).limit(100),
      ]);
      let changed = false;
      let maxSeen = this.liveCursorMs;
      if (ev.data && ev.data.length) {
        const existing = new Set(this.events.map((e) => e.id));
        const fresh = (ev.data as WebhookEvent[]).filter((e) => !existing.has(e.id));
        if (fresh.length) {
          this.events = [...fresh, ...this.events].slice(0, 500);
          changed = true;
        }
        for (const e of ev.data as WebhookEvent[]) {
          const t = new Date(e.ts).getTime();
          if (Number.isFinite(t) && t > maxSeen) maxSeen = t;
        }
      }
      if (md.data && md.data.length) {
        const existing = new Set(this.media.map((m) => m.id));
        const fresh = (md.data as MediaItem[]).filter((m) => !existing.has(m.id));
        if (fresh.length) {
          this.media = [...fresh, ...this.media].slice(0, 200);
          changed = true;
        }
        for (const m of md.data as MediaItem[]) {
          const t = new Date(m.ts).getTime();
          if (Number.isFinite(t) && t > maxSeen) maxSeen = t;
        }
      }
      // Advance cursor so the next poll only considers newer rows.
      this.liveCursorMs = maxSeen;
      if (changed) this.emit();
    } catch { /* noop — next tick retries */ }
  }

  async refreshLiveWindow() {
    if (!this.loaded) return;
    await this.pollIncremental();
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
        const row = (p.new ?? p.old) as WebhookSource;
        if (!this.matchesOrg(row)) return;
        if (p.eventType === "INSERT") this.sources = [...this.sources, p.new as WebhookSource];
        else if (p.eventType === "UPDATE") this.sources = this.sources.map((x) => x.id === (p.new as WebhookSource).id ? (p.new as WebhookSource) : x);
        else if (p.eventType === "DELETE") this.sources = this.sources.filter((x) => x.id !== (p.old as WebhookSource).id);
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "webhook_events" }, (p) => {
        const row = (p.new ?? p.old) as WebhookEvent;
        if (!this.matchesOrg(row)) return;
        if (p.eventType === "INSERT") this.events = [p.new as WebhookEvent, ...this.events].slice(0, 500);
        else if (p.eventType === "UPDATE") this.events = this.events.map((x) => x.id === (p.new as WebhookEvent).id ? (p.new as WebhookEvent) : x);
        else if (p.eventType === "DELETE") this.events = this.events.filter((x) => x.id !== (p.old as WebhookEvent).id);
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "auto_read_rules" }, (p) => {
        const row = (p.new ?? p.old) as AutoReadRule;
        if (!this.matchesOrg(row)) return;
        if (p.eventType === "INSERT") this.rules = [...this.rules, p.new as AutoReadRule];
        else if (p.eventType === "UPDATE") this.rules = this.rules.map((x) => x.id === (p.new as AutoReadRule).id ? (p.new as AutoReadRule) : x);
        else if (p.eventType === "DELETE") this.rules = this.rules.filter((x) => x.id !== (p.old as AutoReadRule).id);
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "media_items" }, (p) => {
        const row = (p.new ?? p.old) as MediaItem;
        if (!this.matchesOrg(row)) return;
        if (p.eventType === "INSERT") this.media = [p.new as MediaItem, ...this.media].slice(0, 200);
        else if (p.eventType === "UPDATE") this.media = this.media.map((x) => x.id === (p.new as MediaItem).id ? (p.new as MediaItem) : x);
        else if (p.eventType === "DELETE") this.media = this.media.filter((x) => x.id !== (p.old as MediaItem).id);
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "frigate_instances" }, (p) => {
        const row = (p.new ?? p.old) as FrigateInstance;
        if (!this.matchesOrg(row)) return;
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
    const { error } = await supabase.from("auto_read_rules").insert({
      pattern, source_id, enabled: true,
    });
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
      poll_enabled: false,
      mute_enabled: true,
      mute_start: "06:00:00",
      mute_end: "17:30:00",
    });
    if (error) {
      await supabase.from("webhook_sources").delete().eq("id", src.id);
      throw error;
    }
  }

  async updateFrigate(id: string, patch: Partial<Pick<FrigateInstance, "name" | "base_url" | "api_key" | "color" | "enabled" | "poll_enabled" | "poll_interval_seconds" | "is_local" | "mute_enabled" | "mute_start" | "mute_end" | "offline_alert_enabled" | "offline_alert_minutes" | "offline_alert_recipients">>) {
    const cleaned = {
      ...patch,
      ...(patch.base_url !== undefined ? { base_url: patch.base_url.replace(/\/+$/, "") } : {}),
    };
    const connectionChanged = "base_url" in patch || "api_key" in patch || "is_local" in patch;
    const update = connectionChanged
      ? { ...cleaned, last_error: null, last_polled_at: null }
      : cleaned;
    const { data, error } = await supabase.from("frigate_instances").update(update).eq("id", id).select("*").single();
    if (error) throw error;
    if (data) {
      this.frigates = this.frigates.map((x) => x.id === id ? data as FrigateInstance : x);
      this.emit();
    }
  }
  async deleteFrigate(id: string) {
    const inst = this.frigates.find((f) => f.id === id);
    // Optimistically remove from local state so in-flight stats polls stop
    // immediately (otherwise they 404 against frigate-proxy for ~1 cycle).
    this.frigates = this.frigates.filter((f) => f.id !== id);
    if (inst?.source_id) this.sources = this.sources.filter((s) => s.id !== inst.source_id);
    this.emit();
    const { error } = await supabase.from("frigate_instances").delete().eq("id", id);
    if (error) {
      await this.refreshAll();
      throw error;
    }
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

function supabaseBaseUrl() {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (url) return url.replace(/\/+$/, "");
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co`;
}

export function webhookUrl(slug: string) {
  return `${supabaseBaseUrl()}/functions/v1/webhook-ingest/${slug}`;
}

export function frigateProxyUrl(relative: string) {
  // relative comes from frigate-poll as "/<instance_id>/api/..." (leading slash)
  const path = relative.startsWith("/") ? relative : "/" + relative;
  return `${supabaseBaseUrl()}/functions/v1/frigate-proxy${path}`;
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
