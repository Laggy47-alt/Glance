import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { frigateUrl } from "@/lib/webhookStore";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, Mail, Send, VideoOff, WifiOff, Server } from "lucide-react";

type NvrSnapshot = {
  id: string;
  name: string;
  reachable: boolean;
  offlineCameras: string[];
};

const POLL_MS = 30000;
const STORAGE_KEY = "offline-escalation-recipients";
const SUBJECT_KEY = "offline-escalation-subject";
const INTRO_KEY = "offline-escalation-intro";
const SIGNATURE_KEY = "offline-escalation-signature";
const INCLUDE_LIST_KEY = "offline-escalation-include-list";

const DEFAULT_SUBJECT = "[Escalation] Offline equipment detected";
const DEFAULT_INTRO = "The following equipment is currently offline and requires attention.";
const DEFAULT_SIGNATURE = "— Control Room";

function parseStats(stats: unknown): string[] {
  // returns offline camera names
  if (!stats || typeof stats !== "object") return [];
  const root = stats as Record<string, unknown>;
  const cameras = (root.cameras && typeof root.cameras === "object" ? root.cameras : root) as Record<string, unknown>;
  const reserved = new Set([
    "cpu_usages", "gpu_usages", "service", "detectors", "detection_fps",
    "processes", "bandwidth_usages", "version",
  ]);
  const offline: string[] = [];
  for (const [name, val] of Object.entries(cameras)) {
    if (reserved.has(name)) continue;
    if (!val || typeof val !== "object") continue;
    const c = val as Record<string, any>;
    const hasShape = "camera_fps" in c || "process_fps" in c || "detection_fps" in c || "pid" in c;
    if (!hasShape) continue;
    const fps = typeof c.camera_fps === "number" ? c.camera_fps : undefined;
    const pid = typeof c.pid === "number" ? c.pid : undefined;
    const online = (pid === undefined || pid > 0) && (fps === undefined || fps > 0);
    if (!online) offline.push(name);
  }
  return offline.sort();
}

