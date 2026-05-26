import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, LogOut, ShieldAlert, KeyRound } from "lucide-react";
import {
  emergencyResetAdmin,
  endOfflineSession,
  hasOfflineSession,
  pingSupabase,
  startOfflineSession,
  verifyEmergencyCredentials,
} from "@/lib/offlineMode";

type ProbeState = { loading: boolean; ok: boolean; status?: number; error?: string; ts?: number };

const Offline = () => {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(() => hasOfflineSession());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<ProbeState>({ loading: true, ok: false });

  const runProbe = async () => {
    setProbe((p) => ({ ...p, loading: true }));
    const r = await pingSupabase();
    setProbe({ loading: false, ok: r.ok, status: r.status, error: r.error, ts: Date.now() });
  };

  useEffect(() => {
    void runProbe();
    const id = setInterval(runProbe, 15_000);
    return () => clearInterval(id);
  }, []);

  // Note: we intentionally do NOT auto-redirect when the backend is reachable.
  // The emergency login must remain available at all times so the platform
  // owner can always get into diagnostics, even on a healthy system.

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr(null);
    setBusy(true);
    const ok = await verifyEmergencyCredentials(username, password);
    setBusy(false);
    if (!ok) { setAuthErr("Invalid emergency credentials."); return; }
    startOfflineSession();
    setAuthed(true);
  };

  const signOut = () => { endOfflineSession(); setAuthed(false); };

  if (!authed) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="h-12 w-12 rounded-md bg-destructive/15 grid place-items-center">
              <ShieldAlert className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Backend Unreachable</h1>
              <p className="text-xs text-muted-foreground">
                Sign in with the emergency admin credentials to view diagnostics.
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-card/60 p-5 backdrop-blur">
            <div className="space-y-1.5">
              <Label htmlFor="u" className="text-xs">Username</Label>
              <Input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p" className="text-xs">Password</Label>
              <Input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {authErr && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-2.5 py-2">
                {authErr}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enter diagnostics
            </Button>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="block w-full text-[11px] text-center text-muted-foreground hover:text-foreground"
            >
              Back to normal sign-in
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-destructive/15 grid place-items-center">
              <ShieldAlert className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Offline Diagnostics</h1>
              <p className="text-xs text-muted-foreground">Emergency diagnostics session</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> End session
          </Button>
        </div>

        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Backend Connectivity</h2>
            <Button size="sm" variant="outline" onClick={runProbe} disabled={probe.loading}>
              {probe.loading ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
              Re-test
            </Button>
          </div>

          <div className="flex items-start gap-3 rounded-md border border-border bg-card/40 p-4">
            {probe.ok ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            )}
            <div className="text-xs space-y-1 flex-1">
              <div className="font-medium text-foreground">
                {probe.ok ? "Backend reachable" : "Backend unreachable"}
              </div>
              <div className="text-muted-foreground">
                URL: <span className="font-mono">{import.meta.env.VITE_SUPABASE_URL || "(not configured)"}</span>
              </div>
              {probe.status !== undefined && (
                <div className="text-muted-foreground">HTTP status: {probe.status}</div>
              )}
              {probe.error && (
                <div className="text-destructive">Error: {probe.error}</div>
              )}
              {probe.ts && (
                <div className="text-muted-foreground">Last checked: {new Date(probe.ts).toLocaleTimeString()}</div>
              )}
            </div>
          </div>

          {probe.ok && (
            <Button className="w-full" onClick={() => { endOfflineSession(); navigate("/login"); }}>
              Backend is up — go to normal sign-in
            </Button>
          )}
        </Card>

        <Card className="p-5 space-y-3 text-xs text-muted-foreground">
          <h2 className="text-sm font-medium text-foreground">Troubleshooting</h2>
          <ul className="space-y-1.5 list-disc pl-4">
            <li>Verify the backend project is not paused.</li>
            <li>Check DNS / firewall for the URL above.</li>
            <li>Confirm the publishable key in the deployment environment matches the project.</li>
            <li>If self-hosted: ensure the Supabase / Postgres container is running and reachable from this client.</li>
            <li>Auto re-test runs every 15 seconds; the page will redirect once the backend recovers.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
};

export default Offline;
