import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// Narrow typed wrapper around the Supabase auth.oauth beta namespace.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
};
const oauth = (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

function isSameOriginRelative(path: string | null): path is string {
  if (!path) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  return true;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Missing authorization_id");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      if (!oauth) {
        setError("OAuth server is not available on this backend.");
        return;
      }
      const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      return setError("No redirect returned by the authorization server.");
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <main className="min-h-screen grid place-items-center bg-background p-6">
        <div className="w-full max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
          <div className="font-medium mb-1">Could not load this authorization request</div>
          <div className="text-xs opacity-80">{error}</div>
        </div>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="min-h-screen grid place-items-center bg-background p-6 text-xs text-muted-foreground">
        Loading authorization request…
      </main>
    );
  }

  const clientName = details.client?.name ?? "an external app";
  const scopes: string[] = details.scopes ?? details.scope?.split(" ") ?? [];

  return (
    <main className="min-h-screen grid place-items-center bg-background p-6">
      <div className="w-full max-w-md space-y-5 rounded-lg border border-border bg-card/60 p-6 backdrop-blur">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">Connect {clientName}</h1>
          <p className="text-xs text-muted-foreground">
            {clientName} is asking to use Glance as you. It will be able to call the MCP tools your account
            has access to.
          </p>
        </div>
        {scopes.length > 0 && (
          <div className="rounded-md border border-border bg-background/40 p-3 space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Requested access</div>
            <ul className="text-xs text-foreground list-disc list-inside">
              {scopes.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-md bg-primary text-primary-foreground text-sm font-medium py-2 hover:opacity-90 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 rounded-md border border-border text-sm font-medium py-2 hover:bg-muted disabled:opacity-50"
          >
            Deny
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          You can revoke this at any time from your account settings.
        </p>
      </div>
    </main>
  );
}

// Re-export helper used by Login to consume ?next= safely.
export { isSameOriginRelative };
