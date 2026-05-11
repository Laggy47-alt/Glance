import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Copy, Power, PowerOff, Ticket, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Org = { id: string; name: string; slug: string };
type SubRow = {
  organization_id: string;
  status: "grandfathered" | "trial" | "active" | "past_due" | "suspended";
  trial_nvr_limit: number;
  trial_email_limit: number;
  trial_emails_sent: number;
  current_period_end: string | null;
  paddle_subscription_id: string | null;
};
type Code = {
  id: string;
  code: string;
  duration_days: number;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
};

const randomCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const seg = (n: number) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${seg(4)}-${seg(4)}-${seg(4)}`;
};

export function SubscriptionAdminPanel({ orgs }: { orgs: Org[] }) {
  const [subs, setSubs] = useState<Record<string, SubRow>>({});
  const [codes, setCodes] = useState<Code[]>([]);
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState("30");
  const [maxUses, setMaxUses] = useState("1");
  const [notes, setNotes] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: s }, { data: c }] = await Promise.all([
      supabase.from("org_subscriptions").select("*"),
      supabase.from("redemption_codes").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    const map: Record<string, SubRow> = {};
    for (const row of (s ?? []) as SubRow[]) map[row.organization_id] = row;
    setSubs(map);
    setCodes((c ?? []) as Code[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const setStatus = async (orgId: string, status: SubRow["status"]) => {
    const existing = subs[orgId];
    if (existing) {
      const { error } = await supabase.from("org_subscriptions")
        .update({ status }).eq("organization_id", orgId);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("org_subscriptions")
        .insert({ organization_id: orgId, status });
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`Status set to ${status}`);
    await load();
  };

  const generateCode = async () => {
    setGenerating(true);
    try {
      const code = randomCode();
      const { error } = await supabase.from("redemption_codes").insert({
        code,
        duration_days: parseInt(duration) || 30,
        max_uses: parseInt(maxUses) || 1,
        notes: notes.trim() || null,
      });
      if (error) throw error;
      toast.success("Code generated");
      setNotes("");
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setGenerating(false); }
  };

  const copyCode = (c: string) => { navigator.clipboard.writeText(c); toast.success("Copied"); };

  const deleteCode = async (id: string) => {
    const { error } = await supabase.from("redemption_codes").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  const statusBadge = (s?: SubRow) => {
    if (!s) return <Badge variant="outline">none</Badge>;
    const cls: Record<string, string> = {
      grandfathered: "bg-success/20 text-success border-success/40",
      trial: "bg-warning/20 text-warning border-warning/40",
      active: "bg-success/20 text-success border-success/40",
      past_due: "bg-orange-500/20 text-orange-500 border-orange-500/40",
      suspended: "bg-destructive/20 text-destructive border-destructive/40",
    };
    return <Badge className={cls[s.status] || ""}>{s.status}</Badge>;
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground p-4 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Ticket className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Generate license code</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Duration (days)</Label>
            <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Max uses</Label>
            <Input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="For Acme Corp" />
          </div>
        </div>
        <Button onClick={generateCode} disabled={generating}>
          {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
          Generate code
        </Button>

        <div className="rounded border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Uses</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-4">No codes yet</TableCell></TableRow>
              ) : codes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.code}</TableCell>
                  <TableCell>{c.duration_days}</TableCell>
                  <TableCell>{c.uses}/{c.max_uses}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.notes ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => copyCode(c.code)}><Copy className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteCode(c.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">Organization subscriptions</h3>
        <div className="rounded border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Period ends</TableHead>
                <TableHead>Trial usage</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((o) => {
                const s = subs[o.id];
                return (
                  <TableRow key={o.id}>
                    <TableCell>
                      <div className="font-medium text-sm">{o.name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{o.slug}</div>
                    </TableCell>
                    <TableCell>{statusBadge(s)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s?.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {s?.status === "trial" ? `${s.trial_emails_sent}/${s.trial_email_limit} emails` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5 items-center">
                        <Select value={s?.status ?? ""} onValueChange={(v) => setStatus(o.id, v as SubRow["status"])}>
                          <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="Set status" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="grandfathered">Grandfathered</SelectItem>
                            <SelectItem value="trial">Trial</SelectItem>
                            <SelectItem value="active">Active (Paid)</SelectItem>
                            <SelectItem value="suspended">Suspended</SelectItem>
                          </SelectContent>
                        </Select>
                        {s?.status === "suspended" ? (
                          <Button size="sm" variant="outline" onClick={() => setStatus(o.id, "active")} title="Activate">
                            <Power className="h-3.5 w-3.5 text-success" />
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setStatus(o.id, "suspended")} title="Suspend">
                            <PowerOff className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
