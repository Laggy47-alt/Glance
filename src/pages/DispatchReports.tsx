import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Polyline, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Loader2, FileText, ArrowLeft, Printer, MapPin, User, Car as CarIcon, CheckCircle2, Search,
} from "lucide-react";

const sb = supabase as any;

type Row = {
  id: string;
  organization_id: string;
  site_id: string;
  vehicle_id: string | null;
  responder_id: string | null;
  status: string;
  priority: string;
  notes: string | null;
  dispatched_at: string;
  acknowledged_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  response_seconds: number | null;
  alert_payload: any | null;
  alert_media_ids: string[] | null;
  feedback_outcome: string | null;
  feedback_action: string | null;
  feedback_notes: string | null;
  feedback_damage: string | null;
  feedback_submitted_at: string | null;
};

const OUTCOME_LABEL: Record<string, string> = {
  false_alarm: "False alarm", genuine: "Genuine incident",
  resolved: "Resolved", other: "Other",
};
const ACTION_LABEL: Record<string, string> = {
  patrol: "Patrol only", arrest: "Arrest / detained",
  saps_called: "SAPS called", none: "No action", other: "Other",
};

const siteIcon = L.divIcon({
  className: "",
  html: `<div style="background:#ef4444;color:#fff;border-radius:9999px;width:22px;height:22px;display:grid;place-items:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">S</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});
const responderIcon = L.divIcon({
  className: "",
  html: `<div style="background:#3b82f6;color:#fff;border-radius:9999px;width:22px;height:22px;display:grid;place-items:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">R</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function fmtDur(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${ss}s`;
  return `${ss}s`;
}

const DispatchReports = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeOrg } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<Record<string, { name: string; latitude: number | null; longitude: number | null; geofence_radius_m: number }>>({});
  const [responders, setResponders] = useState<Record<string, string>>({});
  const [vehicles, setVehicles] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [pings, setPings] = useState<{ latitude: number; longitude: number; recorded_at: string }[]>([]);
  const [events, setEvents] = useState<{ id: number; kind: string; payload: any; at: string }[]>([]);
  const [mediaUrls, setMediaUrls] = useState<{ url: string; ts: string; camera: string | null; kind: string }[]>([]);

  useEffect(() => {
    if (!activeOrg?.id) { setRows([]); setLoading(false); return; }
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const [d, s, r, v] = await Promise.all([
        sb.from("dispatches").select("*")
          .eq("organization_id", activeOrg.id)
          .gte("dispatched_at", since)
          .order("dispatched_at", { ascending: false }).limit(500),
        sb.from("sites").select("id, name, latitude, longitude, geofence_radius_m").eq("organization_id", activeOrg.id),
        sb.from("responders").select("id, name").eq("organization_id", activeOrg.id),
        sb.from("vehicles").select("id, plate").eq("organization_id", activeOrg.id),
      ]);
      setRows((d.data ?? []) as Row[]);
      setSites(Object.fromEntries((s.data ?? []).map((x: any) => [x.id, x])));
      setResponders(Object.fromEntries((r.data ?? []).map((x: any) => [x.id, x.name])));
      setVehicles(Object.fromEntries((v.data ?? []).map((x: any) => [x.id, x.plate])));
      setLoading(false);
    })();
  }, [activeOrg?.id]);

  // Sync :id → selected
  useEffect(() => {
    if (!id) { setSelected(null); return; }
    const found = rows.find((r) => r.id === id);
    if (found) setSelected(found);
    else {
      // Fetch it directly if not in list (older than 30 days)
      (async () => {
        const { data } = await sb.from("dispatches").select("*").eq("id", id).maybeSingle();
        if (data) setSelected(data as Row);
      })();
    }
  }, [id, rows]);

  // Load detail data when selected changes
  useEffect(() => {
    if (!selected) { setPings([]); setEvents([]); setMediaUrls([]); return; }
    (async () => {
      const [p, e] = await Promise.all([
        sb.from("dispatch_location_pings").select("latitude, longitude, recorded_at")
          .eq("dispatch_id", selected.id).order("recorded_at", { ascending: true }).limit(5000),
        sb.from("dispatch_events").select("id, kind, payload, at")
          .eq("dispatch_id", selected.id).order("at", { ascending: true }),
      ]);
      setPings((p.data ?? []) as any);
      setEvents((e.data ?? []) as any);
      if (selected.alert_media_ids && selected.alert_media_ids.length > 0) {
        const { data: media } = await sb.from("media_items")
          .select("url, kind, camera, ts")
          .in("id", selected.alert_media_ids);
        setMediaUrls((media ?? []).map((m: any) => ({ url: m.url, ts: m.ts, camera: m.camera, kind: m.kind })));
      } else {
        setMediaUrls([]);
      }
    })();
  }, [selected]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => {
      const site = sites[r.site_id]?.name?.toLowerCase() ?? "";
      const resp = r.responder_id ? (responders[r.responder_id] ?? "").toLowerCase() : "";
      return site.includes(term) || resp.includes(term) || r.priority.toLowerCase().includes(term)
        || (r.feedback_outcome ?? "").includes(term);
    });
  }, [rows, sites, responders, q]);

  const selectedSite = selected ? sites[selected.site_id] : null;

  // ----- List view -----
  if (!selected) {
    return (
      <DashboardLayout title="Dispatch Reports" subtitle={`${rows.length} in last 30 days`}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <FileText className="h-6 w-6 text-primary" /> Dispatch Reports
              </h1>
              <p className="text-sm text-muted-foreground">Full incident record from alert through completion.</p>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 h-9 text-sm" placeholder="Filter by site, responder, outcome…" />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dispatched</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Responder</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Response</TableHead>
                  <TableHead>Report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…
                  </TableCell></TableRow>
                )}
                {!loading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    No dispatches match.
                  </TableCell></TableRow>
                )}
                {filtered.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer"
                    onClick={() => navigate(`/dispatch-reports/${d.id}`)}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(d.dispatched_at).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{sites[d.site_id]?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{d.responder_id ? responders[d.responder_id] ?? "—" : "—"}</TableCell>
                    <TableCell className="text-xs capitalize">{d.priority}</TableCell>
                    <TableCell className="text-xs">
                      {d.feedback_outcome
                        ? <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">{OUTCOME_LABEL[d.feedback_outcome] ?? d.feedback_outcome}</Badge>
                        : d.status === "completed"
                          ? <Badge className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/40">Pending feedback</Badge>
                          : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {d.response_seconds != null ? `${Math.floor(d.response_seconds / 60)}m ${d.response_seconds % 60}s` : "—"}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="h-7 text-xs">
                        <FileText className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ----- Report detail view -----
  const dispatchedAt = new Date(selected.dispatched_at).getTime();
  const timelineRows = [
    { at: selected.dispatched_at, kind: "dispatched", detail: `Priority: ${selected.priority}` },
    selected.acknowledged_at && { at: selected.acknowledged_at, kind: "acknowledged", detail: "Responder acknowledged" },
    selected.arrived_at && { at: selected.arrived_at, kind: "arrived", detail: "Arrived on site" },
    selected.completed_at && { at: selected.completed_at, kind: "completed", detail: "Marked completed" },
    selected.cancelled_at && { at: selected.cancelled_at, kind: "cancelled", detail: "Cancelled" },
    ...events.filter((e) => ["feedback_submitted", "created"].includes(e.kind))
      .map((e) => ({ at: e.at, kind: e.kind, detail: JSON.stringify(e.payload ?? {}) })),
  ].filter(Boolean).sort((a: any, b: any) => new Date(a.at).getTime() - new Date(b.at).getTime()) as { at: string; kind: string; detail: string }[];

  const path = pings.map((p) => [p.latitude, p.longitude] as [number, number]);
  const mapCenter: [number, number] | null =
    path.length ? path[path.length - 1]
    : (selectedSite?.latitude != null && selectedSite?.longitude != null ? [selectedSite.latitude, selectedSite.longitude] : null);

  const snapshotUrl = mediaUrls.find((m) => m.kind !== "clip")?.url ?? selected.alert_payload?.snapshot_url ?? null;

  return (
    <DashboardLayout title="Dispatch Report" subtitle={sites[selected.site_id]?.name ?? ""}>
      <div className="space-y-4 print:space-y-3">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <Button size="sm" variant="ghost" onClick={() => navigate("/dispatch-reports")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to reports
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()} className="gap-1.5">
            <Printer className="h-4 w-4" /> Print / Save PDF
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 space-y-5">
          {/* Header */}
          <div className="border-b border-border pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Dispatch Report</div>
                <h1 className="text-xl font-semibold tracking-tight mt-0.5 flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" /> {sites[selected.site_id]?.name ?? "Unknown site"}
                </h1>
                <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                  <span>Dispatched {new Date(selected.dispatched_at).toLocaleString()}</span>
                  <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{selected.responder_id ? responders[selected.responder_id] ?? "—" : "—"}</span>
                  {selected.vehicle_id && <span className="inline-flex items-center gap-1"><CarIcon className="h-3 w-3" />{vehicles[selected.vehicle_id] ?? "—"}</span>}
                  <span className="capitalize">Priority: {selected.priority}</span>
                </div>
              </div>
              <div className="text-right">
                <Badge className="text-[10px] capitalize">{selected.status.replace(/_/g, " ")}</Badge>
                <div className="text-[10px] text-muted-foreground mt-1 font-mono">#{selected.id.slice(0, 8)}</div>
              </div>
            </div>
          </div>

          {/* Initial alert */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Initial alert</h2>
            {selected.alert_payload || snapshotUrl ? (
              <div className="flex gap-4">
                {snapshotUrl && (
                  <img src={snapshotUrl} alt="Alert snapshot" className="w-64 h-40 object-cover rounded-md border border-border" />
                )}
                <div className="flex-1 text-sm space-y-1">
                  <div><span className="text-muted-foreground text-xs">Label:</span> {selected.alert_payload?.label ?? "—"}</div>
                  <div><span className="text-muted-foreground text-xs">Camera:</span> {selected.alert_payload?.camera ?? "—"}</div>
                  <div><span className="text-muted-foreground text-xs">Site (source):</span> {selected.alert_payload?.site ?? "—"}</div>
                  <div><span className="text-muted-foreground text-xs">Alert time:</span> {selected.alert_payload?.ts ? new Date(selected.alert_payload.ts).toLocaleString() : "—"}</div>
                  {selected.notes && <div className="pt-1"><span className="text-muted-foreground text-xs">Operator note:</span> {selected.notes}</div>}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">Manual dispatch — no originating alert.</div>
            )}
          </section>

          {/* Response times */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-md border border-border p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Dispatch → Ack</div>
              <div className="text-lg font-semibold tabular-nums mt-0.5">
                {selected.acknowledged_at ? fmtDur(new Date(selected.acknowledged_at).getTime() - dispatchedAt) : "—"}
              </div>
            </div>
            <div className="rounded-md border border-border p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Dispatch → Arrived</div>
              <div className="text-lg font-semibold tabular-nums mt-0.5">
                {selected.arrived_at ? fmtDur(new Date(selected.arrived_at).getTime() - dispatchedAt) : "—"}
              </div>
            </div>
            <div className="rounded-md border border-border p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">On-scene time</div>
              <div className="text-lg font-semibold tabular-nums mt-0.5">
                {selected.arrived_at && selected.completed_at
                  ? fmtDur(new Date(selected.completed_at).getTime() - new Date(selected.arrived_at).getTime())
                  : "—"}
              </div>
            </div>
            <div className="rounded-md border border-border p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
              <div className="text-lg font-semibold tabular-nums mt-0.5">
                {selected.completed_at
                  ? fmtDur(new Date(selected.completed_at).getTime() - dispatchedAt)
                  : "—"}
              </div>
            </div>
          </section>

          {/* Route map */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Route ({pings.length} pings)</h2>
            <div className="h-72 rounded-md overflow-hidden border border-border bg-secondary/40">
              {mapCenter ? (
                <MapContainer center={mapCenter} zoom={14} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
                  {selectedSite?.latitude != null && selectedSite.longitude != null && (
                    <>
                      <Marker position={[selectedSite.latitude, selectedSite.longitude]} icon={siteIcon} />
                      <Circle
                        center={[selectedSite.latitude, selectedSite.longitude]}
                        radius={selectedSite.geofence_radius_m ?? 100}
                        pathOptions={{ color: "#ef4444", weight: 1, fillOpacity: 0.06 }}
                      />
                    </>
                  )}
                  {path.length > 1 && <Polyline positions={path} pathOptions={{ color: "#3b82f6", weight: 3 }} />}
                  {path.length > 0 && <Marker position={path[path.length - 1]} icon={responderIcon} />}
                </MapContainer>
              ) : (
                <div className="h-full grid place-items-center text-xs text-muted-foreground">No location data captured.</div>
              )}
            </div>
          </section>

          {/* Timeline */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Timeline</h2>
            <div className="space-y-1.5">
              {timelineRows.map((t, i) => {
                const dt = new Date(t.at).getTime() - dispatchedAt;
                return (
                  <div key={i} className="flex items-start gap-3 text-sm border-l-2 border-border pl-3">
                    <span className="text-xs text-muted-foreground w-36 shrink-0 tabular-nums">
                      {new Date(t.at).toLocaleTimeString()} <span className="text-[10px]">(+{fmtDur(dt)})</span>
                    </span>
                    <span className="font-medium capitalize w-32 shrink-0">{t.kind.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground text-xs">{t.detail}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Feedback */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5" /> Operator feedback
            </h2>
            {selected.feedback_submitted_at ? (
              <div className="rounded-md border border-border p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Outcome</div>
                  <div className="font-medium">{OUTCOME_LABEL[selected.feedback_outcome ?? ""] ?? selected.feedback_outcome ?? "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Action taken</div>
                  <div className="font-medium">{ACTION_LABEL[selected.feedback_action ?? ""] ?? selected.feedback_action ?? "—"}</div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes from responder</div>
                  <div className="whitespace-pre-wrap">{selected.feedback_notes ?? "—"}</div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Damage / loss</div>
                  <div className="whitespace-pre-wrap">{selected.feedback_damage ?? "—"}</div>
                </div>
                <div className="md:col-span-2 text-[10px] text-muted-foreground border-t border-border pt-2">
                  Submitted {new Date(selected.feedback_submitted_at).toLocaleString()}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                Feedback not yet recorded.{" "}
                {selected.status === "completed" && (
                  <span className="underline cursor-pointer print:hidden" onClick={() => navigate("/dispatches")}>
                    Go to Dispatches to fill in.
                  </span>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default DispatchReports;
