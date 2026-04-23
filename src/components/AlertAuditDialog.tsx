import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchAudit, logAudit, getActor, setActor, type AuditEntry } from "@/lib/auditLog";
import { supabase } from "@/integrations/supabase/client";
import { MessageSquare, User } from "lucide-react";
import { cn } from "@/lib/utils";

export function AlertAuditDialog({
  open,
  onOpenChange,
  alertKey,
  eventId,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  alertKey: string;
  eventId?: string | null;
  title: string;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [note, setNote] = useState("");
  const [actor, setActorState] = useState(getActor());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchAudit(alertKey).then((rows) => { if (!cancelled) setEntries(rows); });
    const ch = supabase
      .channel(`audit-${alertKey}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "event_audit_log", filter: `alert_key=eq.${alertKey}` },
        (p) => setEntries((prev) => [...prev, p.new as AuditEntry])
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [open, alertKey]);

  const submit = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      setActor(actor);
      await logAudit({ alert_key: alertKey, event_id: eventId, action: "comment", note: note.trim() });
      setNote("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="capitalize">{title}</DialogTitle>
          <DialogDescription>Audit trail and comments for this alert</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <ScrollArea className="h-64 rounded-md border border-border bg-secondary/20 p-3">
            {entries.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-8">No activity yet</div>
            ) : (
              <ol className="space-y-2.5">
                {entries.map((e) => (
                  <li key={e.id} className="flex gap-2.5 text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className={cn(
                          "text-[10px] capitalize px-1.5 py-0 h-4",
                          e.action === "comment" && "border-primary/40 text-primary",
                          e.action === "ack" && "border-success/40 text-success",
                          e.action === "dismiss" && "border-muted-foreground/40 text-muted-foreground",
                        )}>
                          {e.action}
                        </Badge>
                        <span className="text-muted-foreground inline-flex items-center gap-1">
                          <User className="h-3 w-3" /> {e.actor ?? "unknown"}
                        </span>
                        <span className="text-muted-foreground tabular-nums ml-auto">
                          {new Date(e.ts).toLocaleString()}
                        </span>
                      </div>
                      {e.note && (
                        <div className="mt-1 text-foreground whitespace-pre-wrap break-words">{e.note}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </ScrollArea>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Input
                value={actor}
                onChange={(e) => setActorState(e.target.value)}
                placeholder="Your name"
                className="h-8 text-xs"
              />
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a comment for the audit trail…"
              rows={3}
              className="text-sm"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={submit} disabled={busy || !note.trim()} className="gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" /> Add comment
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
