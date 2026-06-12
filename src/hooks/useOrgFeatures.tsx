import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const FEATURE_UNIFI_ENVR = "unifi_envr";

export function useOrgFeatures() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? null;
  const [features, setFeatures] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) { setFeatures(new Set()); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("org_features")
      .select("feature_key, enabled")
      .eq("organization_id", orgId);
    setFeatures(new Set((data ?? []).filter((r: any) => r.enabled).map((r: any) => r.feature_key as string)));
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`org-features-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "org_features", filter: `organization_id=eq.${orgId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [orgId, load]);

  return useMemo(() => ({
    loading,
    hasFeature: (key: string) => features.has(key),
    features,
    refresh: load,
  }), [loading, features, load]);
}
