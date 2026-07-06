import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

type Responder = { id: string; name: string; on_duty: boolean; vehicle_id: string | null };
type Vehicle = { id: string; plate: string; call_sign: string | null; responder_id: string | null };
type Site = { id: string; name: string; latitude: number | null; longitude: number | null };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Optional pre-selected site (e.g. from an alert). */
  defaultSiteId?: string | null;
  /** Optional hint text shown in dialog description. */
  hint?: string;
  /** Optional source metadata written to dispatches.source / source_ref. */
  source?: "manual" | "unifi_offline" | "hikvision_event" | "frigate_event" | "other";
  sourceRef?: string | null;
  onCreated?: (dispatchId: string) => void;
};

const sb = supabase as any;

export function DispatchDialog({
  open, onClose, defaultSiteId, hint, source = "manual", sourceRef = null, onCreated,
}: Props) {
  const { activeOrg } = useAuth();
  const [responders, setResponders] = useState<Responder[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [responderId, setResponderId] = useState<string>("");
  const [vehicleId, setVehicleId] = useState<string>("");
  const [priority, setPriority] = useState<string>("normal");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !activeOrg?.id) return;
    setLoading(true);
    (async () => {
      const [r, v, s] = await Promise.all([
        sb.from("responders").select("id, name, on_duty, vehicle_id")
          .eq("organization_id", activeOrg.id).eq("active", true).order("on_duty", { ascending: false }).order("name"),
        sb.from("vehicles").select("id, plate, call_sign, responder_id")
          .eq("organization_id", activeOrg.id).eq("active", true).order("plate"),
        sb.from("sites").select("id, name, latitude, longitude")
          .eq("organization_id", activeOrg.id).order("name"),
      ]);
      setResponders((r.data ?? []) as Responder[]);
      setVehicles((v.data ?? []) as Vehicle[]);
      setSites((s.data ?? []) as Site[]);
      setSiteId(defaultSiteId ?? "");
      setResponderId("");
      setVehicleId("");
      setPriority("normal");
      setNotes("");
      setLoading(false);
    })();
  }, [open, activeOrg?.id, defaultSiteId]);

  // Auto-pick vehicle when responder chosen
  useEffect(() => {
    if (!responderId) return;
    const r = responders.find((x) => x.id === responderId);
    if (r?.vehicle_id && !vehicleId) setVehicleId(r.vehicle_id);
  }, [responderId, responders, vehicleId]);

  const onDutyIds = useMemo(() => new Set(responders.filter((r) => r.on_duty).map((r) => r.id)), [responders]);

  const submit = async () => {
    if (!activeOrg?.id) return;
    if (!siteId) { toast.error("Pick a site"); return; }
    if (!responderId) { toast.error("Pick a responder"); return; }
    setSaving(true);
    const { data, error } = await sb.from("dispatches").insert({
      organization_id: activeOrg.id,
      site_id: siteId,
      responder_id: responderId,
      vehicle_id: vehicleId || null,
      priority,
      notes: notes.trim() || null,
      source,
      source_ref: sourceRef,
      status: "pending",
    }).select("id").maybeSingle();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (data?.id) {
      await sb.from("dispatch_events").insert({
        dispatch_id: data.id,
        organization_id: activeOrg.id,
        kind: "created",
        payload: { source, source_ref: sourceRef },
      });
    }
    toast.success("Dispatched");
    onCreated?.(data?.id ?? "");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Dispatch responder</DialogTitle>
          <DialogDescription>{hint ?? "Send a responder to a site."}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Site *</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger><SelectValue placeholder="Choose a site" /></SelectTrigger>
                <SelectContent>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{s.latitude == null || s.longitude == null ? " (no coords)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {siteId && !sites.find((s) => s.id === siteId)?.latitude && (
                <p className="text-[11px] text-amber-600">This site has no coordinates — auto-arrival is disabled.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Responder *</Label>
                <Select value={responderId} onValueChange={setResponderId}>
                  <SelectTrigger><SelectValue placeholder="Pick responder" /></SelectTrigger>
                  <SelectContent>
                    {responders.length === 0 && <SelectItem value="__none__" disabled>No active responders</SelectItem>}
                    {responders.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}{onDutyIds.has(r.id) ? " · on duty" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Vehicle</Label>
                <Select value={vehicleId || "__none__"} onValueChange={(v) => setVehicleId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {vehicles.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.plate}{v.call_sign ? ` · ${v.call_sign}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="What's the responder walking into?" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
