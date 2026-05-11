import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Send, LifeBuoy } from "lucide-react";

type Row = {
  id: string;
  subject: string;
  message: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
  resolved_at: string | null;
  requester_name: string | null;
};

export default function RequestSupportCallout() {
  const { user, profile, activeOrg } = useAuth();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("super_callout_requests")
      .select("id, subject, message, status, admin_note, created_at, resolved_at, requester_name")
      .order("created_at", { ascending: false })
      .limit(100);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("org-super-callouts")
      .on("postgres_changes", { event: "*", schema: "public", table: "super_callout_requests" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) { toast.error("Subject required"); return; }
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("super_callout_requests").insert({
      subject: subject.trim(),
      message: message.trim() || null,
      requested_by: user.id,
      requester_name: profile?.display_name ?? profile?.username ?? null,
      organization_id: activeOrg?.id,
    });
    if (error) { setBusy(false); toast.error(error.message); return; }

    // Notify platform support by email (non-blocking on failure).
    const { error: mailErr } = await supabase.functions.invoke("super-callout-email", {
      body: {
        subject: subject.trim(),
        message: message.trim(),
        requester_name: profile?.display_name ?? profile?.username ?? null,
        organization_name: activeOrg?.name ?? null,
        reply_to: user.email ?? null,
      },
    });
    setBusy(false);
    if (mailErr) toast.warning("Request saved, but email notification failed");
    else toast.success("Request sent to platform support");
    setSubject(""); setMessage("");
  };

  return (
    <DashboardLayout title="Request Callout (Admin)" subtitle="Send a support request to the platform team">
      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <LifeBuoy className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">New request</h2>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="subject" className="text-xs">Subject</Label>
              <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="message" className="text-xs">Details</Label>
              <Textarea id="message" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe the issue or request…" />
            </div>
            <Button type="submit" disabled={busy} className="w-full gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send request
            </Button>
          </form>
        </Card>

        <Card>
          <div className="px-4 py-3 border-b border-border text-sm font-semibold">Your requests</div>
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Reply</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No requests yet.</TableCell></TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Badge variant={r.status === "resolved" ? "secondary" : "default"}>{r.status}</Badge></TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{r.subject}</div>
                      {r.message && <div className="text-xs text-muted-foreground line-clamp-2 max-w-md">{r.message}</div>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[260px]">{r.admin_note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}
