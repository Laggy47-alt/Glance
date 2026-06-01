import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { signInWithUsername } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Webhook, Loader2 } from "lucide-react";
import { forceCreateAdmin, isEmergencyCredentials, seedAdmin, startOfflineSession } from "@/lib/offlineMode";

// Single-tenant: ABC is the only organization. Slug is fixed.
const ORG_SLUG = "abc-2026";

const Login = () => {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state: { from?: string } | null };
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bootstrapNeeded, setBootstrapNeeded] = useState(false);
  const [bootstrapChecking, setBootstrapChecking] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [forceSetup, setForceSetup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    seedAdmin({ check_only: true })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setSetupError(result.error ?? "Could not check backend setup.");
          setUsername("admin");
          return;
        }
        const needsPassword = Boolean(result.needs_password);
        setBootstrapNeeded(needsPassword);
        if (needsPassword) setUsername("admin");
      })
      .finally(() => { if (!cancelled) setBootstrapChecking(false); });
    return () => { cancelled = true; };
  }, []);

  if (!loading && session) {
    return <Navigate to={location.state?.from ?? "/"} replace />;
  }

  const attemptSignIn = async (u: string, p: string) => {
    // Try ABC first, then fall back to the legacy "super" slug for upgraded installs.
    let { error: err } = await signInWithUsername(u, p, ORG_SLUG);
    if (err) {
      const fallback = await signInWithUsername(u, p, "super");
      err = fallback.error ?? null;
    }
    return err;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    // Emergency offline admin: always accept hardcoded creds, even if
    // the backend is unreachable. Routes to /offline diagnostics page.
    if (isEmergencyCredentials(username, password)) {
      startOfflineSession(username.trim().toLowerCase());
      setBusy(false);
      navigate("/offline", { replace: true });
      return;
    }

    let err: { message: string } | null = null;

    if (bootstrapNeeded || forceSetup) {
      if (password.length < 8) {
        setBusy(false);
        setError("Choose a password with at least 8 characters.");
        return;
      }
      const result = forceSetup
        ? await forceCreateAdmin(password)
        : await seedAdmin({ password });
      if (!result.ok) {
        setBusy(false);
        setError(result.error ?? "Could not create the admin account.");
        return;
      }
      err = await attemptSignIn("admin", password);
    } else {
      err = await attemptSignIn(username, password);
    }

    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    navigate(location.state?.from ?? "/", { replace: true });
  };

  return (
    <div className="min-h-screen w-full grid place-items-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-md bg-gradient-primary grid place-items-center shadow-glow">
            <Webhook className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Glance</h1>
            <p className="text-xs text-muted-foreground">
              {bootstrapNeeded || forceSetup ? "Create the first admin password" : "Sign in to your account"}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-card/60 p-5 backdrop-blur">
          <div className="space-y-1.5">
            <Label htmlFor="username" className="text-xs">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              disabled={bootstrapNeeded || forceSetup || bootstrapChecking}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs">{bootstrapNeeded || forceSetup ? "New admin password" : "Password"}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={bootstrapNeeded || forceSetup ? "new-password" : "current-password"}
              required
            />
          </div>
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-2.5 py-2">
              {error}
            </div>
          )}
          {setupError && !error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-2.5 py-2">
              Backend setup check failed: {setupError}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {bootstrapNeeded || forceSetup ? "Force create admin account" : "Sign in"}
          </Button>
          {(bootstrapNeeded || forceSetup) && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              This will create or repair the admin account and set this as the admin password.
            </p>
          )}
          {!bootstrapNeeded && !forceSetup && (
            <button
              type="button"
              onClick={() => { setForceSetup(true); setUsername("admin"); setError(null); }}
              className="block w-full text-[11px] text-center text-muted-foreground hover:text-foreground"
            >
              Force create / repair admin account
            </button>
          )}
        </form>
      </div>
    </div>
  );
};

export default Login;
