import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useEffect, useMemo, useState } from "react";
import { Camera, Film, ImageOff, Play, Tag as TagIcon, CheckCircle2, ChevronDown, ChevronRight, Server, CalendarDays } from "lucide-react";
import { MediaLightbox, LightboxItem } from "@/components/MediaLightbox";
import { resolveMediaUrl } from "@/lib/webhookStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Tab = "all" | "snapshot" | "clip";

const ALL_NVRS = "__all__";

const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const formatDateLabel = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (dateKey(date) === dateKey(today)) return "Today";
  if (dateKey(date) === dateKey(yest)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

const formatDateLong = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

const Media = () => {
  const store = useWebhookStore();
  const { activeOrg } = useAuth();
  const [selected, setSelected] = useState<LightboxItem | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [filter, setFilter] = useState("");
  const [tagsByMedia, setTagsByMedia] = useState<Record<string, { id: string; tag: string; note: string | null }[]>>({});
  const [onlyTagged, setOnlyTagged] = useState(false);
  const [nvrId, setNvrId] = useState<string>(ALL_NVRS);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [collapsedCams, setCollapsedCams] = useState<Record<string, boolean>>({});
  const toggleCam = (k: string) => setCollapsedCams((c) => ({ ...c, [k]: !c[k] }));

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

  // Map: source_id -> frigate instance (NVR)
  const nvrBySourceId = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string }>();
    for (const f of store.frigates) {
      if (f.source_id) m.set(f.source_id, { id: f.id, name: f.name, color: f.color });
    }
    return m;
  }, [store.frigates]);

  const nvrOfMedia = (m: { source_id: string }) => nvrBySourceId.get(m.source_id) ?? null;

  // Per-tab + tag/text filtered items (NVR not yet applied — needed for NVR counts)
  const baseItems = useMemo(() => {
    return store.media
      .filter((m) => tab === "all" || m.kind === tab)
      .filter((m) => !onlyTagged || (tagsByMedia[m.id]?.length ?? 0) > 0)
      .filter((m) => {
        if (!filter) return true;
        const f = filter.toLowerCase();
        return (m.camera ?? "").toLowerCase().includes(f) ||
          (m.topic ?? "").toLowerCase().includes(f) ||
          (nvrOfMedia(m)?.name ?? "").toLowerCase().includes(f) ||
          (tagsByMedia[m.id] ?? []).some((t) => t.tag.toLowerCase().includes(f));
      });
  }, [store.media, tab, filter, tagsByMedia, onlyTagged, nvrBySourceId]);

  // NVR list with counts
  const nvrList = useMemo(() => {
    const counts = new Map<string, number>();
    let unknown = 0;
    for (const m of baseItems) {
      const n = nvrOfMedia(m);
      if (n) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
      else unknown++;
    }
    const list = store.frigates
      .map((f) => ({ id: f.id, name: f.name, color: f.color, count: counts.get(f.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { list, unknown, total: baseItems.length };
  }, [baseItems, store.frigates, nvrBySourceId]);

  // Items scoped to selected NVR
  const items = useMemo(() => {
    if (nvrId === ALL_NVRS) return baseItems;
    return baseItems.filter((m) => nvrOfMedia(m)?.id === nvrId);
  }, [baseItems, nvrId, nvrBySourceId]);

  // Build date list with counts (desc by date)
  const dateList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of items) {
      const dk = dateKey(new Date(m.ts));
      counts.set(dk, (counts.get(dk) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, count]) => ({ key, count }));
  }, [items]);

  // Default-select most recent date when list changes
  useEffect(() => {
    if (dateList.length === 0) { setActiveDate(null); return; }
    if (!activeDate || !dateList.some((d) => d.key === activeDate)) {
      setActiveDate(dateList[0].key);
    }
  }, [dateList, activeDate]);

  // Items for selected date, grouped by camera
  const camerasForDate = useMemo(() => {
    if (!activeDate) return [] as { camera: string; items: typeof items }[];
    const byCam = new Map<string, typeof items>();
    for (const m of items) {
      if (dateKey(new Date(m.ts)) !== activeDate) continue;
      const cam = m.camera ?? "Unknown camera";
      if (!byCam.has(cam)) byCam.set(cam, [] as typeof items);
      byCam.get(cam)!.push(m);
    }
    return Array.from(byCam.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([camera, arr]) => ({ camera, items: arr }));
  }, [items, activeDate]);

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
    // If the alert was cleared automatically (by an auto-read rule) there's no actor name,
    // but it is still part of the audit trail — show a neutral "Auto" badge so every alert
    // visibly has a trail entry.
    const autoCleared = !ackName && (linkedEvent?.archived || linkedEvent?.read);
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

  const activeNvr = nvrId === ALL_NVRS ? null : store.frigates.find((f) => f.id === nvrId) ?? null;

  return (
    <DashboardLayout
      title="Media"
      subtitle="Browse snapshots and clips by NVR, date, and camera"
      actions={<Button variant="outline" size="sm" onClick={() => store.clearMedia()}>Clear all</Button>}
    >
      {/* Toolbar */}
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
          placeholder="Search camera, NVR, topic, tag…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-secondary border-border max-w-xs"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* NVR sidebar */}
        <aside className="space-y-1">
          <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Server className="h-3 w-3" /> NVRs
          </div>
          <button
            onClick={() => setNvrId(ALL_NVRS)}
            className={cn(
              "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-xs font-medium transition-colors text-left",
              nvrId === ALL_NVRS ? "bg-primary text-primary-foreground shadow-glow" : "bg-secondary/40 hover:bg-secondary text-foreground"
            )}
          >
            <span>All NVRs</span>
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums bg-background/40 text-inherit border-0">
              {nvrList.total}
            </Badge>
          </button>
          {nvrList.list.map((n) => (
            <button
              key={n.id}
              onClick={() => setNvrId(n.id)}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-xs font-medium transition-colors text-left",
                nvrId === n.id ? "bg-primary text-primary-foreground shadow-glow" : "bg-secondary/40 hover:bg-secondary text-foreground"
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: n.color }} />
                <span className="truncate">{n.name}</span>
              </span>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums bg-background/40 text-inherit border-0">
                {n.count}
              </Badge>
            </button>
          ))}
          {nvrList.unknown > 0 && (
            <div className="px-2.5 py-1 text-[10px] text-muted-foreground">
              {nvrList.unknown} unassigned
            </div>
          )}
        </aside>

        {/* Main content */}
        <div className="space-y-4 min-w-0">
          {items.length === 0 ? (
            <Card className="bg-gradient-card border-border shadow-card p-12 text-center">
              <ImageOff className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-foreground font-medium">No media for this selection</p>
              <p className="text-xs text-muted-foreground mt-1">Try another NVR or clear the filters.</p>
            </Card>
          ) : (
            <>
              {/* Date strip */}
              <Card className="bg-gradient-card border-border shadow-card p-2">
                <div className="flex items-center gap-2 px-1 pb-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Dates {activeNvr ? `· ${activeNvr.name}` : ""}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                    {dateList.length} {dateList.length === 1 ? "day" : "days"}
                  </span>
                </div>
                <ScrollArea className="w-full">
                  <div className="flex gap-2 pb-2">
                    {dateList.map((d) => (
                      <button
                        key={d.key}
                        onClick={() => setActiveDate(d.key)}
                        className={cn(
                          "flex-shrink-0 px-3 py-1.5 rounded-md border text-left transition-colors",
                          activeDate === d.key
                            ? "bg-primary text-primary-foreground border-primary shadow-glow"
                            : "bg-secondary/40 border-border hover:border-primary/50 text-foreground"
                        )}
                      >
                        <div className="text-xs font-semibold leading-tight">{formatDateLabel(d.key)}</div>
                        <div className={cn(
                          "text-[10px] tabular-nums leading-tight",
                          activeDate === d.key ? "text-primary-foreground/80" : "text-muted-foreground"
                        )}>
                          {d.key} · {d.count}
                        </div>
                      </button>
                    ))}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </Card>

              {/* Cameras for date */}
              {activeDate && (
                <div className="space-y-4">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-base font-semibold text-foreground">{formatDateLong(activeDate)}</h2>
                    <span className="text-xs text-muted-foreground">
                      · {camerasForDate.length} {camerasForDate.length === 1 ? "camera" : "cameras"}
                      · {camerasForDate.reduce((n, c) => n + c.items.length, 0)} items
                    </span>
                  </div>
                  {camerasForDate.map((c) => {
                    const ck = `${nvrId}:${activeDate}:${c.camera}`;
                    const isCollapsed = collapsedCams[ck];
                    return (
                      <section key={ck} className="space-y-2">
                        <button
                          onClick={() => toggleCam(ck)}
                          className="w-full flex items-center gap-2 text-left bg-secondary/30 hover:bg-secondary/60 border border-border rounded-md px-3 py-2 transition-colors"
                        >
                          {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          <Camera className="h-4 w-4 text-primary" />
                          <h3 className="text-sm font-medium text-foreground capitalize">{c.camera}</h3>
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">{c.items.length}</Badge>
                          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                            {new Date(c.items[c.items.length - 1].ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {" – "}
                            {new Date(c.items[0].ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </button>
                        {!isCollapsed && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                            {c.items.map(renderTile)}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <MediaLightbox item={selected} onClose={() => setSelected(null)} />
    </DashboardLayout>
  );
};

export default Media;
