import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { webhookStore } from "@/lib/webhookStore";

export type Profile = {
  user_id: string;
  username: string;
  display_name: string | null;
  must_change_password: boolean;
};

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
  orgs: OrgMembership[];
  activeOrg: OrgMembership["organization"] | null;
  setActiveOrgId: (id: string | null) => void;
  impersonateOrg: (org: { id: string; slug: string; name: string } | null) => void;
  isImpersonating: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);
const ACTIVE_ORG_KEY = "auth.activeOrgId";
const IMPERSONATE_KEY = "auth.impersonateOrg";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isCustomer, setIsCustomer] = useState(false);
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_ORG_KEY); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [impersonated, setImpersonated] = useState<{ id: string; slug: string; name: string } | null>(() => {
    try { const v = localStorage.getItem(IMPERSONATE_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
  });

  const setActiveOrgId = (id: string | null) => {
    setActiveOrgIdState(id);
    try {
      if (id) localStorage.setItem(ACTIVE_ORG_KEY, id);
      else localStorage.removeItem(ACTIVE_ORG_KEY);
    } catch { /* ignore */ }
  };

  const impersonateOrg = (org: { id: string; slug: string; name: string } | null) => {
    setImpersonated(org);
    try {
      if (org) localStorage.setItem(IMPERSONATE_KEY, JSON.stringify(org));
      else localStorage.removeItem(IMPERSONATE_KEY);
    } catch { /* ignore */ }
  };

  const loadProfile = async (userId: string) => {
    const [{ data: prof }, { data: roles }, { data: memberships }] = await Promise.all([
      supabase.from("profiles").select("user_id, username, display_name, must_change_password").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("organization_members")
        .select("organization_id, role, organization:organizations(id, slug, name)")
        .eq("user_id", userId),
    ]);
    setProfile((prof as Profile) ?? null);
    const list = (memberships ?? []) as unknown as OrgMembership[];
    const roleSet = new Set((roles ?? []).map((r) => r.role as string));
    const superAdmin = roleSet.has("super_admin");
    setIsSuperAdmin(superAdmin);
    // An operator account has user_roles.role = 'user'. Treat customer status
    // ONLY when the legacy app_role is explicitly 'customer' — org_members.role
    // defaults to 'customer' for non-admins, which would otherwise mis-classify operators.
    const isOperator = roleSet.has("user");
    setIsAdmin(superAdmin || roleSet.has("admin") || list.some((m) => m.role === "admin"));
    setIsCustomer(!isOperator && (roleSet.has("customer") || list.some((m) => m.role === "customer")));
    setOrgs(list);
    // Pick a default active org if none stored
    if (!activeOrgId && list.length > 0) {
      const preferred = list.find((m) => m.role === "admin") ?? list[0];
      setActiveOrgId(preferred.organization_id);
    }
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
        setOrgs([]);
        setActiveOrgId(null);
        impersonateOrg(null);
      }
    });
    supabase.auth.getSession()
      .then(async ({ data }) => {
        setSession(data.session);
        if (data.session?.user) await loadProfile(data.session.user.id);
      })
      .catch(() => {
        setSession(null);
      })
      .finally(() => setLoading(false));
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeOrg = useMemo(() => {
    if (impersonated) return impersonated;
    if (!orgs.length) return null;
    return (orgs.find((m) => m.organization_id === activeOrgId)?.organization
      ?? orgs[0].organization) ?? null;
  }, [orgs, activeOrgId, impersonated]);

  // Scope all webhook/frigate data to the active org so switching orgs (or
  // super-admin impersonation) never leaks rows from another org.
  useEffect(() => {
    webhookStore.setActiveOrg(activeOrg?.id ?? null);
  }, [activeOrg?.id]);

  const value = useMemo<AuthCtx>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    isAdmin: isAdmin || (isSuperAdmin && !!impersonated),
    isSuperAdmin,
    isCustomer,
    orgs,
    activeOrg,
    setActiveOrgId,
    impersonateOrg,
    isImpersonating: !!impersonated,
    loading,
    signOut: async () => { await supabase.auth.signOut(); },
    refreshProfile: async () => { if (session?.user) await loadProfile(session.user.id); },
  }), [session, profile, isAdmin, isSuperAdmin, isCustomer, orgs, activeOrg, loading, impersonated]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
