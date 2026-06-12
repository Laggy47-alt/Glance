import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useUnifiInstances } from "@/hooks/useUnifi";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Cctv, Plus, Trash2, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { fetchUnifiCameras, type UnifiInstance } from "@/lib/unifiClient";

const empty = { name: "", base_url: "", api_key: "", color: "#22c55e", is_local: true, verify_tls: false, enabled: true };

export default function UnifiNvrs() {
  const { activeOrg, isAdmin } = useAuth();
  const { instances, loading, refresh } = useUnifiInstances(activeOrg?.id ?? null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UnifiInstance | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const openNew = () => { setEditing(null); setForm({ ...empty }); setOpen(true); };
  const openEdit = (i: UnifiInstance) => {
    setEditing(i);
    setForm({ name: i.name, base_url: i.base_url, api_key: i.api_key, color: i.color, is_local: i.is_local, verify_tls: i.verify_tls, enabled: i.enabled });
    setOpen(true);
  };

  const save = async () => {
    if (!activeOrg?.id) return;
    if (!form.name.trim() || !form.base_url.trim() || !form.api_key.trim()) {
      toast({ title: "Missing fields", description: "Name, host URL and API key are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = { ...form, organization_id: activeOrg.id, base_url: form.base_url.trim().replace(/\/+$/, "") };
    const { error } = editing
      ? await supabase.from("unifi_instances" as any).update(payload).eq("id", editing.id)
      : await supabase.from("unifi_instances" as any).insert(payload);
    setSaving(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: editing ? "Updated" : "Added", description: form.name });
    setOpen(false);
    void refresh();
  };

  const remove = async (i: UnifiInstance) => {
    if (!confirm(`Delete ${i.name}?`)) return;
    const { error } = await supabase.from("unifi_instances" as any).delete().eq("id", i.id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted", description: i.name }); void refresh(); }
  };

  const test = async (i: UnifiInstance) => {
    setTesting(i.id);
    try {
      const cams = await fetchUnifiCameras(i);
      setTestResult((r) => ({ ...r, [i.id]: { ok: true, msg: `${cams.length} cameras` } }));
    } catch (e) {
      setTestResult((r) => ({ ...r, [i.id]: { ok: false, msg: (e as Error).message } }));
    }
    setTesting(null);
  };

  return (
    <DashboardLayout
      title="UniFi Protect NVRs"
      subtitle={`Configure UniFi Protect for ${activeOrg?.name ?? "this org"}`}
      actions={isAdmin && <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add NVR</Button>}
    >
      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…</div>
      ) : instances.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Cctv className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-sm font-semibold">No UniFi NVR configured</h3>
          <p className="text-xs text-muted-foreground mt-1">Add your UniFi Protect NVR to get started.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {instances.map((i) => (
            <Card key={i.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />
                  {i.name}
                  {!i.enabled && <span className="text-[10px] uppercase text-muted-foreground">disabled</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground font-mono break-all">{i.base_url}</div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => test(i)} disabled={testing === i.id}>
                    {testing === i.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test connection"}
                  </Button>
                  {testResult[i.id] && (
                    <span className={`text-xs inline-flex items-center gap-1 ${testResult[i.id].ok ? "text-success" : "text-destructive"}`}>
                      {testResult[i.id].ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      {testResult[i.id].msg}
                    </span>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex gap-2 pt-2 border-t border-border">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(i)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(i)} className="text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit NVR" : "Add UniFi Protect NVR"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Main Building" /></div>
            <div>
              <Label>Host URL</Label>
              <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://192.168.1.1" />
              <p className="text-[10px] text-muted-foreground mt-1">UniFi OS console URL — typically the gateway IP over HTTPS.</p>
            </div>
            <div>
              <Label>API Key</Label>
              <Input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="X-API-KEY value" />
              <p className="text-[10px] text-muted-foreground mt-1">Create in UniFi OS → Control Plane → Integrations.</p>
            </div>
            <div className="flex items-center gap-2"><Label className="text-xs flex-1">Color</Label><input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-8 w-12 rounded border-border" /></div>
            <div className="flex items-center justify-between"><Label className="text-xs">Local network</Label><Switch checked={form.is_local} onCheckedChange={(v) => setForm({ ...form, is_local: v })} /></div>
            <div className="flex items-center justify-between"><Label className="text-xs">Enabled</Label><Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
