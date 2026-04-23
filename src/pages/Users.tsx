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
import { Loader2, Plus, KeyRound, Trash2, ShieldCheck, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

type Row = {
  user_id: string;
  username: string;
  display_name: string | null;
  must_change_password: boolean;
  role: "admin" | "user";
};

const Users = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [resetFor, setResetFor] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: profs }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("user_id, username, display_name, must_change_password").order("username"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    const roleMap = new Map<string, "admin" | "user">();
    (roles ?? []).forEach((r) => {
      const existing = roleMap.get(r.user_id);
      if (r.role === "admin" || !existing) roleMap.set(r.user_id, r.role as "admin" | "user");
    });
    const merged: Row[] = (profs ?? []).map((p) => ({
      user_id: p.user_id,
      username: p.username,
      display_name: p.display_name,
      must_change_password: p.must_change_password,
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
      subtitle="Manage operator accounts"
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
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…
              </TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No users</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.user_id}>
                <TableCell className="font-medium">{r.username}</TableCell>
                <TableCell>{r.display_name ?? "—"}</TableCell>
                <TableCell>
                  {r.role === "admin" ? (
                    <Badge className="gap-1"><ShieldCheck className="h-3 w-3" /> Admin</Badge>
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

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      <ResetPasswordDialog row={resetFor} onClose={() => setResetFor(null)} onDone={load} />
    </DashboardLayout>
  );
};

function CreateUserDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("changeme");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-users/create", {
      method: "POST",
      body: { username, password, display_name: displayName || username, role },
    });
    setBusy(false);
    if (error || (data as { ok?: boolean })?.ok === false) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "Failed to create user");
      return;
    }
    toast.success(`User "${username}" created. They must change their password on first login.`);
    setUsername(""); setDisplayName(""); setPassword("changeme"); setRole("user");
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
            <Label className="text-xs">Default password</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Role</Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={role === "user" ? "default" : "outline"} onClick={() => setRole("user")}>User</Button>
              <Button type="button" size="sm" variant={role === "admin" ? "default" : "outline"} onClick={() => setRole("admin")}>Admin</Button>
            </div>
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

export default Users;
