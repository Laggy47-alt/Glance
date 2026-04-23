import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { changeOwnPassword } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2 } from "lucide-react";

const ChangePassword = () => {
  const { session, profile, refreshProfile, loading } = useAuth();
  const navigate = useNavigate();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;

  const forced = !!profile?.must_change_password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw1.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (pw1 !== pw2) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      await changeOwnPassword(pw1);
      await refreshProfile();
      navigate("/", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid place-items-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-md bg-gradient-primary grid place-items-center shadow-glow">
            <KeyRound className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {forced ? "Set a new password" : "Change password"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {forced
                ? "You must change the default password before continuing."
                : `Signed in as ${profile?.display_name ?? profile?.username ?? ""}`}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-card/60 p-5 backdrop-blur">
          <div className="space-y-1.5">
            <Label htmlFor="pw1" className="text-xs">New password</Label>
            <Input id="pw1" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoFocus required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw2" className="text-xs">Confirm new password</Label>
            <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
          </div>
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-2.5 py-2">
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Update password
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ChangePassword;
