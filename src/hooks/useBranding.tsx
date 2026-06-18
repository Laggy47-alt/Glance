import { createContext, useContext, useEffect, useMemo, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type Branding = {
  appName: string;        // composed name shown in UI (e.g. "ABC Glance")
  baseAppName: string;    // raw stored name (e.g. "Glance")
  appSubtitle: string;
  logoUrl: string | null;
};

type BrandingCtx = Branding & {
  loading: boolean;
  refresh: () => Promise<void>;
};

const BASE_DEFAULT = "Glance";
const DEFAULTS: Branding = {
  appName: BASE_DEFAULT,
  baseAppName: BASE_DEFAULT,
  appSubtitle: "Event Dashboard",
  logoUrl: null,
};

const Ctx = createContext<BrandingCtx | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { activeOrg, session } = useAuth();
  const [branding, setBranding] = useState<Branding>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeOrg?.id) {
      setBranding(DEFAULTS);
      setLoading(false);
      return;
    }

    const q = supabase
      .from("app_settings")
      .select("app_name, app_subtitle, logo_url, organization_id")
      .eq("organization_id", activeOrg.id);
    const { data } = await q.order("updated_at", { ascending: false }).limit(1).maybeSingle();

    const base = (data?.app_name?.trim() || BASE_DEFAULT);
    // Prefix with org name when known and not already part of the name
    const orgName = activeOrg?.name?.trim();
    const appName = orgName && !base.toLowerCase().startsWith(orgName.toLowerCase())
      ? `${orgName} ${base}`
      : base;

    setBranding({
      appName,
      baseAppName: base,
      appSubtitle: data?.app_subtitle ?? DEFAULTS.appSubtitle,
      logoUrl: data?.logo_url ?? null,
    });
    setLoading(false);
  }, [activeOrg?.id, activeOrg?.name]);

  useEffect(() => {
    void load();
    if (!session?.user?.id || !activeOrg?.id) return;
    const channel = supabase
      .channel("app_settings_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => {
        void load();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, session?.user?.id, activeOrg?.id]);

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
