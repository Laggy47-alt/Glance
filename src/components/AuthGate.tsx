import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

/**
 * Wraps protected routes:
 *  - Redirects to /login if signed out.
 *  - Redirects to /change-password if profile.must_change_password is true.
 *  - Optional adminOnly flag.
 */
export function AuthGate({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { session, profile, isAdmin, isSuperAdmin, isCustomer, orgs, activeOrg, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (profile?.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  // Signed in but no organization membership (and not super-admin) → friendly stop screen.
  if (orgs.length === 0 && !isSuperAdmin && location.pathname !== "/change-password") {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-lg font-semibold">No organization assigned</h1>
          <p className="text-sm text-muted-foreground">
            Your account exists, but you haven&apos;t been added to an organization yet.
            Please contact your administrator.
          </p>
        </div>
      </div>
    );
  }

  // Super-admin without an active org pick yet → still let them through; sidebar switcher handles it.
  if (!activeOrg && !isSuperAdmin && orgs.length > 0) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground text-sm">
        Loading your organization…
      </div>
    );
  }

  // Customers are restricted to their own portal + password change.
  if (isCustomer && !isAdmin) {
    const allowed = ["/customer", "/change-password"];
    if (!allowed.some((p) => location.pathname === p || location.pathname.startsWith(p + "/"))) {
      return <Navigate to="/customer" replace />;
    }
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to={isCustomer ? "/customer" : "/wall"} replace />;
  }

  return <>{children}</>;
}

