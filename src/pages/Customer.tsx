import { useEffect, useMemo, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { supabase } from "@/integrations/supabase/client";
import { frigateUrl, type FrigateInstance } from "@/lib/webhookStore";
import { toast } from "@/hooks/use-toast";
import { Phone, Server, ShieldAlert, ShieldCheck, VideoOff, Loader2, AlertTriangle, WifiOff, ImageOff } from "lucide-react";

function CameraThumb({ inst, camera, online }: { inst: FrigateInstance; camera: string; online: boolean }) {
  const safe = camera.replace(/[^a-zA-Z0-9_-]/g, "_");
  const { data } = supabase.storage.from("camera-snapshots").getPublicUrl(`${inst.id}/${safe}.jpg`);
  const stored = data?.publicUrl;
  const live = online ? frigateUrl(inst, `/api/${encodeURIComponent(camera)}/latest.jpg?h=120`) : null;
  const [src, setSrc] = useState<string | null>(live ?? stored ?? null);
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div className="h-12 w-20 shrink-0 rounded bg-muted border border-border flex items-center justify-center">
        <ImageOff className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={camera}
      loading="lazy"
      className="h-12 w-20 shrink-0 rounded object-cover border border-border bg-muted"
      onError={() => {
        if (live && src === live && stored) { setSrc(stored); }
        else { setErrored(true); }
      }}
    />
  );
}

type CamRow = {
  name: string;
  online: boolean;
  armed: boolean;
};

type NvrView = {
  inst: FrigateInstance;
  reachable: boolean;
  cameras: CamRow[];
};

const POLL_MS = 30000;

function parseStats(stats: unknown): { online: string[]; offline: string[] } {
  if (!stats || typeof stats !== "object") return { online: [], offline: [] };
  const root = stats as Record<string, unknown>;
  const cameras = (root.cameras && typeof root.cameras === "object" ? root.cameras : root) as Record<string, unknown>;
  const reserved = new Set([
    "cpu_usages", "gpu_usages", "service", "detectors", "detection_fps",
    "processes", "bandwidth_usages", "version",
  ]);
  const online: string[] = [];
  const offline: string[] = [];
  for (const [name, val] of Object.entries(cameras)) {
    if (reserved.has(name)) continue;
    if (!val || typeof val !== "object") continue;
    const c = val as Record<string, any>;
    const hasShape = "camera_fps" in c || "process_fps" in c || "detection_fps" in c || "pid" in c;
    if (!hasShape) continue;
    const fps = typeof c.camera_fps === "number" ? c.camera_fps : undefined;
    const pid = typeof c.pid === "number" ? c.pid : undefined;
    const isOn = (pid === undefined || pid > 0) && (fps === undefined || fps > 0);
    (isOn ? online : offline).push(name);
  }
  return { online: online.sort(), offline: offline.sort() };
}

