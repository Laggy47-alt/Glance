import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TZ = "Africa/Johannesburg";
// How many minutes after a scheduled boundary we still consider it "fresh"
// and should assert it. Keeps things robust against a missed cron tick, but
// short enough that a customer manual toggle a few minutes later sticks.
const BOUNDARY_GRACE_MIN = 2;

function nowInSast(): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = dayMap[map.weekday] ?? 0;
  const h = parseInt(map.hour, 10);
  const m = parseInt(map.minute, 10);
  return { weekday, minutes: h * 60 + m };
}

function timeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

type Schedule = {
  instance_id: string;
  camera: string;
  weekday: number;
  arm_time: string | null;
  disarm_time: string | null;
  enabled: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { weekday, minutes } = nowInSast();

  const { data: scheds, error } = await supabase
    .from("camera_arm_schedules")
    .select("instance_id,camera,weekday,arm_time,disarm_time,enabled")
    .eq("enabled", true)
    .eq("weekday", weekday);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // For each (instance, camera) pick the most recent boundary in [now - GRACE, now].
  // If there's no boundary in that window, do nothing — manual toggles win between boundaries.
  type Decision = { action: "arm" | "disarm"; boundaryMin: number };
  const decisions = new Map<string, Decision>();

  for (const s of (scheds ?? []) as Schedule[]) {
    const k = `${s.instance_id}::${s.camera}`;
    const armM = timeToMinutes(s.arm_time);
    const disarmM = timeToMinutes(s.disarm_time);
    const candidates: Array<{ action: "arm" | "disarm"; min: number }> = [];
    if (armM !== null && minutes >= armM && minutes - armM <= BOUNDARY_GRACE_MIN) {
      candidates.push({ action: "arm", min: armM });
    }
    if (disarmM !== null && minutes >= disarmM && minutes - disarmM <= BOUNDARY_GRACE_MIN) {
      candidates.push({ action: "disarm", min: disarmM });
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.min - a.min);
    const latest = candidates[0];
    const existing = decisions.get(k);
    if (!existing || latest.min > existing.boundaryMin) {
      decisions.set(k, { action: latest.action, boundaryMin: latest.min });
    }
  }

  if (decisions.size === 0) {
    return new Response(JSON.stringify({ ok: true, applied: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const keys = Array.from(decisions.keys());
  const instIds = Array.from(new Set(keys.map((k) => k.split("::")[0])));

  const [{ data: armedRows }, { data: runRows }] = await Promise.all([
    supabase.from("camera_armed_state").select("instance_id,camera,armed").in("instance_id", instIds),
    supabase.from("camera_arm_schedule_runs").select("instance_id,camera,last_action,last_run_at").in("instance_id", instIds),
  ]);

  const armedMap = new Map<string, boolean>();
  for (const r of armedRows ?? []) armedMap.set(`${r.instance_id}::${r.camera}`, r.armed);
  const lastRunMap = new Map<string, { action: string; at: string }>();
  for (const r of runRows ?? []) lastRunMap.set(`${r.instance_id}::${r.camera}`, { action: r.last_action, at: r.last_run_at });

  const armedUpserts: any[] = [];
  const runUpserts: any[] = [];
  const auditInserts: any[] = [];
  let applied = 0;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  for (const [k, d] of decisions) {
    const wantArmed = d.action === "arm";
    const lastRun = lastRunMap.get(k);
    // Only fire once per boundary: skip if we've already recorded this exact
    // action within the last 10 minutes (covers the grace window plus retries).
    if (lastRun && lastRun.action === d.action) {
      const ageMin = (Date.now() - new Date(lastRun.at).getTime()) / 60000;
      if (ageMin < 10) continue;
    }
    const [instance_id, camera] = k.split("::");
    armedUpserts.push({ instance_id, camera, armed: wantArmed, updated_by: null });
    runUpserts.push({ instance_id, camera, last_action: d.action, last_run_at: new Date().toISOString() });
    auditInserts.push({
      instance_id, camera, action: d.action, source: "schedule",
      actor: null, actor_name: "schedule",
      note: `Auto ${d.action} at scheduled boundary`,
    });
    applied++;
  }

  if (armedUpserts.length) {
    const { error: e1 } = await supabase
      .from("camera_armed_state")
      .upsert(armedUpserts, { onConflict: "instance_id,camera" });
    if (e1) {
      return new Response(JSON.stringify({ error: e1.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { error: e2 } = await supabase
      .from("camera_arm_schedule_runs")
      .upsert(runUpserts, { onConflict: "instance_id,camera" });
    if (e2) {
      return new Response(JSON.stringify({ error: e2.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (auditInserts.length) {
      await supabase.from("camera_arm_audit").insert(auditInserts);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, applied, considered: decisions.size }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
