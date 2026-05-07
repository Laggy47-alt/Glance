import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PlatformBranding = {
  appName: string;
  appSubtitle: string;
  logoUrl: string | null;
};

const DEFAULTS: PlatformBranding = {
  appName: "Glance",
  appSubtitle: "Super Admin Portal",
  logoUrl: null,
};

export function usePlatformBranding() {
  const [data, setData] = useState<PlatformBranding>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: row } = await supabase
      .from("platform_settings")
      .select("app_name, app_subtitle, logo_url")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setData({
      appName: row?.app_name ?? DEFAULTS.appName,
      appSubtitle: row?.app_subtitle ?? DEFAULTS.appSubtitle,
      logoUrl: row?.logo_url ?? null,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("platform_settings_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "platform_settings" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [load]);

  return { ...data, loading, refresh: load };
}
