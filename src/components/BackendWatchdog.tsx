import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { pingSupabase, hasOfflineSession } from "@/lib/offlineMode";

const SKIP_PATHS = ["/offline", "/login"];
const CHECK_INTERVAL_MS = 30_000;
// Far less aggressive: only fall back to /offline after 4 consecutive failures
// (~2 minutes of total unreachability), and never auto-redirect once a user is
// signed in — interactive errors are easier to debug than a forced offline page.
const FAILURES_BEFORE_REDIRECT = 4;

export function BackendWatchdog() {
  const navigate = useNavigate();
  const location = useLocation();
  const failures = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (SKIP_PATHS.includes(location.pathname)) return;
      const r = await pingSupabase(8_000);
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
