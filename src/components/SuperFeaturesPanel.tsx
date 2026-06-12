import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type Org = { id: string; slug: string; name: string };
type FeatureRow = { organization_id: string; feature_key: string; enabled: boolean };

const FEATURES: Array<{ key: string; label: string; description: string }> = [
  { key: "unifi_envr", label: "Unifi ENVR", description: "Allow this org to add and use Unifi ENVR sources." },
];

export function SuperFeaturesPanel({ orgs }: { orgs: Org[] }) {
  const [rows, setRows] = useState<FeatureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("org_features").select("organization_id, feature_key, enabled");
    setRows((data ?? []) as FeatureRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel("super-org-features")
      .on("postgres_changes", { event: "*", schema: "public", table: "org_features" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [load]);

  const isEnabled = (orgId: string, key: string) =>
    rows.some((r) => r.organization_id === orgId && r.feature_key === key && r.enabled);

  const setEnabled = async (orgId: string, key: string, enabled: boolean) => {
    const pid = `${orgId}:${key}`;
    setPending((p) => new Set(p).add(pid));
    const { error } = await supabase
      .from("org_features")
      .upsert({ organization_id: orgId, feature_key: key, enabled }, { onConflict: "organization_id,feature_key" });
    setPending((p) => { const n = new Set(p); n.delete(pid); return n; });
    if (error) { toast.error(error.message); return; }
    toast.success(`${enabled ? "Enabled" : "Disabled"} for org`);
  };

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            {FEATURES.map((f) => (
              <TableHead key={f.key} className="text-center">
                <div className="text-xs font-semibold">{f.label}</div>
                <div className="text-[10px] font-normal text-muted-foreground">{f.description}</div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={FEATURES.length + 1} className="text-center py-8"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>
          ) : orgs.length === 0 ? (
            <TableRow><TableCell colSpan={FEATURES.length + 1} className="text-center text-sm text-muted-foreground py-8">No organizations.</TableCell></TableRow>
          ) : orgs.map((o) => (
            <TableRow key={o.id}>
              <TableCell>
                <div className="text-sm font-medium">{o.name}</div>
                <div className="text-[11px] font-mono text-muted-foreground">{o.slug}</div>
              </TableCell>
              {FEATURES.map((f) => {
                const pid = `${o.id}:${f.key}`;
                const busy = pending.has(pid);
                return (
                  <TableCell key={f.key} className="text-center">
                    <Switch
                      checked={isEnabled(o.id, f.key)}
                      disabled={busy}
                      onCheckedChange={(v) => void setEnabled(o.id, f.key, v)}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
