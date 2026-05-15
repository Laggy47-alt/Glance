import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { signInWithUsername } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Webhook, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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

  useEffect(() => {
    void supabase.functions.invoke("admin-users/seed", { method: "POST" });
  }, []);

  if (!loading && session) {
    return <Navigate to={location.state?.from ?? "/"} replace />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    // Try ABC first, then fall back to the legacy "super" slug so super admins can still sign in.
    let { error: err } = await signInWithUsername(username, password, ORG_SLUG);
    if (err) {
      const fallback = await signInWithUsername(username, password, "super");
      if (!fallback.error) err = null;
      else err = fallback.error;
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
            <p className="text-xs text-muted-foreground">Sign in to your account</p>
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
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-2.5 py-2">
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Login;
