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
  const { session, profile, isAdmin, isCustomer, loading } = useAuth();
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

