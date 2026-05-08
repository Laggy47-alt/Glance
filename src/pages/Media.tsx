import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useEffect, useMemo, useState } from "react";
import { Camera, Film, ImageOff, Play, Tag as TagIcon, Check } from "lucide-react";
import { MediaLightbox, LightboxItem } from "@/components/MediaLightbox";
import { resolveMediaUrl } from "@/lib/webhookStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Tab = "all" | "snapshot" | "clip";

const Media = () => {
  const store = useWebhookStore();
  const { activeOrg } = useAuth();
  const [selected, setSelected] = useState<LightboxItem | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [filter, setFilter] = useState("");
  const [tagsByMedia, setTagsByMedia] = useState<Record<string, { id: string; tag: string; note: string | null }[]>>({});
  const [onlyTagged, setOnlyTagged] = useState(false);
  const [acksByEvent, setAcksByEvent] = useState<Record<string, { actor: string | null; ts: string }>>({});

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!activeOrg?.id) { setTagsByMedia({}); return; }
      const { data } = await supabase.from("media_tags")
        .select("id, media_id, tag, note")
        .eq("organization_id", activeOrg.id)
        .order("created_at", { ascending: false });
      if (!active) return;
      const grouped: Record<string, { id: string; tag: string; note: string | null }[]> = {};
      (data ?? []).forEach((t: { id: string; media_id: string; tag: string; note: string | null }) => {
        (grouped[t.media_id] ||= []).push({ id: t.id, tag: t.tag, note: t.note });
      });
      setTagsByMedia(grouped);
    };
    load();
    const ch = supabase
      .channel("media-tags")
      .on("postgres_changes", { event: "*", schema: "public", table: "media_tags" }, () => load())
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [activeOrg?.id]);

  // Load ack audit entries (latest per event_id)
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!activeOrg?.id) { setAcksByEvent({}); return; }
      const { data } = await supabase
        .from("event_audit_log")
        .select("event_id, actor, ts, action")
        .eq("organization_id", activeOrg.id)
        .eq("action", "ack")
        .order("ts", { ascending: false })
        .limit(2000);
      if (!active) return;
      const map: Record<string, { actor: string | null; ts: string }> = {};
      (data ?? []).forEach((row: { event_id: string | null; actor: string | null; ts: string }) => {
        if (row.event_id && !map[row.event_id]) {
          map[row.event_id] = { actor: row.actor, ts: row.ts };
        }
      });
      setAcksByEvent(map);
    };
    load();
    const ch = supabase
      .channel("audit-acks")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "event_audit_log", filter: "action=eq.ack" }, () => load())
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [activeOrg?.id]);

  const items = useMemo(() => {
    return store.media
      .filter((m) => tab === "all" || m.kind === tab)
      .filter((m) => !onlyTagged || (tagsByMedia[m.id]?.length ?? 0) > 0)
      .filter((m) => {
        if (!filter) return true;
        const f = filter.toLowerCase();
        return (m.camera ?? "").toLowerCase().includes(f) ||
          (m.topic ?? "").toLowerCase().includes(f) ||
          (tagsByMedia[m.id] ?? []).some((t) => t.tag.toLowerCase().includes(f));
      });
  }, [store.media, tab, filter, tagsByMedia, onlyTagged]);

  const toLightbox = (m: typeof store.media[number]): LightboxItem => ({
    kind: m.kind,
    url: resolveMediaUrl(m.url),
    camera: m.camera,
    topic: m.topic,
    ts: m.ts,
    mediaId: m.id,
    eventId: m.event_id ?? null,
  });

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All", count: store.media.length },
    { id: "snapshot", label: "Snapshots", count: store.media.filter((m) => m.kind === "snapshot").length },
    { id: "clip", label: "Clips", count: store.media.filter((m) => m.kind === "clip").length },
  ];

  return (
    <DashboardLayout
      title="Media"
      subtitle="Every snapshot and clip captured from webhooks"
      actions={<Button variant="outline" size="sm" onClick={() => store.clearMedia()}>Clear all</Button>}
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex bg-secondary/50 rounded-md p-1 border border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5",
                tab === t.id ? "bg-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              <span className={cn("text-[10px] px-1.5 rounded-full tabular-nums", tab === t.id ? "bg-primary-foreground/20" : "bg-secondary")}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant={onlyTagged ? "default" : "outline"}
          onClick={() => setOnlyTagged((v) => !v)}
          className="gap-1.5 h-8 ml-auto"
        >
          <TagIcon className="h-3.5 w-3.5" /> Tagged only
        </Button>
        <Input
          placeholder="Filter by camera, topic, or tag…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-secondary border-border max-w-xs"
        />
      </div>

      {items.length === 0 ? (
        <Card className="bg-gradient-card border-border shadow-card p-12 text-center">
          <ImageOff className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">No media yet</p>
          <p className="text-xs text-muted-foreground mt-1">Snapshots and clips arriving via webhooks will appear here.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {items.map((m) => {
            const tags = tagsByMedia[m.id] ?? [];
            const ack = m.event_id ? acksByEvent[m.event_id] : undefined;
            const thumbnail =
              m.kind === "clip"
                ? store.media.find((x) => x.kind === "snapshot" && (
                    (m.frigate_event_id && x.frigate_event_id === m.frigate_event_id) ||
                    (m.event_id && x.event_id === m.event_id)
                  ))
                : null;
            return (
              <button
                key={m.id}
                onClick={() => setSelected(toLightbox(m))}
                className="group relative aspect-video bg-black rounded-md overflow-hidden border border-border hover:border-primary transition-colors text-left"
              >
                {m.kind === "snapshot" ? (
                  <img src={resolveMediaUrl(m.url)} alt={m.camera ?? ""} className="w-full h-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                ) : (
                  <>
                    {thumbnail ? (
                      <img src={resolveMediaUrl(thumbnail.url)} alt={m.camera ?? ""} className="w-full h-full object-cover opacity-70" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                        <Film className="h-6 w-6" />
                      </div>
                    )}
                    <div className="absolute inset-0 grid place-items-center">
                      <div className="h-10 w-10 rounded-full bg-primary/90 grid place-items-center shadow-glow">
                        <Play className="h-5 w-5 text-primary-foreground ml-0.5" />
                      </div>
                    </div>
                  </>
                )}
                <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-black/60 backdrop-blur px-1.5 py-0.5 rounded text-[10px]">
                  {m.kind === "snapshot" ? <Camera className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
                  <span className="text-foreground/90 capitalize">{m.camera ?? "—"}</span>
                </div>
                {ack && (
                  <div
                    className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-success/90 text-success-foreground px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider shadow"
                    title={`Acknowledged by ${ack.actor ?? "unknown"} at ${new Date(ack.ts).toLocaleString()}`}
                  >
                    <Check className="h-2.5 w-2.5" />
                    <span className="normal-case tracking-normal">{ack.actor ?? "unknown"}</span>
                  </div>
                )}
                <div className="absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur px-1.5 py-0.5 rounded text-[10px] text-foreground/80 tabular-nums">
                  {ack ? new Date(ack.ts).toLocaleString() : new Date(m.ts).toLocaleTimeString()}
                </div>
                {tags.length > 0 && (
                  <div className="absolute bottom-1.5 left-1.5 flex flex-wrap gap-0.5 max-w-[70%]">
                    {tags.slice(0, 3).map((t) => (
                      <Badge key={t.id} variant="secondary" className="px-1 py-0 h-4 text-[9px] bg-primary/80 text-primary-foreground border-0">
                        {t.tag}
                      </Badge>
                    ))}
                    {tags.length > 3 && (
                      <Badge variant="secondary" className="px-1 py-0 h-4 text-[9px]">+{tags.length - 3}</Badge>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
      <MediaLightbox item={selected} onClose={() => setSelected(null)} />
    </DashboardLayout>
  );
};

export default Media;
