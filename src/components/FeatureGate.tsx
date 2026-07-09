import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useOrgFeatures } from "@/hooks/useOrgFeatures";

/**
 * Redirects to `/` if the active org does not have `feature` enabled.
 * Wrap inside <AuthGate> so auth is guaranteed first.
 */
export function FeatureGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { loading, hasFeature } = useOrgFeatures();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (!hasFeature(feature)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
