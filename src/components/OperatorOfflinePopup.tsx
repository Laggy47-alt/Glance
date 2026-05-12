import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { frigateUrl, type FrigateInstance } from "@/lib/webhookStore";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, MessageSquareWarning, Server, VideoOff, WifiOff } from "lucide-react";

type OfflineEvent = {
  key: string;            // unique per (instance, camera, since)
  inst: FrigateInstance;
  camera: string | null;  // null => NVR unreachable
  since: string;          // ISO ts
  instructions: string;
};

const POLL_MS = 30000;
// How long a camera must be continuously online before we'll allow a new
// offline popup for it. This debounces flapping cameras that reconnect &
// disconnect in short bursts, so the operator only sees one popup per real
// outage event.
const RESTORE_STABLE_MS = 5 * 60 * 1000;

function parseStats(stats: unknown): string[] {
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

export function OperatorOfflinePopup() {
  const { user, isCustomer, activeOrg } = useAuth();
  const store = useWebhookStore();
  const [queue, setQueue] = useState<OfflineEvent[]>([]);
  // Acked keys are scoped to (instance, camera) only — NOT to a specific outage
  // timestamp. We clear an ack only after the camera has been continuously
  // online for RESTORE_STABLE_MS, so brief reconnect/disconnect flaps don't
  // re-trigger popups.
  const ackedRef = useRef<Set<string>>(new Set());
  // Tracks when each camera was first observed online again after being acked,
  // so we know when to clear the ack. Key: `${inst}::${cam}` -> timestamp ms.
  const onlineSinceRef = useRef<Map<string, number>>(new Map());
  const stateRef = useRef<Map<string, { unreachable: boolean; offline: Set<string>; sinceMap: Map<string, string> }>>(new Map());
  const initRef = useRef(true);
  // NVR-wide notes carry the customer's camera scope so they only fire for THEIR cameras
  // on a multi-tenant NVR. cams === null means the customer has the whole NVR.
  type NvrNote = { text: string; cams: Set<string> | null };
  const instructionsRef = useRef<{
    perCam: Map<string, string[]>;   // `${inst}::${cam}` -> direct override notes
    perNvr: Map<string, NvrNote[]>;  // `${inst}` -> scoped site-wide notes
  }>({ perCam: new Map(), perNvr: new Map() });

  const enabled = !!user && !isCustomer;

  const loadInstructions = useCallback(async () => {
    if (!enabled || !activeOrg?.id) return;
    const [instrRes, nvrAssignRes, camAssignRes] = await Promise.all([
      supabase.from("customer_offline_instructions").select("user_id, instance_id, camera, instructions").eq("organization_id", activeOrg.id),
      supabase.from("customer_nvr_assignments").select("user_id, instance_id").eq("organization_id", activeOrg.id),
      supabase.from("customer_camera_assignments").select("user_id, instance_id, camera").eq("organization_id", activeOrg.id),
    ]);

    // Build per-user camera scope per instance.
    // If user is on the NVR but has NO camera assignments → entire NVR (cams=null wildcard).
    // If user has camera assignments → only those cameras.
    const userScope = new Map<string, Set<string> | null>(); // `${user}::${inst}` -> cams or null
    for (const a of nvrAssignRes.data ?? []) {
      userScope.set(`${a.user_id}::${a.instance_id}`, null);
    }
    for (const a of camAssignRes.data ?? []) {
      const k = `${a.user_id}::${a.instance_id}`;
      const existing = userScope.get(k);
      const set = existing instanceof Set ? existing : new Set<string>();
      set.add(a.camera);
      userScope.set(k, set);
    }

    const perCam = new Map<string, string[]>();
    const perNvr = new Map<string, NvrNote[]>();
    for (const r of instrRes.data ?? []) {
      if (!r.instructions || !r.instructions.trim()) continue;
      if (r.camera) {
        const k = `${r.instance_id}::${r.camera}`;
        const arr = perCam.get(k) ?? [];
        arr.push(r.instructions);
        perCam.set(k, arr);
      } else {
        // Scope this site-wide note to the customer's own cameras on the NVR
        const scope = userScope.get(`${r.user_id}::${r.instance_id}`);
        // If there's no assignment record at all, skip — note doesn't apply to anything.
        if (scope === undefined) continue;
        const arr = perNvr.get(r.instance_id) ?? [];
        arr.push({ text: r.instructions, cams: scope });
        perNvr.set(r.instance_id, arr);
      }
    }
    instructionsRef.current = { perCam, perNvr };
  }, [enabled, activeOrg?.id]);

  // Load existing acks for this user so popups don't re-trigger across reloads
  const loadAcks = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("offline_instruction_acks")
      .select("instance_id, camera, since")
      .eq("user_id", user.id);
    for (const r of data ?? []) {
      // Collapse to (instance, camera) — once acked we won't re-popup until
      // the camera has been continuously online for RESTORE_STABLE_MS.
      ackedRef.current.add(`${r.instance_id}::${r.camera}`);
    }
  }, [user]);

  useEffect(() => {
    if (!enabled) return;
    void loadAcks();
    void loadInstructions();
    const ch = supabase
      .channel("offline-instructions-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_offline_instructions" }, () => {
        void loadInstructions();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, loadAcks, loadInstructions]);

  const pickInstruction = (instId: string, camera: string | null): string | null => {
    const notes: string[] = [];
    if (camera) {
      // Direct per-camera overrides for this camera
      for (const t of instructionsRef.current.perCam.get(`${instId}::${camera}`) ?? []) {
        if (t.trim()) notes.push(t);
      }
      // Site-wide notes only if THIS camera is in the customer's scope
      for (const n of instructionsRef.current.perNvr.get(instId) ?? []) {
        if (!n.text.trim()) continue;
        if (n.cams === null || n.cams.has(camera)) notes.push(n.text);
      }
    } else {
      // Whole NVR unreachable → every customer with a site-wide note is affected
      for (const n of instructionsRef.current.perNvr.get(instId) ?? []) {
        if (n.text.trim()) notes.push(n.text);
      }
    }
    if (!notes.length) return null;
    // De-dupe identical notes from multiple customers
    return Array.from(new Set(notes)).join("\n\n— — —\n\n");
  };

  const tick = useCallback(async () => {
    if (!enabled) return;
    const list = store.frigates.filter((f) => f.enabled);
    const newEvents: OfflineEvent[] = [];

    await Promise.all(list.map(async (inst) => {
      let unreachable = false;
      let offlineNow: string[] = [];
      try {
        const res = await fetch(frigateUrl(inst, "/api/stats"));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        offlineNow = parseStats(await res.json());
      } catch {
        unreachable = true;
      }

      const prev = stateRef.current.get(inst.id) ?? {
        unreachable: false, offline: new Set<string>(), sinceMap: new Map<string, string>(),
      };
      const nowOffline = new Set(offlineNow);
      const sinceMap = new Map(prev.sinceMap);
      const nowIso = new Date().toISOString();

      // Determine NEW offline transitions
      if (!initRef.current) {
        // NVR went unreachable
        if (unreachable && !prev.unreachable) {
          const since = nowIso;
          sinceMap.set("__nvr__", since);
          const key = `${inst.id}::__nvr__::${since}`;
          if (!ackedRef.current.has(key)) {
            const instr = pickInstruction(inst.id, null);
            if (instr) {
              newEvents.push({ key, inst, camera: null, since, instructions: instr });
            }
          }
        }
        // Cameras newly offline
        for (const cam of nowOffline) {
          if (!prev.offline.has(cam)) {
            const since = nowIso;
            sinceMap.set(cam, since);
            const key = `${inst.id}::${cam}::${since}`;
            if (!ackedRef.current.has(key)) {
              const instr = pickInstruction(inst.id, cam);
              if (instr) {
                newEvents.push({ key, inst, camera: cam, since, instructions: instr });
              }
            }
          }
        }
      } else {
        // Initial load: capture current state and treat already-offline as needing a popup once
        if (unreachable) {
          sinceMap.set("__nvr__", nowIso);
          const key = `${inst.id}::__nvr__::${nowIso}`;
          if (!ackedRef.current.has(key)) {
            const instr = pickInstruction(inst.id, null);
            if (instr) newEvents.push({ key, inst, camera: null, since: nowIso, instructions: instr });
          }
        }
        for (const cam of nowOffline) {
          sinceMap.set(cam, nowIso);
          const key = `${inst.id}::${cam}::${nowIso}`;
          if (!ackedRef.current.has(key)) {
            const instr = pickInstruction(inst.id, cam);
            if (instr) newEvents.push({ key, inst, camera: cam, since: nowIso, instructions: instr });
          }
        }
      }

      stateRef.current.set(inst.id, { unreachable, offline: nowOffline, sinceMap });
    }));

    initRef.current = false;
    if (newEvents.length) {
      setQueue((prev) => {
        const seen = new Set(prev.map((e) => e.key));
        return [...prev, ...newEvents.filter((e) => !seen.has(e.key))];
      });
    }
  }, [enabled, store.frigates]);

  useEffect(() => {
    if (!enabled) return;
    void tick();
    const t = setInterval(() => { void tick(); }, POLL_MS);
    return () => clearInterval(t);
  }, [enabled, tick]);

  const current = queue[0];

  const acknowledge = async () => {
    if (!current || !user) return;
    ackedRef.current.add(current.key);
    await supabase.from("offline_instruction_acks").insert({
      user_id: user.id,
      instance_id: current.inst.id,
      camera: current.camera ?? "__nvr__",
      since: current.since,
    });
    setQueue((q) => q.slice(1));
  };

  if (!enabled || !current) return null;

  return (
    <Dialog open onOpenChange={() => { /* must acknowledge */ }}>
      <DialogContent
        className="max-w-lg border-amber-500/50"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-500">
            <MessageSquareWarning className="h-5 w-5" />
            Customer instruction — action required
          </DialogTitle>
          <DialogDescription>
            A camera or NVR has just gone offline and the customer left specific instructions for the operator on duty.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
            <div className="flex items-center gap-2 text-sm text-destructive font-medium">
              {current.camera ? (
                <><VideoOff className="h-4 w-4" /> Camera offline</>
              ) : (
                <><WifiOff className="h-4 w-4" /> NVR unreachable</>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-foreground">
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{current.inst.name}</span>
              {current.camera && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="capitalize">{current.camera}</span>
                </>
              )}
            </div>
          </div>

          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="text-[11px] uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Customer instruction
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {current.instructions}
            </p>
          </div>

          {queue.length > 1 && (
            <p className="text-[11px] text-muted-foreground text-center">
              {queue.length - 1} more instruction{queue.length - 1 === 1 ? "" : "s"} to acknowledge after this one.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={acknowledge} className="gap-2 w-full sm:w-auto">
            <CheckCircle2 className="h-4 w-4" />
            Acknowledge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
