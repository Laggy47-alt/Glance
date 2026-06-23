import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useEffect, useMemo, useState } from "react";
import { Camera, Film, ImageOff, Play, Tag as TagIcon, CheckCircle2, ChevronDown, ChevronRight, CalendarDays } from "lucide-react";
import { MediaLightbox, LightboxItem } from "@/components/MediaLightbox";
import { resolveMediaUrl } from "@/lib/webhookStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Tab = "all" | "snapshot" | "clip";
type GroupMode = "date" | "date-camera";

const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const formatDateLabel = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (dateKey(date) === dateKey(today)) return "Today";
  if (dateKey(date) === dateKey(yest)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};

const Media = () => {
  const store = useWebhookStore();
  const { activeOrg } = useAuth();
  const [selected, setSelected] = useState<LightboxItem | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [filter, setFilter] = useState("");
  const [tagsByMedia, setTagsByMedia] = useState<Record<string, { id: string; tag: string; note: string | null }[]>>({});
  const [onlyTagged, setOnlyTagged] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>("date");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  

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

  const groups = useMemo(() => {
    // Group by date, then optionally by camera. Items are already sorted by ts desc in the store; preserve order.
    const byDate = new Map<string, Map<string, typeof items>>();
    for (const m of items) {
      const dk = dateKey(new Date(m.ts));
      const cam = m.camera ?? "Unknown camera";
      if (!byDate.has(dk)) byDate.set(dk, new Map());
      const camMap = byDate.get(dk)!;
      if (!camMap.has(cam)) camMap.set(cam, [] as typeof items);
      camMap.get(cam)!.push(m);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([dk, camMap]) => ({
        dateKey: dk,
        total: Array.from(camMap.values()).reduce((n, arr) => n + arr.length, 0),
        cameras: Array.from(camMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([camera, arr]) => ({ camera, items: arr })),
      }));
  }, [items]);

  const toLightbox = (m: typeof store.media[number]): LightboxItem => ({
    kind: m.kind,
    url: resolveMediaUrl(m.url),
    camera: m.camera,
    topic: m.topic,
    ts: m.ts,
    mediaId: m.id,
    organizationId: m.organization_id ?? activeOrg?.id ?? null,
    eventId: m.event_id ?? null,
  });

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All", count: store.media.length },
    { id: "snapshot", label: "Snapshots", count: store.media.filter((m) => m.kind === "snapshot").length },
    { id: "clip", label: "Clips", count: store.media.filter((m) => m.kind === "clip").length },
  ];

  const renderTile = (m: typeof store.media[number]) => {
    const tags = tagsByMedia[m.id] ?? [];
    const linkedEvent = m.event_id ? store.events.find((e) => e.id === m.event_id) : null;
    const ackName = m.archived_by_name ?? linkedEvent?.archived_by_name ?? linkedEvent?.read_by_name ?? null;
    const ackAt = m.archived_at ?? linkedEvent?.archived_at ?? linkedEvent?.read_at ?? null;
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
        title={ackName ? `Acknowledged by ${ackName}${ackAt ? ` · ${new Date(ackAt).toLocaleString()}` : ""}` : undefined}
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
        {ackName && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-emerald-600/80 backdrop-blur px-1.5 py-0.5 rounded text-[10px] text-white">
            <CheckCircle2 className="h-2.5 w-2.5" />
            <span className="truncate max-w-[90px]">{ackName}</span>
          </div>
        )}
        <div className="absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur px-1.5 py-0.5 rounded text-[10px] text-foreground/80 tabular-nums">
          {new Date(m.ts).toLocaleTimeString()}
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
  };


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
        <div className="flex items-center gap-1 ml-auto rounded-md border border-border bg-secondary/50 p-1">
          <button
            onClick={() => setGroupMode("date")}
            className={cn(
              "px-2 py-1 text-[11px] font-medium rounded transition-colors",
              groupMode === "date" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            title="Group by date"
          >
            By date
          </button>
          <button
            onClick={() => setGroupMode("date-camera")}
            className={cn(
              "px-2 py-1 text-[11px] font-medium rounded transition-colors",
              groupMode === "date-camera" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            title="Group by date and camera"
          >
            Date + camera
          </button>
        </div>
        <Button
          size="sm"
          variant={onlyTagged ? "default" : "outline"}
          onClick={() => setOnlyTagged((v) => !v)}
          className="gap-1.5 h-8"
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
        <div className="space-y-6">
          {groups.map((g) => {
            const dateCollapsed = collapsed[`d:${g.dateKey}`];
            return (
              <section key={g.dateKey} className="space-y-3">
                <button
                  onClick={() => toggle(`d:${g.dateKey}`)}
                  className="w-full flex items-center gap-2 sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border py-2 text-left"
                >
                  {dateCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">{formatDateLabel(g.dateKey)}</h2>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{g.dateKey}</span>
                  <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px] tabular-nums">{g.total}</Badge>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {g.cameras.length} {g.cameras.length === 1 ? "camera" : "cameras"}
                  </span>
                </button>

                {!dateCollapsed && (
                  groupMode === "date" ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {g.cameras.flatMap((c) => c.items).map(renderTile)}
                    </div>
                  ) : (
                    <div className="space-y-4 pl-1">
                      {g.cameras.map((c) => {
                        const ck = `dc:${g.dateKey}:${c.camera}`;
                        const camCollapsed = collapsed[ck];
                        return (
                          <div key={ck} className="space-y-2">
                            <button
                              onClick={() => toggle(ck)}
                              className="w-full flex items-center gap-2 text-left"
                            >
                              {camCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                              <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                              <h3 className="text-xs font-medium text-foreground capitalize">{c.camera}</h3>
                              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums">{c.items.length}</Badge>
                            </button>
                            {!camCollapsed && (
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                                {c.items.map(renderTile)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </section>
            );
          })}
        </div>
      )}
      <MediaLightbox item={selected} onClose={() => setSelected(null)} />
    </DashboardLayout>
  );
};

export default Media;
