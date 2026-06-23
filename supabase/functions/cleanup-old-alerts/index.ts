// Deletes alerts older than RETENTION_DAYS (default 60) from media_items,
// webhook_events, and unifi_events. Runs nightly via pg_cron.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const days = Number(Deno.env.get("RETENTION_DAYS") ?? 60);
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const results: Record<string, number | string> = { cutoff, days };

  for (const table of ["media_items", "webhook_events", "unifi_events"]) {
    try {
      const { error, count } = await supabase
        .from(table)
        .delete({ count: "exact" })
        .lt("ts", cutoff);
      results[table] = error ? `error: ${error.message}` : (count ?? 0);
    } catch (e) {
      results[table] = `error: ${(e as Error).message}`;
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
