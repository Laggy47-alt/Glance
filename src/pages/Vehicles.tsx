import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Car } from "lucide-react";

type Vehicle = {
  id: string;
  organization_id: string;
  plate: string;
  make: string | null;
  model: string | null;
  color: string | null;
  responder_id: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type Responder = { id: string; name: string };

const emptyForm = (): Partial<Vehicle> => ({
  plate: "", make: "", model: "", color: "", responder_id: null, active: true, notes: "",
});

const sb = supabase as any;

const Vehicles = () => {
  const { activeOrg } = useAuth();
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<Partial<Vehicle>>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = async () => {
    if (!activeOrg?.id) { setRows([]); setResponders([]); setLoading(false); return; }
    setLoading(true);
    const [v, r] = await Promise.all([
      sb.from("vehicles").select("*").eq("organization_id", activeOrg.id).order("plate"),
      sb.from("responders").select("id,name").eq("organization_id", activeOrg.id).eq("active", true).order("name"),
    ]);
    setRows((v.data ?? []) as Vehicle[]);
    setResponders((r.data ?? []) as Responder[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase.channel("admin-vehicles")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "vehicles" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id]);

  const responderName = useMemo(() => {
    const m = new Map(responders.map((r) => [r.id, r.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [responders]);

  const openNew = () => { setEditing(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (v: Vehicle) => { setEditing(v); setForm({ ...v }); setDialogOpen(true); };

  const save = async () => {
    if (!activeOrg?.id) return;
    if (!form.plate?.trim()) { toast.error("Plate is required"); return; }
    setSaving(true);
    const payload: any = {
      organization_id: activeOrg.id,
      plate: form.plate.trim().toUpperCase(),
      make: form.make?.trim() || null,
      model: form.model?.trim() || null,
      color: form.color?.trim() || null,
      responder_id: form.responder_id || null,
      active: form.active ?? true,
      notes: form.notes?.trim() || null,
    };
    const res = editing
      ? await sb.from("vehicles").update(payload).eq("id", editing.id)
      : await sb.from("vehicles").insert(payload);
    setSaving(false);
    if (res.error) { toast.error(res.error.message ?? "Failed to save"); return; }
    toast.success(editing ? "Vehicle updated" : "Vehicle created");
    setDialogOpen(false);
    void load();
  };

  const remove = async (v: Vehicle) => {
    if (!confirm(`Delete vehicle "${v.plate}"?`)) return;
    const { error } = await sb.from("vehicles").delete().eq("id", v.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Vehicle deleted");
    void load();
  };

  return (
    <DashboardLayout title="Vehicles" subtitle="Dispatch vehicles">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Car className="h-6 w-6 text-primary" /> Vehicles
            </h1>
            <p className="text-sm text-muted-foreground">
              Vehicles you can dispatch to a callout. Optionally assign a responder.
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> New vehicle
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plate</TableHead>
                <TableHead>Make / Model</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Assigned to</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…
                </TableCell></TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                  No vehicles yet
                </TableCell></TableRow>
              )}
              {rows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono font-medium">{v.plate}</TableCell>
                  <TableCell className="text-sm">
                    {[v.make, v.model].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{v.color ?? "—"}</TableCell>
                  <TableCell className="text-sm">{responderName(v.responder_id)}</TableCell>
                  <TableCell>
                    {v.active
                      ? <Badge variant="secondary" className="text-[10px]">Active</Badge>
                      : <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => openEdit(v)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => remove(v)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit vehicle" : "New vehicle"}</DialogTitle>
            <DialogDescription>Vehicle details for dispatch.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Plate *</Label>
                <Input value={form.plate ?? ""} onChange={(e) => setForm({ ...form, plate: e.target.value })} placeholder="CA 123-456" className="font-mono uppercase" />
              </div>
              <div className="space-y-1.5">
                <Label>Color</Label>
                <Input value={form.color ?? ""} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="White" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Make</Label>
                <Input value={form.make ?? ""} onChange={(e) => setForm({ ...form, make: e.target.value })} placeholder="Toyota" />
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Input value={form.model ?? ""} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="Hilux" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Assigned responder</Label>
              <Select
                value={form.responder_id ?? "__none__"}
                onValueChange={(v) => setForm({ ...form, responder_id: v === "__none__" ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {responders.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active ?? true} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default Vehicles;
