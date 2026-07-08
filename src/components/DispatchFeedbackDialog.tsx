import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ClipboardCheck } from "lucide-react";

const sb = supabase as any;

type Props = {
  open: boolean;
  dispatchId: string | null;
  onClose: () => void;
  onSubmitted?: () => void;
};

const OUTCOME_OPTIONS = [
  { value: "false_alarm", label: "False alarm" },
  { value: "genuine", label: "Genuine incident" },
  { value: "resolved", label: "Resolved" },
  { value: "other", label: "Other" },
];
const ACTION_OPTIONS = [
  { value: "patrol", label: "Patrol only" },
  { value: "arrest", label: "Arrest / suspect detained" },
  { value: "saps_called", label: "SAPS called" },
  { value: "none", label: "No action needed" },
  { value: "other", label: "Other" },
];

export function DispatchFeedbackDialog({ open, dispatchId, onClose, onSubmitted }: Props) {
  const [outcome, setOutcome] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [damage, setDamage] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [dispatchInfo, setDispatchInfo] = useState<{ site?: string; responder?: string } | null>(null);

  useEffect(() => {
    if (!open || !dispatchId) {
      setOutcome(""); setAction(""); setNotes(""); setDamage(""); setDispatchInfo(null);
      return;
    }
    (async () => {
      const { data } = await sb.from("dispatches")
        .select("id, site_id, responder_id, alert_payload")
        .eq("id", dispatchId).maybeSingle();
      if (!data) return;
      const [s, r] = await Promise.all([
        data.site_id ? sb.from("sites").select("name").eq("id", data.site_id).maybeSingle() : Promise.resolve({ data: null }),
        data.responder_id ? sb.from("responders").select("name").eq("id", data.responder_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setDispatchInfo({ site: s.data?.name, responder: r.data?.name });
    })();
  }, [open, dispatchId]);

  const submit = async () => {
    if (!dispatchId) return;
    if (!outcome) { toast.error("Pick an outcome"); return; }
    if (!action) { toast.error("Pick an action taken"); return; }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id ?? null;

    // Load dispatch to get org + alert_media_ids for auto-clear
    const { data: d } = await sb.from("dispatches")
      .select("id, organization_id, alert_media_ids")
      .eq("id", dispatchId).maybeSingle();

    const { error } = await sb.from("dispatches").update({
      feedback_outcome: outcome,
      feedback_action: action,
      feedback_notes: notes.trim() || null,
      feedback_damage: damage.trim() || null,
      feedback_submitted_at: new Date().toISOString(),
      feedback_submitted_by: uid,
    }).eq("id", dispatchId);

    if (error) { setSaving(false); toast.error(error.message); return; }

    // Log event
    if (d?.organization_id) {
      await sb.from("dispatch_events").insert({
        dispatch_id: dispatchId,
        organization_id: d.organization_id,
        kind: "feedback_submitted",
        payload: { outcome, action, has_notes: !!notes.trim(), has_damage: !!damage.trim(), source: "operator" },
      });
    }

    // Auto-clear the alert(s) from the Wall by archiving the media
    const mediaIds: string[] = Array.isArray(d?.alert_media_ids) ? d!.alert_media_ids : [];
    if (mediaIds.length > 0) {
      await sb.from("media_items").update({ archived: true }).in("id", mediaIds);
      // Add a completion tag alongside the "positive" tag inserted at dispatch time
      const rows = mediaIds.map((mid) => ({
        media_id: mid,
        tag: "dispatched_completed",
        note: `auto: dispatch ${dispatchId} completed`,
      }));
      await sb.from("media_tags").insert(rows);
    }

    setSaving(false);
    toast.success("Feedback recorded");
    onSubmitted?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" /> Dispatch feedback
          </DialogTitle>
          <DialogDescription>
            {dispatchInfo?.site
              ? `${dispatchInfo.site}${dispatchInfo.responder ? ` · ${dispatchInfo.responder}` : ""} — record what the responder reported.`
              : "Record what the responder reported to close out this dispatch."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Outcome *</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  {OUTCOME_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Action taken *</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  {ACTION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes from responder</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="What the responder relayed on scene…" />
          </div>

          <div className="space-y-1.5">
            <Label>Damage / loss reported</Label>
            <Input value={damage} onChange={(e) => setDamage(e.target.value)}
              placeholder="e.g. broken window, nothing stolen" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Later</Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
            Submit &amp; close alert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
