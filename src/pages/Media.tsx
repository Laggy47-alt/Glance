import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, Film, ImageOff, Play, Tag as TagIcon, CheckCircle2, Search, Loader2, Server } from "lucide-react";
import { MediaLightbox, LightboxItem } from "@/components/MediaLightbox";
import { resolveMediaUrl, type MediaItem } from "@/lib/webhookStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type Tab = "all" | "snapshot" | "clip";

const ALL_CAMS = "__all__";
const MAX_RESULTS = 2000;

// yyyy-MM-ddTHH:mm formatted for local time
const toDatetimeLocal = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const defaultRange = () => {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { from: toDatetimeLocal(start), to: toDatetimeLocal(end) };
};

const quickRanges: { label: string; hours: number }[] = [
  { label: "Last hour", hours: 1 },
  { label: "Last 6h", hours: 6 },
  { label: "Last 24h", hours: 24 },
  { label: "Last 7d", hours: 24 * 7 },
];

const Media = () => {
  const store = useWebhookStore();
  const { activeOrg } = useAuth();
  const [selected, setSelected] = useState<LightboxItem | null>(null);

  const [tab, setTab] = useState<Tab>("all");
  const [nvrId, setNvrId] = useState<string>("");
  const [camera, setCamera] = useState<string>(ALL_CAMS);
  const [{ from, to }, setRange] = useState(defaultRange);
  const [textFilter, setTextFilter] = useState("");
  const [onlyTagged, setOnlyTagged] = useState(false);

  const [cameraOptions, setCameraOptions] = useState<string[]>([]);
  const [loadingCams, setLoadingCams] = useState(false);
  const [results, setResults] = useState<MediaItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [tagsByMedia, setTagsByMedia] = useState<Record<string, { id: string; tag: string; note: string | null }[]>>({});

  const activeNvr = useMemo(
    () => store.frigates.find((f) => f.id === nvrId) ?? null,
    [store.frigates, nvrId],
  );

  // Load distinct cameras for the picked NVR (derive from recent media_items rows).
  useEffect(() => {
    setCamera(ALL_CAMS);
    setCameraOptions([]);
    if (!activeNvr?.source_id) return;
    let alive = true;
    setLoadingCams(true);
    (async () => {
      const { data, error } = await supabase
        .from("media_items")
        .select("camera")
        .eq("source_id", activeNvr.source_id)
        .not("camera", "is", null)
        .order("ts", { ascending: false })
        .limit(1000);
      if (!alive) return;
      setLoadingCams(false);
      if (error) return;
      const uniq = Array.from(new Set((data ?? []).map((r: { camera: string | null }) => r.camera).filter(Boolean) as string[]));
      uniq.sort((a, b) => a.localeCompare(b));
      setCameraOptions(uniq);
    })();
    return () => { alive = false; };
  }, [activeNvr?.source_id]);

  const runSearch = useCallback(async () => {
    if (!activeNvr?.source_id) {
      toast({ title: "Select an NVR", description: "Pick an NVR before searching.", variant: "destructive" });
      return;
    }
    const fromISO = new Date(from).toISOString();
    const toISO = new Date(to).toISOString();
    if (!(new Date(from) < new Date(to))) {
      toast({ title: "Invalid time range", description: "The 'from' time must be before 'to'.", variant: "destructive" });
      return;
    }
    setSearching(true);
    let q = supabase
      .from("media_items")
      .select("*")
      .eq("source_id", activeNvr.source_id)
      .gte("ts", fromISO)
      .lte("ts", toISO)
      .order("ts", { ascending: false })
      .limit(MAX_RESULTS);
    if (camera !== ALL_CAMS) q = q.eq("camera", camera);
    if (tab !== "all") q = q.eq("kind", tab);
    const { data, error } = await q;
    setSearching(false);
    if (error) {
      toast({ title: "Search failed", description: error.message, variant: "destructive" });
      return;
    }
    const rows = (data ?? []) as MediaItem[];
    setResults(rows);

    // Fetch tags for those media ids in one round-trip.
    if (rows.length && activeOrg?.id) {
      const ids = rows.map((r) => r.id);
      const { data: tags } = await supabase
        .from("media_tags")
        .select("id, media_id, tag, note")
        .eq("organization_id", activeOrg.id)
        .in("media_id", ids);
      const grouped: Record<string, { id: string; tag: string; note: string | null }[]> = {};
      (tags ?? []).forEach((t: { id: string; media_id: string; tag: string; note: string | null }) => {
        (grouped[t.media_id] ||= []).push({ id: t.id, tag: t.tag, note: t.note });
      });
      setTagsByMedia(grouped);
    } else {
      setTagsByMedia({});
    }
  }, [activeNvr?.source_id, from, to, camera, tab, activeOrg?.id]);

  const applyQuick = (hours: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
    setRange({ from: toDatetimeLocal(start), to: toDatetimeLocal(end) });
  };

  const items = useMemo(() => {
    if (!results) return [];
    const f = textFilter.trim().toLowerCase();
    return results.filter((m) => {
      if (onlyTagged && !(tagsByMedia[m.id]?.length)) return false;
      if (!f) return true;
      return (
        (m.camera ?? "").toLowerCase().includes(f) ||
        (m.topic ?? "").toLowerCase().includes(f) ||
        (tagsByMedia[m.id] ?? []).some((t) => t.tag.toLowerCase().includes(f))
      );
    });
  }, [results, textFilter, onlyTagged, tagsByMedia]);

  const toLightbox = (m: MediaItem): LightboxItem => ({
    kind: m.kind,
    url: resolveMediaUrl(m.url),
    camera: m.camera,
    topic: m.topic,
    ts: m.ts,
    mediaId: m.id,
    organizationId: m.organization_id ?? activeOrg?.id ?? null,
    eventId: m.event_id ?? null,
  });

  const renderTile = (m: MediaItem) => {
    const tags = tagsByMedia[m.id] ?? [];
    const ackName = m.archived_by_name ?? null;
    const ackAt = m.archived_at ?? null;
    const thumbnail =
      m.kind === "clip"
        ? results?.find((x) => x.kind === "snapshot" && (
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
        {ackName ? (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-emerald-600/80 backdrop-blur px-1.5 py-0.5 rounded text-[10px] text-white">
            <CheckCircle2 className="h-2.5 w-2.5" />
            <span className="truncate max-w-[90px]">{ackName}</span>
          </div>
        ) : null}
        <div className="absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur px-1.5 py-0.5 rounded text-[10px] text-foreground/80 tabular-nums">
          {new Date(m.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
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

  const sortedNvrs = useMemo(
    () => [...store.frigates].sort((a, b) => a.name.localeCompare(b.name)),
    [store.frigates],
  );

  return (
    <DashboardLayout
      title="Media"
      subtitle="Search snapshots and clips on demand by NVR, camera, and time range"
    >
      {/* Search panel */}
      <Card className="bg-gradient-card border-border shadow-card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Server className="h-3 w-3" /> NVR
            </Label>
            <Select value={nvrId} onValueChange={setNvrId}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue placeholder="Select NVR…" />
              </SelectTrigger>
              <SelectContent>
                {sortedNvrs.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: n.color }} />
                      {n.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Camera className="h-3 w-3" /> Camera
            </Label>
            <Select value={camera} onValueChange={setCamera} disabled={!activeNvr || loadingCams}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue placeholder={loadingCams ? "Loading…" : activeNvr ? "All cameras" : "Pick NVR first"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CAMS}>All cameras</SelectItem>
                {cameraOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">From</Label>
            <Input
              type="datetime-local"
              value={from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="bg-secondary border-border"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">To</Label>
            <Input
              type="datetime-local"
              value={to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="bg-secondary border-border"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <div className="flex bg-secondary/50 rounded-md p-1 border border-border">
            {(["all", "snapshot", "clip"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-medium rounded transition-colors capitalize",
                  tab === t ? "bg-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "all" ? "All" : t + "s"}
              </button>
            ))}
          </div>
          {quickRanges.map((q) => (
            <Button key={q.hours} size="sm" variant="outline" className="h-8" onClick={() => applyQuick(q.hours)}>
              {q.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={onlyTagged ? "default" : "outline"}
            onClick={() => setOnlyTagged((v) => !v)}
            className="gap-1.5 h-8"
          >
            <TagIcon className="h-3.5 w-3.5" /> Tagged only
          </Button>
          <Input
            placeholder="Filter results…"
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
            className="bg-secondary border-border max-w-xs h-8"
          />
          <Button size="sm" className="ml-auto gap-1.5 h-8" onClick={runSearch} disabled={searching || !nvrId}>
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </Button>
        </div>
      </Card>

      {/* Results */}
      {results === null ? (
        <Card className="bg-gradient-card border-border shadow-card p-12 text-center">
          <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">Pick an NVR, camera, and time range</p>
          <p className="text-xs text-muted-foreground mt-1">Alerts are only loaded when you press Search.</p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="bg-gradient-card border-border shadow-card p-12 text-center">
          <ImageOff className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">No media for this search</p>
          <p className="text-xs text-muted-foreground mt-1">Try widening the time range or removing filters.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-semibold text-foreground">
              {items.length} {items.length === 1 ? "result" : "results"}
            </h2>
            {results.length >= MAX_RESULTS && (
              <span className="text-[11px] text-amber-500">
                (capped at {MAX_RESULTS} — narrow the range for older items)
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {items.map(renderTile)}
          </div>
        </div>
      )}

      <MediaLightbox item={selected} onClose={() => setSelected(null)} />
    </DashboardLayout>
  );
};

export default Media;
