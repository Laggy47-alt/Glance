import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import type { FrigateInstance } from "@/lib/webhookStore";
import { ChevronDown, MessageSquareWarning, Save, Server } from "lucide-react";

type Row = {
  id?: string;
  instance_id: string;
  camera: string | null;
  instructions: string;
};

export function CustomerInstructionsCard({
  instances,
  camerasByInstance,
}: {
  instances: FrigateInstance[];
  camerasByInstance: Map<string, string[]>;
}) {
  const { user, activeOrg } = useAuth();
  const [rows, setRows] = useState<Map<string, Row>>(new Map()); // key = `${instance_id}::${camera ?? ""}`
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const keyOf = (instId: string, camera: string | null) => `${instId}::${camera ?? ""}`;

  const load = useCallback(async () => {
    if (!user || !activeOrg?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("customer_offline_instructions")
      .select("id, instance_id, camera, instructions")
      .eq("user_id", user.id)
      .eq("organization_id", activeOrg.id);
    const m = new Map<string, Row>();
    const d = new Map<string, string>();
    for (const r of data ?? []) {
      const k = keyOf(r.instance_id, r.camera);
      m.set(k, r as Row);
      d.set(k, r.instructions ?? "");
    }
    setRows(m);
    setDrafts(d);
    setLoading(false);
  }, [user, activeOrg?.id]);

  useEffect(() => { void load(); }, [load]);

  const save = async (instId: string, camera: string | null) => {
    if (!user || !activeOrg?.id) return;
    const k = keyOf(instId, camera);
    const text = drafts.get(k) ?? "";
    setSaving(k);
    try {
      const existing = rows.get(k);
      if (text.trim() === "") {
        // empty → delete
        if (existing?.id) {
          const { error } = await supabase.from("customer_offline_instructions").delete().eq("id", existing.id).eq("organization_id", activeOrg.id);
          if (error) throw error;
        }
        setRows((p) => { const n = new Map(p); n.delete(k); return n; });
        toast({ title: "Instruction cleared" });
      } else {
        const payload = {
          organization_id: activeOrg.id,
          user_id: user.id,
          instance_id: instId,
          camera,
          instructions: text,
          updated_by: user.id,
        };
        if (existing?.id) {
          const { error } = await supabase
            .from("customer_offline_instructions")
            .update({ instructions: text, updated_by: user.id })
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { data, error } = await supabase
            .from("customer_offline_instructions")
            .insert(payload)
            .select("id, instance_id, camera, instructions")
            .single();
          if (error) throw error;
          setRows((p) => new Map(p).set(k, data as Row));
        }
        toast({ title: "Instruction saved", description: "Operators will see this when the camera goes offline." });
      }
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const setDraft = (k: string, v: string) => {
    setDrafts((p) => new Map(p).set(k, v));
  };

  const isDirty = (instId: string, camera: string | null) => {
    const k = keyOf(instId, camera);
    return (drafts.get(k) ?? "") !== (rows.get(k)?.instructions ?? "");
  };

  if (instances.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-card/60 flex items-center gap-2">
        <MessageSquareWarning className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-foreground">Operator instructions when offline</h3>
      </div>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        Leave a note for the control room. It will pop up to operators as soon as a camera or NVR goes offline,
        and they must acknowledge it. The site default applies to all cameras unless you set a specific override.
      </p>
      <ul className="divide-y divide-border mt-2">
        {instances.map((inst) => {
          const cams = camerasByInstance.get(inst.id) ?? [];
          const defaultK = keyOf(inst.id, null);
          const hasOverrides = cams.some((c) => rows.has(keyOf(inst.id, c)));
          return (
            <li key={inst.id} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Server className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{inst.name}</span>
                {rows.has(defaultK) && (
                  <Badge variant="secondary" className="text-[10px]">Site note set</Badge>
                )}
                {hasOverrides && (
                  <Badge variant="outline" className="text-[10px]">Per-camera overrides</Badge>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Site-wide default (applies to any camera here)
                </label>
                <Textarea
                  rows={2}
                  placeholder={`e.g. If any camera here goes offline, call John on 082 555 1234 before doing anything else.`}
                  value={drafts.get(defaultK) ?? ""}
                  onChange={(e) => setDraft(defaultK, e.target.value)}
                  disabled={loading}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-7 text-xs"
                    disabled={!isDirty(inst.id, null) || saving === defaultK}
                    onClick={() => save(inst.id, null)}
                  >
                    <Save className="h-3 w-3" /> Save
                  </Button>
                </div>
              </div>

              {cams.length > 0 && (
                <Collapsible className="mt-3">
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition">
                      <ChevronDown className="h-3 w-3 transition-transform data-[state=open]:rotate-180" />
                      Per-camera overrides ({cams.length} camera{cams.length === 1 ? "" : "s"})
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2 pl-4 border-l-2 border-border">
                    {cams.map((cam) => {
                      const k = keyOf(inst.id, cam);
                      return (
                        <div key={cam} className="space-y-1">
                          <label className="text-[11px] text-muted-foreground capitalize">{cam}</label>
                          <Textarea
                            rows={2}
                            placeholder="Optional override for this camera (leave blank to use site default)"
                            value={drafts.get(k) ?? ""}
                            onChange={(e) => setDraft(k, e.target.value)}
                            disabled={loading}
                          />
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1.5 h-6 text-[11px]"
                              disabled={!isDirty(inst.id, cam) || saving === k}
                              onClick={() => save(inst.id, cam)}
                            >
                              <Save className="h-3 w-3" /> Save
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
