import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { signInWithUsername } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Webhook, Loader2, CheckCircle2 } from "lucide-react";

const Signup = () => {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState("");
  const [slug, setSlug] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && session) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    const cleanedSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("signup-trial", {
        body: {
          org_name: orgName,
          slug: cleanedSlug,
          username: username.toLowerCase().trim(),
          password,
          contact_email: email.trim(),
        },
      });
      if (fnErr) throw fnErr;
      if ((data as any)?.error) throw new Error((data as any).error);
      try { localStorage.setItem("login.orgSlug", cleanedSlug); } catch { /* ignore */ }
      const { error: signInErr } = await signInWithUsername(username, password, cleanedSlug);
      if (signInErr) throw signInErr;
      navigate("/billing", { replace: true });
    } catch (e) {
      setError((e as Error).message || "Signup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid place-items-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-md bg-gradient-primary grid place-items-center shadow-glow">
            <Webhook className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Start your free trial</h1>
            <p className="text-xs text-muted-foreground">Try the platform — no payment required</p>
          </div>
        </div>

        <Card className="p-5 bg-card/60 backdrop-blur space-y-3">
          <ul className="text-xs text-muted-foreground space-y-1.5">
            <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> 1 NVR connection</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> 5 outgoing emails</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Full event monitoring & live wall</li>
            <li className="flex items-center gap-2 opacity-60"><CheckCircle2 className="h-3.5 w-3.5" /> Branding/customization unlocks on Pro</li>
          </ul>
        </Card>

        <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-card/60 p-5 backdrop-blur">
          <div className="space-y-1.5">
            <Label className="text-xs">Organization name</Label>
            <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Security" required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Organization ID (login slug)</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme"
              autoComplete="organization"
              className="font-mono"
              required
            />
            <p className="text-[10px] text-muted-foreground">Lowercase letters, numbers and dashes only.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Admin username</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Contact email (for billing)</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-2.5 py-2">
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create trial account
          </Button>
          <p className="text-[11px] text-center text-muted-foreground">
            Already have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default Signup;
