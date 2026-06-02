import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  user_id: string;
  username: string;
  display_name: string | null;
  must_change_password: boolean;
};

// Kept for type compatibility with components that still import OrgMembership.
// Single-tenant: there are no orgs, so consumers should treat these as no-ops.
export type OrgMembership = {
  organization_id: string;
  role: "admin" | "customer";
  organization: { id: string; slug: string; name: string } | null;
};

type AuthCtx = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isCustomer: boolean;
  /** Always empty in single-tenant mode. */
  orgs: OrgMembership[];
  /** Always null in single-tenant mode. */
  activeOrg: OrgMembership["organization"] | null;
  setActiveOrgId: (id: string | null) => void;
  impersonateOrg: (org: { id: string; slug: string; name: string } | null) => void;
  isImpersonating: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isCustomer, setIsCustomer] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string) => {
    const [{ data: prof }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("user_id, username, display_name, must_change_password").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    setProfile((prof as Profile) ?? null);
    const roleSet = new Set((roles ?? []).map((r) => r.role as string));
    const superAdmin = roleSet.has("super_admin");
    setIsSuperAdmin(superAdmin);
    // Treat super_admin + admin as admin. Customers are explicit role='customer'.
    setIsAdmin(superAdmin || roleSet.has("admin"));
    setIsCustomer(roleSet.has("customer") && !superAdmin && !roleSet.has("admin"));
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => { void loadProfile(s.user.id).catch(() => undefined); }, 0);
      } else {
        setProfile(null);
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setIsCustomer(false);
      }
    });
    supabase.auth.getSession()
      .then(async ({ data }) => {
        setSession(data.session);
        if (data.session?.user) await loadProfile(data.session.user.id);
      })
      .catch(() => { setSession(null); })
      .finally(() => setLoading(false));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Single-tenant: all data lives under one fixed org id (defaulted in DB too).
  // We expose a stable activeOrg constant so every page that still reads
  // `activeOrg.id` to scope queries keeps working without modification.
  const SHARED_ORG = { id: "c093c027-920c-4e88-865a-fb17413b3b5a", slug: "abc-2026", name: "Glance" };

  const value = useMemo<AuthCtx>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    isAdmin,
    isSuperAdmin,
    isCustomer,
    orgs: session ? [{ organization_id: SHARED_ORG.id, role: isAdmin ? "admin" : "customer", organization: SHARED_ORG }] : [],
    activeOrg: session ? SHARED_ORG : null,
    setActiveOrgId: () => { /* no-op: single-tenant */ },
    impersonateOrg: () => { /* no-op: single-tenant */ },
    isImpersonating: false,
    loading,
    signOut: async () => { await supabase.auth.signOut(); },
    refreshProfile: async () => { if (session?.user) await loadProfile(session.user.id); },
  }), [session, profile, isAdmin, isSuperAdmin, isCustomer, loading]);


  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
