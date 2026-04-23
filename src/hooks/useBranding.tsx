import { createContext, useContext, useEffect, useMemo, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Branding = {
  appName: string;
  appSubtitle: string;
  logoUrl: string | null;
};

type BrandingCtx = Branding & {
  loading: boolean;
  refresh: () => Promise<void>;
};

const DEFAULTS: Branding = {
  appName: "ABC Glance",
  appSubtitle: "Event Dashboard",
  logoUrl: null,
};

const Ctx = createContext<BrandingCtx | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("app_name, app_subtitle, logo_url")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setBranding({
        appName: data.app_name ?? DEFAULTS.appName,
        appSubtitle: data.app_subtitle ?? DEFAULTS.appSubtitle,
        logoUrl: data.logo_url ?? null,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("app_settings_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  // Update document title when app name changes
  useEffect(() => {
    if (branding.appName) document.title = branding.appName;
  }, [branding.appName]);

  const value = useMemo<BrandingCtx>(
    () => ({ ...branding, loading, refresh: load }),
    [branding, loading, load]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBranding() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBranding must be used inside BrandingProvider");
  return v;
}
