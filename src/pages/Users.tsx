import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Loader2, Plus, KeyRound, Trash2, ShieldCheck, User as UserIcon, Building2, Server, Mail, ChevronDown } from "lucide-react";
import { frigateUrl } from "@/lib/webhookStore";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type UserRole = "admin" | "user" | "customer";

type Row = {
  user_id: string;
  username: string;
  display_name: string | null;
  must_change_password: boolean;
  contact_email: string | null;
  role: UserRole;
};

const Users = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [resetFor, setResetFor] = useState<Row | null>(null);
  const [assignFor, setAssignFor] = useState<Row | null>(null);
  const [emailFor, setEmailFor] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: profs }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("user_id, username, display_name, must_change_password, contact_email").order("username"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    const roleMap = new Map<string, UserRole>();
    (roles ?? []).forEach((r) => {
      const existing = roleMap.get(r.user_id);
      // admin > customer > user precedence for display
      const order: Record<string, number> = { admin: 3, customer: 2, user: 1 };
      const cur = (r.role as UserRole);
      if (!existing || order[cur] > order[existing]) roleMap.set(r.user_id, cur);
    });
    const merged: Row[] = (profs ?? []).map((p: any) => ({
      user_id: p.user_id,
      username: p.username,
      display_name: p.display_name,
      must_change_password: p.must_change_password,
      contact_email: p.contact_email ?? null,
      role: roleMap.get(p.user_id) ?? "user",
    }));
    setRows(merged);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const deleteUser = async (r: Row) => {
    if (!confirm(`Delete user "${r.username}"? This cannot be undone.`)) return;
    const { data, error } = await supabase.functions.invoke("admin-users/delete", {
      method: "POST",
      body: { user_id: r.user_id },
    });
    if (error || (data as { ok?: boolean })?.ok === false) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "Failed to delete user");
      return;
    }
    toast.success("User deleted");
    await load();
  };

  return (
    <DashboardLayout
      title="Users"
      subtitle="Manage operator and customer accounts"
      actions={
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New user
        </Button>
      }
    >
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Display name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
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
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No users</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.user_id}>
                <TableCell className="font-medium">{r.username}</TableCell>
                <TableCell>{r.display_name ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.contact_email ?? "—"}</TableCell>
                <TableCell>
                  {r.role === "admin" ? (
                    <Badge className="gap-1"><ShieldCheck className="h-3 w-3" /> Admin</Badge>
                  ) : r.role === "customer" ? (
                    <Badge variant="outline" className="gap-1 border-primary/40 text-primary"><Building2 className="h-3 w-3" /> Customer</Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1"><UserIcon className="h-3 w-3" /> User</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {r.must_change_password ? (
                    <Badge variant="outline" className="text-amber-500 border-amber-500/40">Must change password</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Active</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {r.role === "customer" && (
                      <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setAssignFor(r)}>
                        <Server className="h-3.5 w-3.5" /> NVRs
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setEmailFor(r)}>
                      <Mail className="h-3.5 w-3.5" /> Email
                    </Button>
                    <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setResetFor(r)}>
                      <KeyRound className="h-3.5 w-3.5" /> Reset password
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-destructive hover:text-destructive"
                      disabled={r.user_id === user?.id}
                      onClick={() => deleteUser(r)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} organizationId={activeOrg?.id ?? null} />
      <ResetPasswordDialog row={resetFor} onClose={() => setResetFor(null)} onDone={load} />
      <AssignNvrsDialog row={assignFor} onClose={() => setAssignFor(null)} />
      <EditEmailDialog row={emailFor} onClose={() => setEmailFor(null)} onDone={load} />
    </DashboardLayout>
  );
};

function CreateUserDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [password, setPassword] = useState("changeme");
  const [role, setRole] = useState<UserRole>("user");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-users/create", {
      method: "POST",
      body: { username, password, display_name: displayName || username, role, contact_email: contactEmail || null },
    });
    setBusy(false);
    if (error || (data as { ok?: boolean })?.ok === false) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "Failed to create user");
      return;
    }
    toast.success(`User "${username}" created. They must change their password on first login.`);
    setUsername(""); setDisplayName(""); setContactEmail(""); setPassword("changeme"); setRole("user");
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>The user will be required to change the default password on first login.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus pattern="[a-zA-Z0-9_.\-]{2,32}" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Display name (optional)</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Contact email (optional)</Label>
            <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="customer@example.com" />
            <p className="text-[11px] text-muted-foreground">Used for callout-resolved notifications.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Default password</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Role</Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={role === "user" ? "default" : "outline"} onClick={() => setRole("user")}>User</Button>
              <Button type="button" size="sm" variant={role === "admin" ? "default" : "outline"} onClick={() => setRole("admin")}>Admin</Button>
              <Button type="button" size="sm" variant={role === "customer" ? "default" : "outline"} onClick={() => setRole("customer")}>Customer</Button>
            </div>
            {role === "customer" && (
              <p className="text-[11px] text-muted-foreground">After creating, click <strong>NVRs</strong> in the user row to assign NVRs.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  row, onClose, onDone,
}: { row: Row | null; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState("changeme");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (row) setPw("changeme"); }, [row]);

  if (!row) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-users/reset-password", {
      method: "POST",
      body: { user_id: row.user_id, password: pw },
    });
    setBusy(false);
    if (error || (data as { ok?: boolean })?.ok === false) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "Failed to reset password");
      return;
    }
    toast.success(`Password reset for ${row.username}. They must change it on next login.`);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password — {row.username}</DialogTitle>
          <DialogDescription>The user will be forced to change this password on their next login.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">New temporary password</Label>
            <Input value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} autoFocus />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reset
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignNvrsDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const store = useWebhookStore();
  // Set of assigned NVR ids
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  // Map<instance_id, Set<camera>> of explicitly chosen cameras. If an NVR id is not present
  // in this map at save time, it means "all cameras" (no per-camera filter row inserted).
  const [camSel, setCamSel] = useState<Map<string, Set<string>>>(new Map());
  // Available cameras discovered from each Frigate instance
  const [camList, setCamList] = useState<Map<string, string[]>>(new Map());
  const [camLoading, setCamLoading] = useState<Set<string>>(new Set());
  const [openNvr, setOpenNvr] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!row) return;
    setLoading(true);
    void Promise.all([
      supabase.from("customer_nvr_assignments").select("instance_id").eq("user_id", row.user_id),
      supabase.from("customer_camera_assignments").select("instance_id, camera").eq("user_id", row.user_id),
    ]).then(([{ data: nvrRows }, { data: camRows }]) => {
      setAssigned(new Set((nvrRows ?? []).map((d) => d.instance_id)));
      const m = new Map<string, Set<string>>();
      for (const r of camRows ?? []) {
        if (!m.has(r.instance_id)) m.set(r.instance_id, new Set());
        m.get(r.instance_id)!.add(r.camera);
      }
      setCamSel(m);
      setLoading(false);
    });
  }, [row]);

  const fetchCams = async (instId: string) => {
    if (camList.has(instId) || camLoading.has(instId)) return;
    const inst = store.frigates.find((x) => x.id === instId);
    if (!inst) return;
    setCamLoading((s) => new Set(s).add(instId));
    try {
      const res = await fetch(frigateUrl(inst, "/api/stats"));
      const stats = await res.json();
      const cams = parseCameraNames(stats);
      setCamList((m) => new Map(m).set(instId, cams));
    } catch {
      setCamList((m) => new Map(m).set(instId, []));
    } finally {
      setCamLoading((s) => { const n = new Set(s); n.delete(instId); return n; });
    }
  };

  if (!row) return null;

  const toggleNvr = (id: string) => {
    setAssigned((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
        setCamSel((cm) => { const m = new Map(cm); m.delete(id); return m; });
      } else {
        n.add(id);
      }
      return n;
    });
  };

  const toggleNvrOpen = (id: string) => {
    setOpenNvr((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else { n.add(id); void fetchCams(id); }
      return n;
    });
  };

  const toggleCam = (instId: string, cam: string) => {
    setCamSel((prev) => {
      const m = new Map(prev);
      const cams = camList.get(instId) ?? [];
      const cur = new Set(m.get(instId) ?? cams); // if not yet filtered, treat as "all selected"
      if (cur.has(cam)) cur.delete(cam); else cur.add(cam);
      // If user re-selected everything we still keep an explicit set so save stores it as a filter.
      m.set(instId, cur);
      return m;
    });
  };

  const selectAllCams = (instId: string, all: boolean) => {
    setCamSel((prev) => {
      const m = new Map(prev);
      if (all) m.delete(instId); // "all" = no filter row inserted
      else m.set(instId, new Set());
      return m;
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      // ----- NVR assignments diff -----
      const { data: existingNvr } = await supabase
        .from("customer_nvr_assignments").select("instance_id").eq("user_id", row.user_id);
      const existingNvrSet = new Set((existingNvr ?? []).map((d) => d.instance_id));
      const nvrAdd = [...assigned].filter((id) => !existingNvrSet.has(id));
      const nvrRemove = [...existingNvrSet].filter((id) => !assigned.has(id));
      if (nvrAdd.length) {
        const { error } = await supabase.from("customer_nvr_assignments")
          .insert(nvrAdd.map((instance_id) => ({ user_id: row.user_id, instance_id })));
        if (error) throw error;
      }
      if (nvrRemove.length) {
        const { error } = await supabase.from("customer_nvr_assignments")
          .delete().eq("user_id", row.user_id).in("instance_id", nvrRemove);
        if (error) throw error;
      }

      // ----- Per-camera assignments diff -----
      // Desired = for every assigned NVR with an entry in camSel, those cameras.
      // If NVR has no entry in camSel ⇒ "all cameras" ⇒ delete any existing rows.
      const desired = new Map<string, Set<string>>();
      for (const id of assigned) {
        if (camSel.has(id)) desired.set(id, camSel.get(id)!);
      }

      const { data: existingCam } = await supabase
        .from("customer_camera_assignments").select("instance_id, camera").eq("user_id", row.user_id);
      const existingCamMap = new Map<string, Set<string>>();
      for (const r of existingCam ?? []) {
        if (!existingCamMap.has(r.instance_id)) existingCamMap.set(r.instance_id, new Set());
        existingCamMap.get(r.instance_id)!.add(r.camera);
      }

      // Instances to clear all per-camera rows for
      const clearInstances: string[] = [];
      for (const instId of existingCamMap.keys()) {
        if (!desired.has(instId) || !assigned.has(instId)) clearInstances.push(instId);
      }
      if (clearInstances.length) {
        const { error } = await supabase.from("customer_camera_assignments")
          .delete().eq("user_id", row.user_id).in("instance_id", clearInstances);
        if (error) throw error;
      }

      // Per remaining instance, diff cameras
      for (const [instId, wantSet] of desired.entries()) {
        const haveSet = existingCamMap.get(instId) ?? new Set<string>();
        const toAdd = [...wantSet].filter((c) => !haveSet.has(c));
        const toRemove = [...haveSet].filter((c) => !wantSet.has(c));
        if (toAdd.length) {
          const { error } = await supabase.from("customer_camera_assignments")
            .insert(toAdd.map((camera) => ({ user_id: row.user_id, instance_id: instId, camera })));
          if (error) throw error;
        }
        if (toRemove.length) {
          const { error } = await supabase.from("customer_camera_assignments")
            .delete().eq("user_id", row.user_id).eq("instance_id", instId).in("camera", toRemove);
          if (error) throw error;
        }
      }

      toast.success("Assignments updated");
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update assignments");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assign NVRs & Cameras — {row.username}</DialogTitle>
          <DialogDescription>
            Pick which NVRs the customer can access, then optionally restrict to specific cameras.
            Leave "All cameras" selected to grant the entire NVR.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {loading ? (
            <p className="text-xs text-muted-foreground"><Loader2 className="inline h-3 w-3 mr-1 animate-spin" /> Loading…</p>
          ) : store.frigates.length === 0 ? (
            <p className="text-xs text-muted-foreground">No NVRs configured.</p>
          ) : (
            store.frigates.map((f) => {
              const isAssigned = assigned.has(f.id);
              const cams = camList.get(f.id) ?? [];
              const sel = camSel.get(f.id);
              const allCamsSelected = !sel; // "no filter row" = all
              const isOpen = openNvr.has(f.id);
              const visibleCount = allCamsSelected ? cams.length : (sel?.size ?? 0);
              return (
                <div key={f.id} className="rounded-md border border-border bg-card/50">
                  <div className="flex items-center gap-3 p-3">
                    <input
                      type="checkbox"
                      checked={isAssigned}
                      onChange={() => toggleNvr(f.id)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ background: f.color }} />
                    <span className="text-sm font-medium flex-1 truncate">{f.name}</span>
                    {isAssigned && (
                      <Badge variant="secondary" className="text-[10px]">
                        {allCamsSelected ? "All cameras" : `${visibleCount} camera${visibleCount === 1 ? "" : "s"}`}
                      </Badge>
                    )}
                    <button
                      type="button"
                      disabled={!isAssigned}
                      onClick={() => toggleNvrOpen(f.id)}
                      className="p-1 rounded hover:bg-accent/50 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                    </button>
                  </div>

                  {isAssigned && isOpen && (
                    <div className="border-t border-border px-3 py-2 space-y-2">
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allCamsSelected}
                            onChange={(e) => selectAllCams(f.id, e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-border"
                          />
                          <span className="font-medium">Select all cameras on this NVR</span>
                        </label>
                        {camLoading.has(f.id) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                      </div>

                      {!allCamsSelected && (
                        cams.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground italic">
                            {camLoading.has(f.id) ? "Loading cameras…" : "No cameras detected on this NVR."}
                          </p>
                        ) : (
                          <div className="grid grid-cols-2 gap-1.5 pl-1">
                            {cams.map((cam) => {
                              const checked = sel?.has(cam) ?? false;
                              return (
                                <label key={cam} className="flex items-center gap-2 text-xs cursor-pointer rounded px-2 py-1 hover:bg-accent/40">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleCam(f.id, cam)}
                                    className="h-3.5 w-3.5 rounded border-border"
                                  />
                                  <span className="capitalize truncate">{cam}</span>
                                </label>
                              );
                            })}
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function parseCameraNames(stats: unknown): string[] {
  if (!stats || typeof stats !== "object") return [];
  const root = stats as Record<string, unknown>;
  const cameras = (root.cameras && typeof root.cameras === "object" ? root.cameras : root) as Record<string, unknown>;
  const reserved = new Set([
    "cpu_usages", "gpu_usages", "service", "detectors", "detection_fps",
    "processes", "bandwidth_usages", "version",
  ]);
  const out: string[] = [];
  for (const [name, val] of Object.entries(cameras)) {
    if (reserved.has(name)) continue;
    if (!val || typeof val !== "object") continue;
    const c = val as Record<string, any>;
    const hasShape = "camera_fps" in c || "process_fps" in c || "detection_fps" in c || "pid" in c;
    if (hasShape) out.push(name);
  }
  return out.sort();
}

function EditEmailDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (row) setEmail(row.contact_email ?? ""); }, [row]);
  if (!row) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-users/set-contact-email", {
      method: "POST",
      body: { user_id: row.user_id, contact_email: email },
    });
    setBusy(false);
    if (error || (data as { ok?: boolean })?.ok === false) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "Failed to update email");
      return;
    }
    toast.success("Contact email updated");
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contact email — {row.username}</DialogTitle>
          <DialogDescription>Email address used for callout-resolved notifications. Leave blank to remove.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Email address</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" autoFocus />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default Users;
