import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  MapPin,
  Pencil,
  Trash2,
  Building2,
  Link2,
} from "lucide-react";
import { SiteMapPicker } from "@/components/SiteMapPicker";

type Site = {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type NvrRow = {
  id: string;
  name: string;
  site_id: string | null;
  multi_site: boolean;
  kind: "unifi" | "hikvision" | "frigate";
};

type NvrAssignment = {
  id: string;
  nvr_kind: "unifi" | "hikvision" | "frigate";
  nvr_id: string;
  site_id: string;
};

const emptyForm = (): Partial<Site> => ({
  name: "",
  address: "",
  latitude: null,
  longitude: null,
  geofence_radius_m: 100,
  notes: "",
});

const sb = supabase as any;

const Sites = () => {
  const { activeOrg } = useAuth();
  const [rows, setRows] = useState<Site[]>([]);
  const [nvrs, setNvrs] = useState<NvrRow[]>([]);
  const [assignments, setAssignments] = useState<NvrAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Site | null>(null);
  const [form, setForm] = useState<Partial<Site>>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [linkSite, setLinkSite] = useState<Site | null>(null);

  const load = async () => {
    if (!activeOrg?.id) {
      setRows([]);
      setNvrs([]);
      setAssignments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [sitesRes, unifiRes, hikRes, frigRes, assignRes] = await Promise.all([
      sb
        .from("sites")
        .select("*")
        .eq("organization_id", activeOrg.id)
        .order("name"),
      sb
        .from("unifi_instances")
        .select("id,name,site_id,multi_site")
        .eq("organization_id", activeOrg.id),
      sb
        .from("hikvision_instances")
        .select("id,name,site_id,multi_site")
        .eq("organization_id", activeOrg.id),
      sb
        .from("frigate_instances")
        .select("id,name,site_id,multi_site")
        .eq("organization_id", activeOrg.id),
      sb
        .from("nvr_site_assignments")
        .select("id,nvr_kind,nvr_id,site_id")
        .eq("organization_id", activeOrg.id),
    ]);
    setRows((sitesRes.data ?? []) as Site[]);
    const merged: NvrRow[] = [
      ...(unifiRes.data ?? []).map((r: any) => ({ ...r, multi_site: !!r.multi_site, kind: "unifi" as const })),
      ...(hikRes.data ?? []).map((r: any) => ({ ...r, multi_site: !!r.multi_site, kind: "hikvision" as const })),
      ...(frigRes.data ?? []).map((r: any) => ({ ...r, multi_site: !!r.multi_site, kind: "frigate" as const })),
    ];
    setNvrs(merged);
    setAssignments((assignRes.data ?? []) as NvrAssignment[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("admin-sites")
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "sites" },
        () => void load(),
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "nvr_site_assignments" },
        () => void load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id]);


  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (s: Site) => {
    setEditing(s);
    setForm({ ...s });
    setDialogOpen(true);
  };


  const save = async () => {
    if (!activeOrg?.id) return;
    if (!form.name?.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    const payload: any = {
      organization_id: activeOrg.id,
      name: form.name.trim(),
      address: form.address?.trim() || null,
      latitude: form.latitude ?? null,
      longitude: form.longitude ?? null,
      geofence_radius_m: Number(form.geofence_radius_m ?? 100),
      notes: form.notes?.trim() || null,
    };
    let error: any = null;
    if (editing) {
      const res = await sb.from("sites").update(payload).eq("id", editing.id);
      error = res.error;
    } else {
      const res = await sb.from("sites").insert(payload);
      error = res.error;
    }
    setSaving(false);
    if (error) {
      toast.error(error.message ?? "Failed to save");
      return;
    }
    toast.success(editing ? "Site updated" : "Site created");
    setDialogOpen(false);
    void load();
  };

  const remove = async (s: Site) => {
    if (!confirm(`Delete site "${s.name}"? Linked NVRs will be unlinked.`)) return;
    const { error } = await sb.from("sites").delete().eq("id", s.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Site deleted");
    void load();
  };

  const tableFor = (kind: NvrRow["kind"]) =>
    kind === "unifi"
      ? "unifi_instances"
      : kind === "hikvision"
      ? "hikvision_instances"
      : "frigate_instances";

  // NVRs linked to a site = primary site_id match OR a row in nvr_site_assignments.
  const linkedNvrsForSite = (siteId: string) => {
    const extraIds = new Set(
      assignments
        .filter((a) => a.site_id === siteId)
        .map((a) => `${a.nvr_kind}:${a.nvr_id}`),
    );
    return nvrs.filter(
      (n) => n.site_id === siteId || extraIds.has(`${n.kind}:${n.id}`),
    );
  };

  // Sites already linked to this NVR (primary + extras).
  const sitesForNvr = (n: NvrRow): string[] => {
    const ids = new Set<string>();
    if (n.site_id) ids.add(n.site_id);
    for (const a of assignments) {
      if (a.nvr_kind === n.kind && a.nvr_id === n.id) ids.add(a.site_id);
    }
    return [...ids];
  };

  // Available NVRs for a specific site = not currently linked to it.
  const availableNvrsForSite = (siteId: string) => {
    const linked = new Set(linkedNvrsForSite(siteId).map((n) => `${n.kind}:${n.id}`));
    return nvrs.filter((n) => !linked.has(`${n.kind}:${n.id}`));
  };

  const setNvrPrimarySite = async (n: NvrRow, siteId: string | null) => {
    const { error } = await sb.from(tableFor(n.kind)).update({ site_id: siteId }).eq("id", n.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void load();
  };

  const toggleMultiSite = async (n: NvrRow, next: boolean) => {
    const { error } = await sb.from(tableFor(n.kind)).update({ multi_site: next }).eq("id", n.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    // When turning OFF, clear any extra site assignments (keep primary site_id).
    if (!next) {
      await sb
        .from("nvr_site_assignments")
        .delete()
        .eq("nvr_kind", n.kind)
        .eq("nvr_id", n.id);
    }
    toast.success(next ? "Multi-site enabled" : "Multi-site disabled");
    void load();
  };

  // Link this NVR to the current site (primary if none, else additional via join).
  const linkNvrToSite = async (n: NvrRow, site: Site) => {
    if (!n.site_id) {
      await setNvrPrimarySite(n, site.id);
      toast.success("NVR linked");
      return;
    }
    if (!n.multi_site) {
      toast.error("Enable multi-site on this NVR to link additional sites");
      return;
    }
    if (!activeOrg?.id) return;
    const { error } = await sb.from("nvr_site_assignments").insert({
      organization_id: activeOrg.id,
      nvr_kind: n.kind,
      nvr_id: n.id,
      site_id: site.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("NVR linked to additional site");
    void load();
  };

  // Unlink this NVR from the current site. Primary → null site_id. Extras → delete row.
  const unlinkNvrFromSite = async (n: NvrRow, site: Site) => {
    if (n.site_id === site.id) {
      await setNvrPrimarySite(n, null);
      toast.success("NVR unlinked");
      return;
    }
    const row = assignments.find(
      (a) => a.nvr_kind === n.kind && a.nvr_id === n.id && a.site_id === site.id,
    );
    if (!row) return;
    const { error } = await sb.from("nvr_site_assignments").delete().eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("NVR unlinked");
    void load();
  };


  return (
    <DashboardLayout title="Sites" subtitle="Physical locations with geofences for dispatch">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" /> Sites
            </h1>
            <p className="text-sm text-muted-foreground">
              Physical locations with geofences. Link NVRs and dispatch vehicles here.
            </p>
          </div>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" /> New site
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card">
          {loading ? (
            <div className="p-8 grid place-items-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No sites yet. Create your first site to enable dispatching.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Coordinates</TableHead>
                  <TableHead className="text-right">Geofence</TableHead>
                  <TableHead className="text-right">NVRs</TableHead>
                  <TableHead className="w-1" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => {
                  const linked = linkedNvrsForSite(s.id);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.address ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {s.latitude != null && s.longitude != null ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {s.geofence_radius_m} m
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={() => setLinkSite(s)}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Link2 className="h-3 w-3" />
                          {linked.length}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(s)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => remove(s)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit site" : "New site"}</DialogTitle>
            <DialogDescription>
              A site is a physical location responders are dispatched to.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={form.name ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Main office"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input
                value={form.address ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address: e.target.value }))
                }
                placeholder="123 Example St"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Location</Label>
              <SiteMapPicker
                latitude={form.latitude ?? null}
                longitude={form.longitude ?? null}
                radiusM={Number(form.geofence_radius_m ?? 100)}
                onChange={(lat, lng) =>
                  setForm((f) => ({
                    ...f,
                    latitude: Number(lat.toFixed(6)),
                    longitude: Number(lng.toFixed(6)),
                  }))
                }
              />
              {form.latitude != null && form.longitude != null && (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Geofence radius (meters)</Label>
              <Input
                type="number"
                min={10}
                max={5000}
                value={form.geofence_radius_m ?? 100}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    geofence_radius_m: Number(e.target.value),
                  }))
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Responders inside this radius are marked as arrived.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={form.notes ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {editing ? "Save changes" : "Create site"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link NVRs dialog */}
      <Dialog open={!!linkSite} onOpenChange={(o) => !o && setLinkSite(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Link NVRs to {linkSite?.name}</DialogTitle>
            <DialogDescription>
              Attach UniFi, Hikvision, and Frigate systems to this site.
            </DialogDescription>
          </DialogHeader>

          {linkSite && (() => {
            const linked = linkedNvrsForSite(linkSite.id);
            const available = availableNvrsForSite(linkSite.id);
            return (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                  Linked ({linked.length})
                </h3>
                <div className="space-y-1.5">
                  {linked.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      Nothing linked yet.
                    </p>
                  ) : (
                    linked.map((n) => {
                      const isPrimary = n.site_id === linkSite.id;
                      const linkedCount = sitesForNvr(n).length;
                      return (
                      <div
                        key={`${n.kind}-${n.id}`}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2 gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm truncate flex items-center gap-2">
                            {n.name}
                            {isPrimary && (
                              <span className="text-[9px] uppercase tracking-wider rounded bg-primary/15 text-primary px-1.5 py-0.5">
                                primary
                              </span>
                            )}
                            {n.multi_site && linkedCount > 1 && (
                              <span className="text-[9px] uppercase tracking-wider rounded bg-muted text-muted-foreground px-1.5 py-0.5">
                                {linkedCount} sites
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                            {n.kind}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <label className="flex items-center gap-1 text-[11px] text-muted-foreground select-none">
                            <input
                              type="checkbox"
                              className="h-3 w-3"
                              checked={n.multi_site}
                              onChange={(e) => toggleMultiSite(n, e.target.checked)}
                            />
                            multi
                          </label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => unlinkNvrFromSite(n, linkSite)}
                          >
                            Unlink
                          </Button>
                        </div>
                      </div>
                    );
                    })
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                  Available ({available.length})
                </h3>
                <div className="space-y-1.5">
                  {available.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      All NVRs are already linked to this site.
                    </p>
                  ) : (
                    available.map((n) => {
                      const alreadyHasPrimary = !!n.site_id;
                      const disabled = alreadyHasPrimary && !n.multi_site;
                      return (
                      <div
                        key={`${n.kind}-${n.id}`}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2 gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm truncate">{n.name}</div>
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                            {n.kind}
                            {alreadyHasPrimary && !n.multi_site && " · linked elsewhere"}
                            {alreadyHasPrimary && n.multi_site && " · multi-site"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {alreadyHasPrimary && !n.multi_site && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleMultiSite(n, true)}
                            >
                              Enable multi
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            onClick={() => linkNvrToSite(n, linkSite)}
                          >
                            Link
                          </Button>
                        </div>
                      </div>
                    );
                    })
                  )}
                </div>
              </div>
            </div>
            );
          })()}


          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkSite(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default Sites;