const Customer = () => {
  const { user, profile } = useAuth();
  const store = useWebhookStore();
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [armedMap, setArmedMap] = useState<Map<string, boolean>>(new Map()); // key = `${instance_id}::${camera}`
  const [views, setViews] = useState<NvrView[]>([]);
  const [loading, setLoading] = useState(true);
  const [calloutFor, setCalloutFor] = useState<{ inst: FrigateInstance; cameras: string[] } | null>(null);
  const [recentCallouts, setRecentCallouts] = useState<any[]>([]);

  const armedKey = (instId: string, cam: string) => `${instId}::${cam}`;

  // Load assignments
  useEffect(() => {
    if (!user) return;
    void supabase
      .from("customer_nvr_assignments")
      .select("instance_id")
      .eq("user_id", user.id)
      .then(({ data }) => {
        setAssignedIds((data ?? []).map((d) => d.instance_id));
      });
  }, [user]);

  // Load armed states
  const loadArmed = useCallback(async () => {
    if (assignedIds.length === 0) return;
    const { data } = await supabase
      .from("camera_armed_state")
      .select("instance_id, camera, armed")
      .in("instance_id", assignedIds);
    const map = new Map<string, boolean>();
    (data ?? []).forEach((r) => map.set(armedKey(r.instance_id, r.camera), r.armed));
    setArmedMap(map);
  }, [assignedIds]);

  useEffect(() => { void loadArmed(); }, [loadArmed]);

  // Subscribe to armed state realtime
  useEffect(() => {
    if (assignedIds.length === 0) return;
    const ch = supabase
      .channel("customer-armed")
      .on("postgres_changes", { event: "*", schema: "public", table: "camera_armed_state" }, () => {
        void loadArmed();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [assignedIds, loadArmed]);


  // Load callouts (own)
  const loadCallouts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("callout_requests")
      .select("*")
      .eq("requested_by", user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    setRecentCallouts(data ?? []);
  }, [user]);
  useEffect(() => { void loadCallouts(); }, [loadCallouts]);

  // Poll Frigate stats for assigned NVRs
  const myInstances = useMemo(
    () => store.frigates.filter((f) => assignedIds.includes(f.id)),
    [store.frigates, assignedIds]
  );

  const fetchAll = useCallback(async () => {
    if (myInstances.length === 0) {
      setViews([]);
      setLoading(false);
      return;
    }
    const results = await Promise.all(myInstances.map(async (inst): Promise<NvrView> => {
      try {
        const res = await fetch(frigateUrl(inst, "/api/stats"));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const stats = await res.json();
        const { online, offline } = parseStats(stats);
        const cameras: CamRow[] = [
          ...online.map((n) => ({ name: n, online: true, armed: armedMap.get(armedKey(inst.id, n)) ?? true })),
          ...offline.map((n) => ({ name: n, online: false, armed: armedMap.get(armedKey(inst.id, n)) ?? true })),
        ].sort((a, b) => a.name.localeCompare(b.name));
        return { inst, reachable: true, cameras };
      } catch {
        return { inst, reachable: false, cameras: [] };
      }
    }));
    setViews(results);
    setLoading(false);
  }, [myInstances, armedMap]);

  useEffect(() => {
    void fetchAll();
    const t = setInterval(() => { void fetchAll(); }, POLL_MS);
    return () => clearInterval(t);
  }, [fetchAll]);

  const toggleArmed = async (instId: string, camera: string, armed: boolean) => {
    const key = armedKey(instId, camera);
    setArmedMap((prev) => new Map(prev).set(key, armed));
    const { error } = await supabase
      .from("camera_armed_state")
      .upsert(
        { instance_id: instId, camera, armed, updated_by: user?.id ?? null },
        { onConflict: "instance_id,camera" }
      );
    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
      void loadArmed();
    } else {
      toast({ title: armed ? "Camera armed" : "Camera disarmed", description: camera });
    }
  };

  const setAllArmed = async (view: NvrView, armed: boolean) => {
    if (view.cameras.length === 0) return;
    const rows = view.cameras.map((c) => ({
      instance_id: view.inst.id, camera: c.name, armed, updated_by: user?.id ?? null,
    }));
    setArmedMap((prev) => {
      const next = new Map(prev);
      rows.forEach((r) => next.set(armedKey(r.instance_id, r.camera), armed));
      return next;
    });
    const { error } = await supabase
      .from("camera_armed_state")
      .upsert(rows, { onConflict: "instance_id,camera" });
    if (error) {
      toast({ title: "Bulk update failed", description: error.message, variant: "destructive" });
      void loadArmed();
    } else {
      toast({ title: armed ? "All cameras armed" : "All cameras disarmed", description: view.inst.name });
    }
  };

  const offlineCount = views.reduce((a, v) => a + v.cameras.filter((c) => !c.online).length, 0);
  const unreachableCount = views.filter((v) => !v.reachable).length;

  return (
    <DashboardLayout
      title={`Welcome${profile?.display_name ? `, ${profile.display_name}` : ""}`}
      subtitle="Manage your cameras and request a callout"
    >
      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading your NVRs…
        </div>
      ) : myInstances.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Server className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No NVRs assigned</h3>
          <p className="text-xs text-muted-foreground mt-1">Contact your administrator to get access.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {(unreachableCount > 0 || offlineCount > 0) && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-destructive">Equipment needs attention</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {unreachableCount > 0 && <>{unreachableCount} NVR{unreachableCount === 1 ? "" : "s"} unreachable. </>}
                  {offlineCount > 0 && <>{offlineCount} camera{offlineCount === 1 ? "" : "s"} offline.</>}
                </p>
              </div>
            </div>
          )}

          {views.map((v) => (
            <div key={v.inst.id} className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 bg-card/60">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ background: v.inst.color }} />
                  <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-semibold text-foreground truncate">{v.inst.name}</span>
                  {!v.reachable && <Badge variant="destructive" className="gap-1 text-[10px]"><WifiOff className="h-3 w-3" /> Unreachable</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  {v.reachable && v.cameras.length > 0 && (() => {
                    const allArmed = v.cameras.every((c) => c.armed);
                    return (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => setAllArmed(v, !allArmed)}
                      >
                        {allArmed
                          ? <><ShieldAlert className="h-3.5 w-3.5" /> Disarm all</>
                          : <><ShieldCheck className="h-3.5 w-3.5" /> Arm all</>}
                      </Button>
                    );
                  })()}
                  {(() => {
                    const offlineCams = v.reachable
                      ? v.cameras.filter((c) => !c.online).map((c) => c.name)
                      : [];
                    const hasOffline = offlineCams.length > 0 || !v.reachable;
                    return (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={!hasOffline}
                        title={hasOffline ? undefined : "All cameras are online"}
                        onClick={() => setCalloutFor({ inst: v.inst, cameras: offlineCams })}
                      >
                        <Phone className="h-3.5 w-3.5" /> Request callout
                      </Button>
                    );
                  })()}
                </div>
              </div>

              {v.reachable ? (
                v.cameras.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-muted-foreground text-center">No cameras reported.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {v.cameras.map((c) => (
                      <li key={c.name} className="px-4 py-3 flex items-center gap-3">
                        <CameraThumb inst={v.inst} camera={c.name} online={c.online} />
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground capitalize truncate">{c.name}</span>
                          {c.online ? (
                            <Badge className="bg-success/15 text-success border border-success/30 text-[10px]">Online</Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1 text-[10px]"><VideoOff className="h-3 w-3" /> Offline</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 min-w-[110px] justify-end">
                          {c.armed ? (
                            <ShieldCheck className="h-4 w-4 text-success" />
                          ) : (
                            <ShieldAlert className="h-4 w-4 text-amber-500" />
                          )}
                          <span className="text-xs text-muted-foreground w-14">{c.armed ? "Armed" : "Disarmed"}</span>
                          <Switch
                            checked={c.armed}
                            onCheckedChange={(val) => toggleArmed(v.inst.id, c.name, val)}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-muted-foreground mb-3">We can't reach this NVR right now.</p>
                  <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => setCalloutFor({ inst: v.inst, cameras: [] })}>
                    <Phone className="h-3.5 w-3.5" /> Request callout
                  </Button>
                </div>
              )}
            </div>
          ))}


          {recentCallouts.length > 0 && (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-card/60">
                <h3 className="text-sm font-semibold text-foreground">Your recent callout requests</h3>
              </div>
              <ul className="divide-y divide-border">
                {recentCallouts.map((c) => {
                  const inst = store.frigates.find((f) => f.id === c.instance_id);
                  return (
                    <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {inst?.name ?? "Unknown NVR"}
                          {c.camera && <span className="text-muted-foreground"> · {c.camera}</span>}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {new Date(c.created_at).toLocaleString()} {c.reason ? `· ${c.reason}` : ""}
                        </div>
                      </div>
                      <Badge variant={c.status === "resolved" ? "secondary" : "outline"} className="text-[10px] capitalize">
                        {c.status}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      <CalloutDialog
        target={calloutFor}
        onClose={() => setCalloutFor(null)}
        onSent={() => { void loadCallouts(); }}
        requesterName={profile?.display_name ?? profile?.username ?? "Customer"}
      />
    </DashboardLayout>
  );
};

function CalloutDialog({
  target, onClose, onSent, requesterName,
}: {
  target: { inst: FrigateInstance; cameras: string[] } | null;
  onClose: () => void;
  onSent: () => void;
  requesterName: string;
}) {
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState("");
  const [acceptedFee, setAcceptedFee] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) { setReason(""); setPhone(""); setAcceptedFee(false); }
  }, [target]);

  if (!target) return null;

  const camerasCsv = target.cameras.length > 0 ? target.cameras.join(", ") : null;

  const submit = async () => {
    if (!user) return;
    setBusy(true);
    const fullReason = phone ? `${reason || ""}${reason ? "\n\n" : ""}Contact: ${phone}` : reason;
    try {
      const { data: inserted, error } = await supabase
        .from("callout_requests")
        .insert({
          instance_id: target.inst.id,
          camera: camerasCsv,
          reason: fullReason,
          requested_by: user.id,
          requester_name: requesterName,
        })
        .select("id")
        .single();
      if (error) throw error;

      // Fire-and-monitor email notification
      const { error: fnErr } = await supabase.functions.invoke("callout-request", {
        body: {
          callout_id: inserted.id,
          nvr_name: target.inst.name,
          camera: camerasCsv,
          reason: fullReason,
          requester_name: requesterName,
        },
      });
      if (fnErr) {
        toast({
          title: "Callout submitted",
          description: "Saved, but email notification failed: " + fnErr.message,
        });
      } else {
        toast({ title: "Callout request sent", description: "Our team has been notified." });
      }
      onSent();
      onClose();
    } catch (e: any) {
      toast({ title: "Failed to submit callout", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Phone className="h-4 w-4 text-primary" /> Request callout</DialogTitle>
          <DialogDescription>
            {target.inst.name}{camerasCsv ? ` · ${target.cameras.length} offline camera${target.cameras.length === 1 ? "" : "s"}` : ""}. Our team will contact you.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {camerasCsv && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Affected camera{target.cameras.length === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-foreground break-words">{camerasCsv}</div>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">What's wrong? (optional)</label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Camera at front gate is offline since this morning."
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Best contact number (optional)</label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 …"
            />
          </div>
          <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedFee}
              onChange={(e) => setAcceptedFee(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-xs text-foreground">I accept a call out fee of R645</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !acceptedFee} className="gap-2">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default Customer;
