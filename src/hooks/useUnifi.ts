import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { UnifiInstance } from "@/lib/unifiClient";

export function useUnifiInstances(orgId: string | null) {
  const [instances, setInstances] = useState<UnifiInstance[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setInstances([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("unifi_instances" as any)
      .select("*")
      .eq("organization_id", orgId)
      .order("name");
    if (!error && data) setInstances(data as unknown as UnifiInstance[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { instances, loading, refresh };
}
