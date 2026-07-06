import { useEffect, useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Users, Phone, Mail, Smartphone } from "lucide-react";
import { ProvisionDeviceDialog } from "@/components/ProvisionDeviceDialog";

type Responder = {
  id: string;
  organization_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const emptyForm = (): Partial<Responder> => ({
  name: "", phone: "", email: "", role: "", active: true, notes: "",
});

const sb = supabase as any;

const Responders = () => {
  const { activeOrg } = useAuth();
  const [rows, setRows] = useState<Responder[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Responder | null>(null);
  const [form, setForm] = useState<Partial<Responder>>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [provisionFor, setProvisionFor] = useState<Responder | null>(null);

  const load = async () => {
    if (!activeOrg?.id) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await sb.from("responders").select("*")
      .eq("organization_id", activeOrg.id).order("name");
    setRows((data ?? []) as Responder[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase.channel("admin-responders")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "responders" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id]);

  const openNew = () => { setEditing(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (r: Responder) => { setEditing(r); setForm({ ...r }); setDialogOpen(true); };

  const save = async () => {
    if (!activeOrg?.id) return;
    if (!form.name?.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    const payload: any = {
      organization_id: activeOrg.id,
      name: form.name.trim(),
      phone: form.phone?.trim() || null,
      email: form.email?.trim() || null,
      role: form.role?.trim() || null,
      active: form.active ?? true,
      notes: form.notes?.trim() || null,
    };
    const res = editing
      ? await sb.from("responders").update(payload).eq("id", editing.id)
      : await sb.from("responders").insert(payload);
    setSaving(false);
    if (res.error) { toast.error(res.error.message ?? "Failed to save"); return; }
    toast.success(editing ? "Responder updated" : "Responder created");
    setDialogOpen(false);
    void load();
  };

  const remove = async (r: Responder) => {
    if (!confirm(`Delete responder "${r.name}"?`)) return;
    const { error } = await sb.from("responders").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Responder deleted");
    void load();
  };

  return (
    <DashboardLayout title="Responders" subtitle="People who go on callouts">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" /> Responders
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage the people that can be dispatched to a site.
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> New responder
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
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
                  No responders yet
                </TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.role ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3 text-muted-foreground" />{r.phone}</span> : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3 text-muted-foreground" />{r.email}</span> : "—"}
                  </TableCell>
                  <TableCell>
                    {r.active
                      ? <Badge variant="secondary" className="text-[10px]">Active</Badge>
                      : <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => openEdit(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => remove(r)}>
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
            <DialogTitle>{editing ? "Edit responder" : "New responder"}</DialogTitle>
            <DialogDescription>Contact details for the person on the ground.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Input value={form.role ?? ""} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Guard, supervisor…" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+27 82 000 0000" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@example.com" />
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

export default Responders;