export function OfflineNotifications() {
  const store = useWebhookStore();
  const { user } = useAuth();
  const [snapshots, setSnapshots] = useState<NvrSnapshot[]>([]);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [recipients, setRecipients] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? ""; } catch { return ""; }
  });
  const [subject, setSubject] = useState<string>(() => {
    try { return localStorage.getItem(SUBJECT_KEY) ?? DEFAULT_SUBJECT; } catch { return DEFAULT_SUBJECT; }
  });
  const [intro, setIntro] = useState<string>(() => {
    try { return localStorage.getItem(INTRO_KEY) ?? DEFAULT_INTRO; } catch { return DEFAULT_INTRO; }
  });
  const [signature, setSignature] = useState<string>(() => {
    try { return localStorage.getItem(SIGNATURE_KEY) ?? DEFAULT_SIGNATURE; } catch { return DEFAULT_SIGNATURE; }
  });
  const [includeList, setIncludeList] = useState<boolean>(() => {
    try { return (localStorage.getItem(INCLUDE_LIST_KEY) ?? "1") === "1"; } catch { return true; }
  });
  const [showCustomize, setShowCustomize] = useState(false);
  const [note, setNote] = useState("");
  const seenRef = useRef<Map<string, Set<string>>>(new Map()); // instance_id -> set of "offline:cam" or "unreachable"
  const firstRunRef = useRef(true);

  const fetchAll = useCallback(async () => {
    const enabled = store.frigates.filter((f) => f.enabled);
    const results = await Promise.all(enabled.map(async (f): Promise<NvrSnapshot> => {
      try {
        const res = await fetch(frigateUrl(f, "/api/stats"));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return { id: f.id, name: f.name, reachable: true, offlineCameras: parseStats(json) };
      } catch {
        return { id: f.id, name: f.name, reachable: false, offlineCameras: [] };
      }
    }));
    setSnapshots(results);

    // Diff against seen state to surface only NEW offline events
    const newAlerts: string[] = [];
    for (const r of results) {
      const prev = seenRef.current.get(r.id) ?? new Set<string>();
      const next = new Set<string>();
      if (!r.reachable) next.add("__unreachable__");
      for (const c of r.offlineCameras) next.add(c);

      if (!firstRunRef.current) {
        if (next.has("__unreachable__") && !prev.has("__unreachable__")) {
          newAlerts.push(`${r.name} is unreachable`);
        }
        for (const c of next) {
          if (c !== "__unreachable__" && !prev.has(c)) {
            newAlerts.push(`${r.name} · ${c} went offline`);
          }
        }
      }
      seenRef.current.set(r.id, next);
    }

    if (firstRunRef.current) {
      firstRunRef.current = false;
      // Show a one-time summary toast on first load if anything is offline
      const totalOffline = results.reduce((a, r) => a + r.offlineCameras.length, 0);
      const totalUnreach = results.filter((r) => !r.reachable).length;
      if (totalOffline + totalUnreach > 0) {
        toast({
          title: "Offline equipment detected",
          description: `${totalUnreach} NVR${totalUnreach === 1 ? "" : "s"} unreachable · ${totalOffline} camera${totalOffline === 1 ? "" : "s"} offline`,
          variant: "destructive",
        });
      }
    } else if (newAlerts.length) {
      toast({
        title: newAlerts.length === 1 ? "Offline alert" : `${newAlerts.length} new offline alerts`,
        description: newAlerts.slice(0, 4).join("\n") + (newAlerts.length > 4 ? `\n…and ${newAlerts.length - 4} more` : ""),
        variant: "destructive",
      });
    }
  }, [store.frigates]);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, POLL_MS);
    return () => clearInterval(t);
  }, [fetchAll]);

  const totalOffline = useMemo(() => snapshots.reduce((a, s) => a + s.offlineCameras.length, 0), [snapshots]);
  const totalUnreachable = useMemo(() => snapshots.filter((s) => !s.reachable).length, [snapshots]);
  const hasIssue = totalOffline + totalUnreachable > 0;

  const handleEscalate = async () => {
    const list = recipients.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
    if (!list.length) {
      toast({ title: "Add at least one recipient email", variant: "destructive" });
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, recipients);
      localStorage.setItem(SUBJECT_KEY, subject);
      localStorage.setItem(INTRO_KEY, intro);
      localStorage.setItem(SIGNATURE_KEY, signature);
      localStorage.setItem(INCLUDE_LIST_KEY, includeList ? "1" : "0");
    } catch { /* ignore */ }
    setSending(true);
    try {
      const composedNote = [intro, note, signature].filter((s) => s && s.trim().length).join("\n\n");
      const { data, error } = await supabase.functions.invoke("escalate-offline", {
        body: {
          recipients: list,
          subject: subject?.trim() || DEFAULT_SUBJECT,
          note: composedNote,
          nvrs: includeList
            ? snapshots.map((s) => ({ name: s.name, reachable: s.reachable, offlineCameras: s.offlineCameras }))
            : [],
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Escalation sent", description: `Emailed ${list.length} recipient${list.length === 1 ? "" : "s"}` });
      setOpen(false);
      setNote("");
    } catch (e: any) {
      toast({ title: "Failed to send escalation", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  if (!user) return null;

  return (
    <>
      <Button
        variant={hasIssue ? "destructive" : "outline"}
        size="sm"
        className="gap-2 relative"
        onClick={() => setOpen(true)}
        title="Offline equipment"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">
          {hasIssue ? `${totalUnreachable + totalOffline} offline` : "All online"}
        </span>
        {hasIssue && (
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-background pulse-dot" />
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Offline equipment
            </DialogTitle>
            <DialogDescription>
              {hasIssue
                ? `${totalUnreachable} NVR${totalUnreachable === 1 ? "" : "s"} unreachable · ${totalOffline} camera${totalOffline === 1 ? "" : "s"} offline.`
                : "All NVRs reachable and all cameras online."}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[40vh] overflow-y-auto space-y-2 pr-1">
            {snapshots.length === 0 ? (
              <p className="text-xs text-muted-foreground">No NVRs configured.</p>
            ) : (
              snapshots.map((s) => {
                const ok = s.reachable && s.offlineCameras.length === 0;
                return (
                  <div key={s.id} className="rounded-md border border-border bg-card/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium text-foreground truncate">{s.name}</span>
                      </div>
                      {!s.reachable ? (
                        <Badge variant="destructive" className="gap-1 text-[10px]"><WifiOff className="h-3 w-3" /> Unreachable</Badge>
                      ) : s.offlineCameras.length > 0 ? (
                        <Badge variant="destructive" className="gap-1 text-[10px]"><VideoOff className="h-3 w-3" /> {s.offlineCameras.length} offline</Badge>
                      ) : (
                        <Badge className="bg-success/15 text-success border border-success/30 text-[10px]">All online</Badge>
                      )}
                    </div>
                    {!ok && s.offlineCameras.length > 0 && (
                      <ul className="mt-2 ml-5 list-disc text-xs text-muted-foreground space-y-0.5">
                        {s.offlineCameras.map((c) => (
                          <li key={c} className="capitalize">{c}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {hasIssue && (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold text-foreground">Escalate via email</h4>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Recipient emails (comma-separated)</label>
                <Input
                  placeholder="ops@example.com, manager@example.com"
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Note (optional)</label>
                <Textarea
                  placeholder="Add context for the escalation…"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">Uses SMTP settings configured in Daily Reports.</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>Close</Button>
            {hasIssue && (
              <Button onClick={handleEscalate} disabled={sending} className="gap-2">
                <Send className="h-3.5 w-3.5" />
                {sending ? "Sending…" : "Send escalation"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
