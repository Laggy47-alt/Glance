import { useEffect, useMemo, useState } from "react";
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
import { Plus, Trash2, MapPin, Search } from "lucide-react";

type Site = { id: string; name: string; color: string; unifi_instance_id: string; notes: string | null };
type CameraRow = { id?: string; unifi_instance_id: string; camera_id: string; camera_name: string | null; site_id: string | null };

const Cameras = () => {
  const store = useWebhookStore();
  const { activeOrg } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [cams, setCams] = useState<CameraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [instanceFilter, setInstanceFilter] = useState<string>("all");
  const [siteFilter, setSiteFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSiteId, setBulkSiteId] = useState<string>("");
  const [manageOpen, setManageOpen] = useState(false);
  const [manageInstance, setManageInstance] = useState<string>("");
  const [newSiteName, setNewSiteName] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data: s }, { data: c }] = await Promise.all([
      supabase.from("unifi_sites").select("id, name, color, unifi_instance_id, notes").order("name"),
      supabase.from("unifi_camera_sites").select("id, unifi_instance_id, camera_id, camera_name, site_id"),
    ]);
    setSites((s ?? []) as Site[]);
    setCams((c ?? []) as CameraRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [activeOrg?.id]);

  const rowKey = (r: CameraRow) => `${r.unifi_instance_id}:${r.camera_id}`;

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
      await supabase.from("unifi_camera_sites").update({ site_id: target }).eq("unifi_instance_id", r.unifi_instance_id).eq("camera_id", r.camera_id);
    }
    toast.success(`Assigned ${rows.length} camera${rows.length === 1 ? "" : "s"}`);
    setSelected(new Set());
    load();
  };

  const assignOne = async (r: CameraRow, siteId: string | null) => {
    await supabase.from("unifi_camera_sites").update({ site_id: siteId }).eq("unifi_instance_id", r.unifi_instance_id).eq("camera_id", r.camera_id);
    load();
  };

  const createSite = async () => {
    if (!newSiteName.trim() || !manageInstance || !activeOrg?.id) return;
    const { error } = await supabase.from("unifi_sites").insert({
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
    const { error } = await supabase.from("unifi_sites").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const nvrName = (id: string) => store.unifis.find((u) => u.id === id)?.name ?? "Unknown NVR";
  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? "—";

  return (
    <DashboardLayout title="Cameras" subtitle="Assign UniFi cameras to sites">
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
          <Button variant="outline" onClick={() => { setManageInstance(instanceFilter !== "all" ? instanceFilter : (store.unifis[0]?.id ?? "")); setManageOpen(true); }}>
            <MapPin className="h-4 w-4 mr-1.5" /> Manage sites
          </Button>
        </div>

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
          <div className="grid grid-cols-[32px_1fr_180px_180px_220px] px-3 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/30">
            <span />
            <span>Camera</span>
            <span>NVR</span>
            <span>Camera ID</span>
            <span>Site</span>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No cameras yet. They appear here after the first event arrives from each camera.</div>
          ) : (
            filtered.map((r) => {
              const k = rowKey(r);
              const isSel = selected.has(k);
              return (
                <div key={k} className="grid grid-cols-[32px_1fr_180px_180px_220px] px-3 py-2 border-b items-center text-sm hover:bg-muted/20">
                  <Checkbox checked={isSel} onCheckedChange={() => toggle(k)} />
                  <span className="truncate">{r.camera_name || <span className="text-muted-foreground">Unnamed</span>}</span>
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
            <DialogDescription>Sites group cameras from a UniFi NVR. Alerts on the Live Wall show the site name.</DialogDescription>
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
                      <span className="text-sm font-medium">{s.name}</span>
                      <Button size="sm" variant="ghost" onClick={() => deleteSite(s.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
