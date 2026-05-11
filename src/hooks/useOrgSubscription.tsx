import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type OrgSubStatus = "grandfathered" | "trial" | "active" | "past_due" | "suspended";

export type OrgSubscription = {
  organization_id: string;
  status: OrgSubStatus;
  trial_nvr_limit: number;
  trial_email_limit: number;
  trial_emails_sent: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  environment: string;
};

export function useOrgSubscription() {
  const { activeOrg } = useAuth();
  const [sub, setSub] = useState<OrgSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeOrg?.id) { setSub(null); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("org_subscriptions")
      .select("*")
      .eq("organization_id", activeOrg.id)
      .maybeSingle();
    setSub((data as OrgSubscription | null) ?? null);
    setLoading(false);
  }, [activeOrg?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!activeOrg?.id) return;
    const ch = supabase
      .channel(`org-sub-${activeOrg.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "org_subscriptions", filter: `organization_id=eq.${activeOrg.id}` },
        () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [activeOrg?.id, refresh]);

  const isGrandfathered = sub?.status === "grandfathered";
  const isTrial = sub?.status === "trial";
  const isActivePaid = sub?.status === "active" || sub?.status === "past_due";
  const isSuspended = sub?.status === "suspended";
  // Effective access: anything not explicitly suspended; check period for paid
  const hasAccess =
    !!sub && !isSuspended &&
    (isGrandfathered || isTrial ||
      (isActivePaid && (!sub.current_period_end || new Date(sub.current_period_end) > new Date())));

  return { sub, loading, refresh, isGrandfathered, isTrial, isActivePaid, isSuspended, hasAccess };
}
