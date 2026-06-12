import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Server, Loader2 } from "lucide-react";
import { toast } from "sonner";

export type UnifiInstance = {
  id: string;
  organization_id: string;
  name: string;
  base_url: string;
  api_key: string;
  color: string;
  enabled: boolean;
  is_local: boolean;
  verify_tls: boolean;
};

const PALETTE = ["#06b6d4", "#a855f7", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6"];

export function UnifiInstancesManager({ compact = false }: { compact?: boolean }) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? null;
  const [items, setItems] = useState<UnifiInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [isLocal, setIsLocal] = useState(false);
  const [verifyTls, setVerifyTls] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("unifi_instances")
      .select("id, organization_id, name, base_url, api_key, color, enabled, is_local, verify_tls")
      .eq("organization_id", orgId)
      .order("name");
    setItems((data ?? []) as UnifiInstance[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`unifi-instances-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "unifi_instances", filter: `organization_id=eq.${orgId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [orgId, load]);

  const reset = () => {
    setName(""); setBaseUrl(""); setApiKey(""); setColor(PALETTE[0]);
    setIsLocal(false); setVerifyTls(true);
  };

  const create = async () => {
    if (!orgId) { toast.error("No active organization"); return; }
    if (!name.trim() || !baseUrl.trim()) { toast.error("Name and base URL required"); return; }
    setSaving(true);
    const { error } = await supabase.from("unifi_instances").insert({
      organization_id: orgId,
      name: name.trim(),
      base_url: baseUrl.trim().replace(/\/+$/, ""),
      api_key: apiKey.trim(),
      color,
      enabled: true,
      is_local: isLocal,
      verify_tls: verifyTls,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Unifi ENVR added");
    reset(); setOpen(false); void load();
  };

  const toggle = async (id: string, enabled: boolean) => {
    const { error } = await supabase.from("unifi_instances").update({ enabled }).eq("id", id);
    if (error) toast.error(error.message);
  };

  const remove = async (it: UnifiInstance) => {
    if (!confirm(`Delete "${it.name}"? All its events will be removed.`)) return;
    const { error } = await supabase.from("unifi_instances").delete().eq("id", it.id);
    if (error) toast.error(error.message); else toast.success("Deleted");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Unifi ENVR</h3>
          <p className="text-xs text-muted-foreground">Connect Unifi Protect / ENVR instances for this organization.</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> Add Unifi ENVR
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Unifi ENVR</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main site ENVR" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Base URL</Label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://192.168.1.1" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">API key</Label>
                <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Unifi local API key" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Color</Label>
                <div className="flex gap-2 flex-wrap">
                  {PALETTE.map((c) => (
                    <button key={c} type="button" onClick={() => setColor(c)} className="h-7 w-7 rounded-md border-2" style={{ background: c, borderColor: color === c ? "hsl(var(--foreground))" : "transparent" }} />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
                <div>
                  <Label className="text-xs">Local network</Label>
                  <p className="text-[10px] text-muted-foreground">Reachable only from inside this network.</p>
                </div>
                <Switch checked={isLocal} onCheckedChange={setIsLocal} />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
                <div>
                  <Label className="text-xs">Verify TLS</Label>
                  <p className="text-[10px] text-muted-foreground">Disable for self-signed certs.</p>
                </div>
                <Switch checked={verifyTls} onCheckedChange={setVerifyTls} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={create} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <Card className="p-4 text-xs text-muted-foreground">Loading…</Card>
      ) : items.length === 0 ? (
        <Card className="p-6 text-center">
          <Server className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No Unifi ENVR configured yet.</p>
        </Card>
      ) : (
        <div className={compact ? "space-y-2" : "grid sm:grid-cols-2 gap-2"}>
          {items.map((it) => (
            <Card key={it.id} className="p-3 flex items-center gap-3">
              <div className="h-8 w-8 rounded-md grid place-items-center shrink-0" style={{ background: `${it.color}22`, color: it.color }}>
                <Server className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate">{it.name}</div>
                <div className="text-[11px] text-muted-foreground truncate font-mono">{it.base_url}</div>
              </div>
              <Switch checked={it.enabled} onCheckedChange={(v) => toggle(it.id, v)} />
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => remove(it)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
