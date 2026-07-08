import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { DispatchDialog } from "@/components/DispatchDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Loader2, Plus, Siren, Clock, MapPin, User, Car as CarIcon, X, CheckCircle2,
} from "lucide-react";

type Dispatch = {
  id: string;
  organization_id: string;
  site_id: string;
  vehicle_id: string | null;
  responder_id: string | null;
  status: "pending" | "en_route" | "on_site" | "completed" | "cancelled";
  priority: "low" | "normal" | "high" | "critical";
  notes: string | null;
  dispatched_at: string;
  acknowledged_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  response_seconds: number | null;
};
type Ping = { id: number; dispatch_id: string; latitude: number; longitude: number; recorded_at: string };
type Ev = { id: number; dispatch_id: string; kind: string; payload: any; at: string };

const sb = supabase as any;

const STATUS_META: Record<Dispatch["status"], { label: string; className: string }> = {
  pending:   { label: "Pending",   className: "bg-slate-500/20 text-slate-300 border border-slate-500/40" },
  en_route:  { label: "En route",  className: "bg-amber-500/20 text-amber-500 border border-amber-500/40" },
  on_site:   { label: "On site",   className: "bg-blue-500/20 text-blue-400 border border-blue-500/40" },
  completed: { label: "Completed", className: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground border border-border" },
};

function formatElapsed(fromIso: string, toIso: string | null = null): string {
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  let s = Math.max(0, Math.floor((to - from) / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);   s -= m * 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

const responderIcon = L.divIcon({
  className: "",
  html: `<div style="background:#3b82f6;color:#fff;border-radius:9999px;width:22px;height:22px;display:grid;place-items:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">R</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});
const siteIcon = L.divIcon({
  className: "",
  html: `<div style="background:#ef4444;color:#fff;border-radius:9999px;width:22px;height:22px;display:grid;place-items:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">S</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});
const responderDotIcon = (label: string, dispatched: boolean) => L.divIcon({
  className: "",
  html: `<div style="background:${dispatched ? "#f59e0b" : "#10b981"};color:#fff;border-radius:9999px;min-width:22px;height:22px;padding:0 6px;display:inline-grid;place-items:center;font-size:10px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);white-space:nowrap">${label}</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

type DeviceLoc = {
  id: string;
  responder_id: string;
  last_latitude: number;
  last_longitude: number;
  last_seen_at: string | null;
};


const Dispatches = () => {
  const { activeOrg } = useAuth();
  const [rows, setRows] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pings, setPings] = useState<Ping[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [sites, setSites] = useState<Record<string, { name: string; latitude: number | null; longitude: number | null; geofence_radius_m: number }>>({});
  const [responders, setResponders] = useState<Record<string, string>>({});
  const [vehicles, setVehicles] = useState<Record<string, string>>({});
  const [devices, setDevices] = useState<DeviceLoc[]>([]);
  const [nowTick, setNowTick] = useState(0);

  // Live clock for elapsed times
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    if (!activeOrg?.id) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const [d, s, r, v, dev] = await Promise.all([
      sb.from("dispatches").select("*")
        .eq("organization_id", activeOrg.id)
        .order("dispatched_at", { ascending: false }).limit(200),
      sb.from("sites").select("id, name, latitude, longitude, geofence_radius_m")
        .eq("organization_id", activeOrg.id),
      sb.from("responders").select("id, name").eq("organization_id", activeOrg.id),
      sb.from("vehicles").select("id, plate").eq("organization_id", activeOrg.id),
      sb.from("responder_devices")
        .select("id, responder_id, last_latitude, last_longitude, last_seen_at")
        .eq("organization_id", activeOrg.id)
        .is("revoked_at", null)
        .not("last_latitude", "is", null)
        .not("last_longitude", "is", null),
    ]);
    setRows((d.data ?? []) as Dispatch[]);
    setSites(Object.fromEntries((s.data ?? []).map((x: any) => [x.id, x])));
    setResponders(Object.fromEntries((r.data ?? []).map((x: any) => [x.id, x.name])));
    setVehicles(Object.fromEntries((v.data ?? []).map((x: any) => [x.id, x.plate])));
    setDevices((dev.data ?? []) as DeviceLoc[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("dispatches-live")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "dispatches" }, () => void load())
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "dispatch_location_pings" }, () => {
        if (selectedId) void loadDetail(selectedId);
      })
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "dispatch_events" }, () => {
        if (selectedId) void loadDetail(selectedId);
      })
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "responder_devices" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id, selectedId]);

  const loadDetail = async (id: string) => {
    const [p, e] = await Promise.all([
      sb.from("dispatch_location_pings").select("*")
        .eq("dispatch_id", id).order("recorded_at", { ascending: true }).limit(2000),
      sb.from("dispatch_events").select("*")
        .eq("dispatch_id", id).order("at", { ascending: true }),
    ]);
    setPings((p.data ?? []) as Ping[]);
    setEvents((e.data ?? []) as Ev[]);
  };

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else { setPings([]); setEvents([]); }
  }, [selectedId]);

  const setStatus = async (d: Dispatch, action: "cancel" | "complete") => {
    const patch: Record<string, unknown> = {};
    const now = new Date().toISOString();
    if (action === "cancel") { patch.status = "cancelled"; patch.cancelled_at = now; }
    if (action === "complete") { patch.status = "completed"; patch.completed_at = now; if (!d.arrived_at) patch.arrived_at = now; }
    const { error } = await sb.from("dispatches").update(patch).eq("id", d.id);
    if (error) { toast.error(error.message); return; }
    await sb.from("dispatch_events").insert({
      dispatch_id: d.id, organization_id: d.organization_id,
      kind: action === "cancel" ? "cancelled" : "completed", payload: { source: "operator" },
    });
    toast.success(action === "cancel" ? "Cancelled" : "Completed");
  };

  const active = rows.filter((r) => r.status !== "completed" && r.status !== "cancelled");
  const selected = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;
  const selectedSite = selected ? sites[selected.site_id] : null;

  const mapCenter = useMemo<[number, number] | null>(() => {
    if (pings.length) return [pings[pings.length - 1].latitude, pings[pings.length - 1].longitude];
    if (selectedSite?.latitude != null && selectedSite?.longitude != null) return [selectedSite.latitude, selectedSite.longitude];
    return null;
  }, [pings, selectedSite]);

  const path = pings.map((p) => [p.latitude, p.longitude] as [number, number]);

  // Responders currently on an active dispatch → responder_id → site
  const activeAssignments = useMemo(() => {
    const map: Record<string, { siteId: string; status: Dispatch["status"] }> = {};
    for (const r of rows) {
      if (r.responder_id && (r.status === "pending" || r.status === "en_route" || r.status === "on_site")) {
        map[r.responder_id] = { siteId: r.site_id, status: r.status };
      }
    }
    return map;
  }, [rows]);

  const overviewCenter = useMemo<[number, number] | null>(() => {
    const pts: [number, number][] = [];
    for (const d of devices) pts.push([d.last_latitude, d.last_longitude]);
    for (const s of Object.values(sites)) {
      if (s.latitude != null && s.longitude != null) pts.push([s.latitude, s.longitude]);
    }
    if (!pts.length) return null;
    const lat = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const lng = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return [lat, lng];
  }, [devices, sites]);


  return (
    <DashboardLayout title="Dispatches" subtitle={`${active.length} active`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Siren className="h-6 w-6 text-primary" /> Dispatches
            </h1>
            <p className="text-sm text-muted-foreground">Live responder deployment and tracking.</p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setDialog(true)}>
            <Plus className="h-3.5 w-3.5" /> New dispatch
          </Button>
        </div>

        {/* Overview map — all responders */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Fleet overview
            </div>
            <div className="text-[10px] text-muted-foreground flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> Available</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-500" /> Dispatched</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" /> Site</span>
              <span>· {devices.length} responder{devices.length === 1 ? "" : "s"} tracked</span>
            </div>
          </div>
          <div className="h-80 bg-secondary/40">
            {overviewCenter ? (
              <MapContainer center={overviewCenter} zoom={12} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
                {/* Sites for active dispatches */}
                {Object.values(activeAssignments).map(({ siteId }) => {
                  const s = sites[siteId];
                  if (!s || s.latitude == null || s.longitude == null) return null;
                  return (
                    <React.Fragment key={siteId}>
                      <Marker position={[s.latitude, s.longitude]} icon={siteIcon} />
                      <Circle
                        center={[s.latitude, s.longitude]}
                        radius={s.geofence_radius_m ?? 100}
                        pathOptions={{ color: "#ef4444", weight: 1, fillOpacity: 0.06 }}
                      />
                    </div>
                  );
                })}
                {/* Each responder — dot + line to their site if dispatched */}
                {devices.map((d) => {
                  const name = responders[d.responder_id] ?? "?";
                  const short = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "R";
                  const assign = activeAssignments[d.responder_id];
                  const site = assign ? sites[assign.siteId] : null;
                  return (
                    <React.Fragment key={d.id}>
                      <Marker
                        position={[d.last_latitude, d.last_longitude]}
                        icon={responderDotIcon(short, !!assign)}
                      />
                      {site?.latitude != null && site?.longitude != null && (
                        <Polyline
                          positions={[
                            [d.last_latitude, d.last_longitude],
                            [site.latitude, site.longitude],
                          ]}
                          pathOptions={{ color: "#f59e0b", weight: 2, dashArray: "4 6", opacity: 0.8 }}
                        />
                      )}
                    </div>
                  );
                })}
              </MapContainer>
            ) : (
              <div className="h-full grid place-items-center text-xs text-muted-foreground">
                No responder locations yet. Once a paired phone sends its first ping, it will appear here.
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* List */}
          <div className="lg:col-span-3 rounded-lg border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dispatched</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Responder</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Elapsed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…
                  </TableCell></TableRow>
                )}
                {!loading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    No dispatches yet.
                  </TableCell></TableRow>
                )}
                {rows.map((d) => {
                  const meta = STATUS_META[d.status];
                  const active = d.status !== "completed" && d.status !== "cancelled";
                  const doneAt = d.completed_at ?? d.cancelled_at;
                  return (
                    <TableRow key={d.id}
                      data-state={selectedId === d.id ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(d.id)}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(d.dispatched_at).toLocaleString()}</TableCell>
                      <TableCell className="text-sm">{sites[d.site_id]?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{d.responder_id ? responders[d.responder_id] ?? "—" : "—"}</TableCell>
                      <TableCell className="text-sm font-mono text-xs">{d.vehicle_id ? vehicles[d.vehicle_id] ?? "—" : "—"}</TableCell>
                      <TableCell><Badge className={`text-[10px] ${meta.className}`}>{meta.label}</Badge></TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {d.response_seconds != null
                          ? `${Math.floor(d.response_seconds / 60)}m ${d.response_seconds % 60}s`
                          : formatElapsed(d.dispatched_at, doneAt)}
                        {/* keep re-rendering */}
                        <span className="hidden">{nowTick}</span>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {active && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStatus(d, "complete")}>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setStatus(d, "cancel")}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Detail */}
          <div className="lg:col-span-2 rounded-lg border border-border bg-card overflow-hidden">
            {!selected ? (
              <div className="p-6 text-sm text-muted-foreground text-center">
                Select a dispatch to see live tracking.
              </div>
            ) : (
              <div className="flex flex-col h-full">
                <div className="p-3 border-b border-border">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-primary" />
                        {selectedSite?.name ?? "Unknown site"}
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{selected.responder_id ? responders[selected.responder_id] ?? "—" : "—"}</span>
                        {selected.vehicle_id && <span className="inline-flex items-center gap-1"><CarIcon className="h-3 w-3" />{vehicles[selected.vehicle_id] ?? "—"}</span>}
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />
                          {selected.response_seconds != null
                            ? `${Math.floor(selected.response_seconds / 60)}m ${selected.response_seconds % 60}s`
                            : formatElapsed(selected.dispatched_at, selected.completed_at ?? selected.cancelled_at)}
                        </span>
                      </div>
                    </div>
                    <Badge className={`text-[10px] ${STATUS_META[selected.status].className}`}>
                      {STATUS_META[selected.status].label}
                    </Badge>
                  </div>
                </div>

                <div className="h-64 bg-secondary/40">
                  {mapCenter ? (
                    <MapContainer center={mapCenter} zoom={15} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
                      <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; OSM'
                      />
                      {selectedSite?.latitude != null && selectedSite.longitude != null && (
                        <>
                          <Marker position={[selectedSite.latitude, selectedSite.longitude]} icon={siteIcon} />
                          <Circle
                            center={[selectedSite.latitude, selectedSite.longitude]}
                            radius={selectedSite.geofence_radius_m ?? 100}
                            pathOptions={{ color: "#ef4444", weight: 1, fillOpacity: 0.08 }}
                          />
                        </>
                      )}
                      {path.length > 1 && <Polyline positions={path} pathOptions={{ color: "#3b82f6", weight: 3 }} />}
                      {path.length > 0 && (
                        <Marker position={path[path.length - 1]} icon={responderIcon} />
                      )}
                    </MapContainer>
                  ) : (
                    <div className="h-full grid place-items-center text-xs text-muted-foreground">
                      No location data yet.
                    </div>
                  )}
                </div>

                <div className="p-3 space-y-2 text-xs overflow-auto flex-1">
                  <div className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Timeline</div>
                  {events.length === 0 && <div className="text-muted-foreground">No events yet.</div>}
                  {events.map((e) => (
                    <div key={e.id} className="flex gap-2">
                      <span className="text-muted-foreground tabular-nums shrink-0">{new Date(e.at).toLocaleTimeString()}</span>
                      <span className="font-medium capitalize">{e.kind.replace(/_/g, " ")}</span>
                      {e.payload?.note && <span className="text-muted-foreground">— {e.payload.note}</span>}
                    </div>
                  ))}
                  <div className="pt-2 text-[10px] text-muted-foreground">
                    {pings.length} GPS ping{pings.length === 1 ? "" : "s"}
                    {pings.length > 0 && ` · last ${new Date(pings[pings.length - 1].recorded_at).toLocaleTimeString()}`}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <DispatchDialog open={dialog} onClose={() => setDialog(false)} onCreated={(id) => id && setSelectedId(id)} />
    </DashboardLayout>
  );
};

export default Dispatches;
