import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { pingSupabase, hasOfflineSession } from "@/lib/offlineMode";

const SKIP_PATHS = ["/offline"];
const CHECK_INTERVAL_MS = 20_000;
const FAILURES_BEFORE_REDIRECT = 2;

/**
 * Watches Supabase reachability in the background. When the backend is
 * unreachable for 2 consecutive probes, redirects the user to /offline so the
 * platform owner can still sign in with emergency diagnostics credentials.
 */
export function BackendWatchdog() {
  const navigate = useNavigate();
  const location = useLocation();
  const failures = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (SKIP_PATHS.includes(location.pathname)) return;
      const r = await pingSupabase(6_000);
      if (cancelled) return;
      if (r.ok) {
        failures.current = 0;
      } else {
        failures.current += 1;
        if (failures.current >= FAILURES_BEFORE_REDIRECT && !hasOfflineSession()) {
          navigate("/offline", { replace: true });
        }
      }
    };
    void check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [location.pathname, navigate]);

  return null;
}
