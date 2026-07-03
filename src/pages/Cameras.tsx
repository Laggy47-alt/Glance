import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, Trash2, MapPin, Search, RefreshCw, PlayCircle } from "lucide-react";

type Site = { id: string; name: string; color: string; unifi_instance_id: string; notes: string | null };
type CameraRow = {
  unifi_instance_id: string;
  camera_id: string;
  camera_name: string | null;
  site_id: string | null;
  is_online?: boolean;
};

const db = supabase as unknown as { from: (t: string) => any };

const Cameras = () => {
  const store = useWebhookStore();
  const { activeOrg } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [cams, setCams] = useState<CameraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [instanceFilter, setInstanceFilter] = useState<string>("all");
  const [siteFilter, setSiteFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSiteId, setBulkSiteId] = useState<string>("");
  const [manageOpen, setManageOpen] = useState(false);
  const [manageInstance, setManageInstance] = useState<string>("");
  const [newSiteName, setNewSiteName] = useState("");

  const rowKey = (r: { unifi_instance_id: string; camera_id: string }) => `${r.unifi_instance_id}:${r.camera_id}`;

  // Merge cameras from unifi_camera_status (live from bridge) with unifi_camera_sites (assignments).
  // Any status camera missing from camera_sites is auto-inserted so it becomes assignable.
  const load = async () => {
    setLoading(true);
    const [{ data: s }, { data: assigns }, { data: status }] = await Promise.all([
      db.from("unifi_sites").select("id, name, color, unifi_instance_id, notes").order("name"),
      db.from("unifi_camera_sites").select("unifi_instance_id, camera_id, camera_name, site_id"),
      db.from("unifi_camera_status").select("instance_id, camera_id, name, is_online"),
    ]);

    const assignMap = new Map<string, CameraRow>();
    for (const a of (assigns ?? []) as CameraRow[]) assignMap.set(rowKey(a), a);

    const missing: Array<{ unifi_instance_id: string; camera_id: string; camera_name: string | null }> = [];
    for (const st of (status ?? []) as Array<{ instance_id: string; camera_id: string; name: string | null; is_online: boolean }>) {
      const k = `${st.instance_id}:${st.camera_id}`;
      const existing = assignMap.get(k);
      if (existing) {
        existing.is_online = st.is_online;
        if (!existing.camera_name && st.name) existing.camera_name = st.name;
      } else {
        const row: CameraRow = {
          unifi_instance_id: st.instance_id,
          camera_id: st.camera_id,
          camera_name: st.name,
          site_id: null,
          is_online: st.is_online,
        };
        assignMap.set(k, row);
        missing.push({ unifi_instance_id: st.instance_id, camera_id: st.camera_id, camera_name: st.name });
      }
    }

    // Auto-register cameras seen by the bridge but never sent an event yet.
    if (missing.length && activeOrg?.id) {
      const rows = missing.map((m) => ({ ...m, organization_id: activeOrg.id, site_id: null }));
      await db.from("unifi_camera_sites").upsert(rows, { onConflict: "unifi_instance_id,camera_id" });
    }

    setSites((s ?? []) as Site[]);
    setCams(Array.from(assignMap.values()));
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeOrg?.id]);

  const syncFromNvr = async () => {
    setSyncing(true);
    try { await load(); toast.success("Camera list refreshed from NVRs"); }
    finally { setSyncing(false); }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cams
      .filter((c) => instanceFilter === "all" || c.unifi_instance_id === instanceFilter)
      .filter((c) => siteFilter === "all" ? true : siteFilter === "none" ? !c.site_id : c.site_id === siteFilter)
      .filter((c) => !q || (c.camera_name ?? "").toLowerCase().includes(q) || c.camera_id.toLowerCase().includes(q))
      .sort((a, b) => (a.camera_name ?? a.camera_id).localeCompare(b.camera_name ?? b.camera_id));
  }, [cams, instanceFilter, siteFilter, query]);

  const toggle = (k: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };

  const bulkAssign = async () => {
    if (!bulkSiteId || selected.size === 0) return;
    const target = bulkSiteId === "__none__" ? null : bulkSiteId;
    const rows = cams.filter((c) => selected.has(rowKey(c)));
    for (const r of rows) {
      await db.from("unifi_camera_sites").update({ site_id: target })
        .eq("unifi_instance_id", r.unifi_instance_id).eq("camera_id", r.camera_id);
    }
    toast.success(`Assigned ${rows.length} camera${rows.length === 1 ? "" : "s"}`);
    setSelected(new Set());
    load();
  };

  const assignOne = async (r: CameraRow, siteId: string | null) => {
    await db.from("unifi_camera_sites").update({ site_id: siteId })
      .eq("unifi_instance_id", r.unifi_instance_id).eq("camera_id", r.camera_id);
    load();
  };

  const createSite = async () => {
    if (!newSiteName.trim() || !manageInstance || !activeOrg?.id) return;
    const { error } = await db.from("unifi_sites").insert({
      organization_id: activeOrg.id,
      unifi_instance_id: manageInstance,
      name: newSiteName.trim(),
    });
    if (error) { toast.error(error.message); return; }
    setNewSiteName("");
    load();
  };

  const deleteSite = async (id: string) => {
    if (!confirm("Delete this site? Cameras will be unassigned.")) return;
    const { error } = await db.from("unifi_sites").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const nvrName = (id: string) => store.unifis.find((u) => u.id === id)?.name ?? "Unknown NVR";
  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? "—";

  const liveHrefForSite = (s: Site) => `/unifi-live?instance=${s.unifi_instance_id}&site=${s.id}`;
  const liveHrefForCamera = (r: CameraRow) => `/unifi-live?instance=${r.unifi_instance_id}&camera=${encodeURIComponent(r.camera_id)}`;

  const camerasBySite = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cams) if (c.site_id) m.set(c.site_id, (m.get(c.site_id) ?? 0) + 1);
    return m;
  }, [cams]);

  return (
    <DashboardLayout title="Cameras" subtitle="Assign UniFi cameras to sites and open live view">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Camera name or id" className="pl-8" />
            </div>
          </div>
          <div>
            <Label className="text-xs">NVR</Label>
            <Select value={instanceFilter} onValueChange={setInstanceFilter}>
              <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All NVRs</SelectItem>
                {store.unifis.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Site</Label>
            <Select value={siteFilter} onValueChange={setSiteFilter}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="none">Unassigned</SelectItem>
                {sites
                  .filter((s) => instanceFilter === "all" || s.unifi_instance_id === instanceFilter)
                  .map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={syncFromNvr} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${syncing ? "animate-spin" : ""}`} /> Sync from NVR
          </Button>
          <Button variant="outline" onClick={() => { setManageInstance(instanceFilter !== "all" ? instanceFilter : (store.unifis[0]?.id ?? "")); setManageOpen(true); }}>
            <MapPin className="h-4 w-4 mr-1.5" /> Manage sites
          </Button>
        </div>

        {/* Sites overview with live-view buttons */}
        {sites.length > 0 && (
          <Card className="p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Sites — open live view for assigned cameras</div>
            <div className="flex flex-wrap gap-2">
              {sites
                .filter((s) => instanceFilter === "all" || s.unifi_instance_id === instanceFilter)
                .map((s) => (
                  <Link key={s.id} to={liveHrefForSite(s)}>
                    <Button size="sm" variant="secondary" className="gap-1.5">
                      <PlayCircle className="h-4 w-4" />
                      {s.name}
                      <span className="text-[10px] text-muted-foreground">
                        ({camerasBySite.get(s.id) ?? 0} · {nvrName(s.unifi_instance_id)})
                      </span>
                    </Button>
                  </Link>
                ))}
            </div>
          </Card>
        )}

        {selected.size > 0 && (
          <Card className="p-3 flex flex-wrap items-center gap-3 bg-muted/40">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Select value={bulkSiteId} onValueChange={setBulkSiteId}>
              <SelectTrigger className="w-[240px]"><SelectValue placeholder="Assign to site…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassign</SelectItem>
                {sites
                  .filter((s) => instanceFilter === "all" ? true : s.unifi_instance_id === instanceFilter)
                  .map((s) => <SelectItem key={s.id} value={s.id}>{s.name} — {nvrName(s.unifi_instance_id)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={bulkAssign} disabled={!bulkSiteId}>Apply</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="grid grid-cols-[32px_1fr_160px_170px_200px_90px] px-3 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/30">
            <span />
            <span>Camera</span>
            <span>NVR</span>
            <span>Camera ID</span>
            <span>Site</span>
            <span className="text-right">Live</span>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No cameras found. Click <span className="font-medium">Sync from NVR</span> — cameras appear here once the bridge has pushed status.
            </div>
          ) : (
            filtered.map((r) => {
              const k = rowKey(r);
              const isSel = selected.has(k);
              return (
                <div key={k} className="grid grid-cols-[32px_1fr_160px_170px_200px_90px] px-3 py-2 border-b items-center text-sm hover:bg-muted/20">
                  <Checkbox checked={isSel} onCheckedChange={() => toggle(k)} />
                  <span className="truncate flex items-center gap-2">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${r.is_online === false ? "bg-destructive" : r.is_online ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                      title={r.is_online === false ? "Offline" : r.is_online ? "Online" : "Unknown"}
                    />
                    {r.camera_name || <span className="text-muted-foreground">Unnamed</span>}
                  </span>
                  <span className="truncate text-muted-foreground">{nvrName(r.unifi_instance_id)}</span>
                  <span className="truncate text-muted-foreground font-mono text-xs">{r.camera_id}</span>
                  <Select value={r.site_id ?? "__none__"} onValueChange={(v) => assignOne(r, v === "__none__" ? null : v)}>
                    <SelectTrigger className="h-8"><SelectValue>{r.site_id ? siteName(r.site_id) : "—"}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Unassigned —</SelectItem>
                      {sites.filter((s) => s.unifi_instance_id === r.unifi_instance_id).map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-right">
                    <Link to={liveHrefForCamera(r)}>
                      <Button size="sm" variant="ghost" className="h-7 gap-1">
                        <PlayCircle className="h-3.5 w-3.5" /> Live
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </Card>
      </div>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage sites</DialogTitle>
            <DialogDescription>Sites group cameras from a UniFi NVR. Alerts on the Live Wall show the site name, and live view can be opened per site.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">NVR</Label>
              <Select value={manageInstance} onValueChange={setManageInstance}>
                <SelectTrigger><SelectValue placeholder="Select NVR" /></SelectTrigger>
                <SelectContent>
                  {store.unifis.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {manageInstance && (
              <>
                <div className="flex gap-2">
                  <Input value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} placeholder="New site name" />
                  <Button size="sm" onClick={createSite} disabled={!newSiteName.trim()}><Plus className="h-4 w-4 mr-1" />Add</Button>
                </div>
                <div className="space-y-1 max-h-64 overflow-auto">
                  {sites.filter((s) => s.unifi_instance_id === manageInstance).map((s) => (
                    <div key={s.id} className="flex items-center justify-between border rounded px-3 py-2">
                      <div>
                        <div className="text-sm font-medium">{s.name}</div>
                        <div className="text-[11px] text-muted-foreground">{camerasBySite.get(s.id) ?? 0} camera(s)</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Link to={liveHrefForSite(s)}>
                          <Button size="sm" variant="ghost" className="gap-1"><PlayCircle className="h-4 w-4" /> Live</Button>
                        </Link>
                        <Button size="sm" variant="ghost" onClick={() => deleteSite(s.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </div>
                  ))}
                  {sites.filter((s) => s.unifi_instance_id === manageInstance).length === 0 && (
                    <div className="text-xs text-muted-foreground px-1">No sites yet.</div>
                  )}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default Cameras;
