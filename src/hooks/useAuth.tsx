import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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
const ACTIVE_ORG_KEY = "glance.activeOrgId";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isCustomer, setIsCustomer] = useState(false);
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [activeOrgId, _setActiveOrgId] = useState<string | null>(null);
  const [impersonated, setImpersonated] = useState<OrgMembership["organization"] | null>(null);
  const [loading, setLoading] = useState(true);

  const setActiveOrgId = (id: string | null) => {
    _setActiveOrgId(id);
    try {
      if (id) localStorage.setItem(ACTIVE_ORG_KEY, id);
      else localStorage.removeItem(ACTIVE_ORG_KEY);
    } catch { /* ignore */ }
  };

  const loadProfile = async (userId: string) => {
    const [{ data: prof }, { data: roles }, { data: memberships }] = await Promise.all([
      supabase.from("profiles").select("user_id, username, display_name, must_change_password").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("organization_members")
        .select("organization_id, role, organizations(id, slug, name)")
        .eq("user_id", userId),
    ]);
    setProfile((prof as Profile) ?? null);
    const roleSet = new Set((roles ?? []).map((r) => r.role as string));
    const superAdmin = roleSet.has("super_admin");
    setIsSuperAdmin(superAdmin);
    setIsAdmin(superAdmin || roleSet.has("admin"));
    setIsCustomer(roleSet.has("customer") && !superAdmin && !roleSet.has("admin"));

    const orgList: OrgMembership[] = (memberships ?? []).map((m: any) => ({
      organization_id: m.organization_id as string,
      role: m.role as "admin" | "customer",
      organization: (Array.isArray(m.organizations) ? m.organizations[0] : m.organizations) as OrgMembership["organization"],
    }));

    // Super-admin sees every org so they can switch.
    if (superAdmin) {
      const { data: allOrgs } = await supabase.from("organizations").select("id, slug, name");
      const have = new Set(orgList.map((o) => o.organization_id));
      for (const o of allOrgs ?? []) {
        if (!have.has(o.id as string)) {
          orgList.push({ organization_id: o.id as string, role: "admin", organization: o as OrgMembership["organization"] });
        }
      }
    }
    setOrgs(orgList);

    const stored = (() => { try { return localStorage.getItem(ACTIVE_ORG_KEY); } catch { return null; } })();
    const valid = stored && orgList.some((o) => o.organization_id === stored);
    if (valid) {
      _setActiveOrgId(stored!);
    } else if (orgList.length) {
      const preferred = orgList.find((o) => o.role === "admin") ?? orgList[0];
      _setActiveOrgId(preferred.organization_id);
      try { localStorage.setItem(ACTIVE_ORG_KEY, preferred.organization_id); } catch { /* ignore */ }
    } else {
      _setActiveOrgId(null);
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
        _setActiveOrgId(null);
        setImpersonated(null);
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

  const activeOrg = useMemo<OrgMembership["organization"] | null>(() => {
    if (impersonated) return impersonated;
    if (!activeOrgId) return null;
    return orgs.find((o) => o.organization_id === activeOrgId)?.organization ?? null;
  }, [impersonated, activeOrgId, orgs]);

  const value = useMemo<AuthCtx>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    isAdmin,
    isSuperAdmin,
    isCustomer,
    orgs,
    activeOrg,
    setActiveOrgId,
    impersonateOrg: (org) => setImpersonated(org),
    isImpersonating: !!impersonated,
    loading,
    signOut: async () => { await supabase.auth.signOut(); },
    refreshProfile: async () => { if (session?.user) await loadProfile(session.user.id); },
  }), [session, profile, isAdmin, isSuperAdmin, isCustomer, orgs, activeOrg, impersonated, loading]);


  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
