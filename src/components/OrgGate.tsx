import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useOrgSubscription } from "@/hooks/useOrgSubscription";

/**
 * Allow-listed routes accessible regardless of subscription status.
 * Suspended orgs can still log in, change password, view billing.
 */
const ALWAYS_ALLOWED = ["/billing", "/change-password", "/login", "/signup", "/offline"];

/**
 * Wraps protected routes for org members. Redirects suspended orgs to /billing.
 * Super admins and customers (who don't manage billing) are bypassed.
 */
export function OrgGate({ children }: { children: ReactNode }) {
  const { isSuperAdmin, isCustomer, isAdmin, activeOrg } = useAuth();
  const { sub, loading, hasAccess } = useOrgSubscription();
  const location = useLocation();

  // Bypass: super admins, customers, no active org yet
  if (isSuperAdmin || isCustomer || !activeOrg) return <>{children}</>;

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  // No subscription row OR no access -> billing (admins can resolve; non-admins still see billing message)
  if (!sub || !hasAccess) {
    if (ALWAYS_ALLOWED.some((p) => location.pathname === p || location.pathname.startsWith(p + "/"))) {
      return <>{children}</>;
    }
    return <Navigate to="/billing" replace />;
  }

  return <>{children}</>;
}
