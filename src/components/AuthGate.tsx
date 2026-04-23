import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

/**
 * Wraps protected routes:
 *  - Redirects to /login if signed out.
 *  - Redirects to /change-password if profile.must_change_password is true.
 *  - Optional adminOnly flag.
 */
export function AuthGate({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { session, profile, isAdmin, loading } = useAuth();
  const location = useLocation();
  const [seedTried, setSeedTried] = useState(false);

  // Bootstrap the admin/admin account on first ever load (idempotent server-side).
  useEffect(() => {
    if (seedTried) return;
    setSeedTried(true);
    void supabase.functions.invoke("admin-users/seed", { method: "POST" });
  }, [seedTried]);

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

  if (adminOnly && !isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold text-foreground">Access denied</p>
          <p className="text-sm text-muted-foreground">Admin privileges required.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
