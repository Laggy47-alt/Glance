import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { toast } from "sonner";
import { Loader2, Phone, Settings, CheckCircle2, Clock, Trash2 } from "lucide-react";

type Callout = {
  id: string;
  instance_id: string;
  camera: string | null;
  reason: string | null;
  status: string;
  requester_name: string | null;
  created_at: string;
  resolved_at: string | null;
  admin_note: string | null;
};

const Callouts = () => {
  const store = useWebhookStore();
  const [rows, setRows] = useState<Callout[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noteFor, setNoteFor] = useState<Callout | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("callout_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as Callout[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("admin-callouts")
      .on("postgres_changes", { event: "*", schema: "public", table: "callout_requests" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const updateStatus = async (id: string, status: string, admin_note?: string) => {
    const patch: { status: string; resolved_at?: string; admin_note?: string } = { status };
    if (status === "resolved") patch.resolved_at = new Date().toISOString();
    if (admin_note !== undefined) patch.admin_note = admin_note;
    const { error } = await supabase.from("callout_requests").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Updated");
    if (status === "resolved") {
      const { data, error: emailErr } = await supabase.functions.invoke("callout-resolved", { body: { callout_id: id } });
      if (emailErr || (data as { error?: string })?.error) {
        toast.error(`Email not sent: ${(data as { error?: string })?.error ?? emailErr?.message}`);
      } else {
        toast.success("Customer notified by email");
      }
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this callout?")) return;
    const { error } = await supabase.from("callout_requests").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Deleted");
  };

  const open = rows.filter((r) => r.status !== "resolved").length;

  return (
    <DashboardLayout
      title="Callout Requests"
      subtitle={`${open} open · ${rows.length} total`}
      actions={
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
          <Settings className="h-3.5 w-3.5" /> Notification settings
        </Button>
      }
    >
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>NVR / Camera</TableHead>
              <TableHead>Reason</TableHead>
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
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No callout requests yet</TableCell></TableRow>
            )}
            {rows.map((r) => {
              const inst = store.frigates.find((f) => f.id === r.instance_id);
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-sm">{r.requester_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium truncate">{inst?.name ?? "Unknown"}</div>
                    {r.camera && <div className="text-[11px] text-muted-foreground">{r.camera}</div>}
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <div className="text-xs whitespace-pre-wrap break-words text-muted-foreground">{r.reason || "—"}</div>
                    {r.admin_note && (
                      <div className="text-[11px] mt-1 text-primary italic">Note: {r.admin_note}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.status === "open" && <Badge variant="destructive" className="gap-1 text-[10px]"><Clock className="h-3 w-3" /> Open</Badge>}
                    {r.status === "acknowledged" && <Badge className="gap-1 text-[10px] bg-amber-500/20 text-amber-600 border border-amber-500/40"><Clock className="h-3 w-3" /> Acknowledged</Badge>}
                    {r.status === "resolved" && <Badge variant="secondary" className="gap-1 text-[10px]"><CheckCircle2 className="h-3 w-3" /> Resolved</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {r.status === "open" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => updateStatus(r.id, "acknowledged")}>Ack</Button>
                      )}
                      {r.status !== "resolved" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setNoteFor(r)}>Resolve</Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => remove(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ResolveDialog
        callout={noteFor}
        onClose={() => setNoteFor(null)}
        onConfirm={async (note) => {
          if (noteFor) await updateStatus(noteFor.id, "resolved", note);
          setNoteFor(null);
        }}
      />
    </DashboardLayout>
  );
};

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [recipients, setRecipients] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void supabase.from("callout_settings").select("*").limit(1).maybeSingle().then(({ data }) => {
      if (data) {
        setId(data.id);
        setRecipients((data.recipients ?? []).join(", "));
        setSubject(data.subject ?? "");
      }
    });
  }, [open]);

  const save = async () => {
    setBusy(true);
    const list = recipients.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
    const payload = { recipients: list, subject, updated_at: new Date().toISOString() };
    const { error } = id
      ? await supabase.from("callout_settings").update(payload).eq("id", id)
      : await supabase.from("callout_settings").insert(payload);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Settings saved");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Callout notification settings</DialogTitle>
          <DialogDescription>Where to email when a customer requests a callout.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Recipient emails (comma-separated)</label>
            <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ops@example.com, manager@example.com" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Email subject template</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Callout request — {{nvr_name}}" />
            <p className="text-[10px] text-muted-foreground">Available: {"{{nvr_name}}, {{camera}}, {{requester}}"}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">Uses SMTP from Daily Reports settings.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResolveDialog({
  callout, onClose, onConfirm,
}: { callout: Callout | null; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState("");
  useEffect(() => { if (callout) setNote(callout.admin_note ?? ""); }, [callout]);
  if (!callout) return null;
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve callout</DialogTitle>
          <DialogDescription>Add an optional internal note.</DialogDescription>
        </DialogHeader>
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done?" />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onConfirm(note)}>Mark resolved</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default Callouts;
