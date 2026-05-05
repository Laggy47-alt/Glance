import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TZ = "Africa/Johannesburg";

// Returns { weekday: 0..6 (Sun=0), hhmm: "HH:MM" } in SAST
function nowInSast(): { weekday: number; hhmm: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = dayMap[map.weekday] ?? 0;
  const h = parseInt(map.hour, 10);
  const m = parseInt(map.minute, 10);
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return { weekday, hhmm: `${hh}:${mm}`, minutes: h * 60 + m };
}

function timeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

type Schedule = {
  user_id: string;
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

  // Pull every enabled schedule for today + all cameras that have ANY schedule at all.
  const [{ data: scheds, error }, { data: allScheds, error: e0 }] = await Promise.all([
    supabase
      .from("camera_arm_schedules")
      .select("user_id,instance_id,camera,weekday,arm_time,disarm_time,enabled")
      .eq("enabled", true)
      .eq("weekday", weekday),
    supabase
      .from("camera_arm_schedules")
      .select("instance_id,camera")
      .eq("enabled", true),
  ]);

  if (error || e0) {
    return new Response(JSON.stringify({ error: (error || e0)!.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cameras that have at least one enabled schedule (any day)
  const scheduledCams = new Set<string>();
  for (const r of allScheds ?? []) scheduledCams.add(`${r.instance_id}::${r.camera}`);

  // For each (instance, camera) determine the LATEST boundary that has been
  // crossed today across all customer schedules. "Schedule always wins" = we
  // simply re-assert that state every minute while past the boundary.
  type Decision = { action: "arm" | "disarm"; boundaryMin: number };
  const decisions = new Map<string, Decision>(); // key = `${inst}::${cam}`

  for (const s of (scheds ?? []) as Schedule[]) {
    const k = `${s.instance_id}::${s.camera}`;
    const armM = timeToMinutes(s.arm_time);
    const disarmM = timeToMinutes(s.disarm_time);

    const candidates: Array<{ action: "arm" | "disarm"; min: number }> = [];
    if (armM !== null && minutes >= armM) candidates.push({ action: "arm", min: armM });
    if (disarmM !== null && minutes >= disarmM) candidates.push({ action: "disarm", min: disarmM });
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.min - a.min);
    const latest = candidates[0];

    const existing = decisions.get(k);
    if (!existing || latest.min > existing.boundaryMin) {
      decisions.set(k, { action: latest.action, boundaryMin: latest.min });
    }
  }

  // Re-arm any camera that is currently disarmed but has NO enabled schedule.
  // "No schedule = always armed."
  const { data: disarmedRows } = await supabase
    .from("camera_armed_state")
    .select("instance_id,camera,armed")
    .eq("armed", false);
  for (const r of disarmedRows ?? []) {
    const k = `${r.instance_id}::${r.camera}`;
    if (!scheduledCams.has(k) && !decisions.has(k)) {
      decisions.set(k, { action: "arm", boundaryMin: -1 });
    }
  }

  if (decisions.size === 0) {
    return new Response(JSON.stringify({ ok: true, applied: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load existing armed state + last-run markers so we only write on change.
  const keys = Array.from(decisions.keys());
  const instIds = Array.from(new Set(keys.map((k) => k.split("::")[0])));

  const [{ data: armedRows }, { data: runRows }] = await Promise.all([
    supabase.from("camera_armed_state").select("instance_id,camera,armed").in("instance_id", instIds),
    supabase.from("camera_arm_schedule_runs").select("instance_id,camera,last_action").in("instance_id", instIds),
  ]);

  const armedMap = new Map<string, boolean>();
  for (const r of armedRows ?? []) armedMap.set(`${r.instance_id}::${r.camera}`, r.armed);
  const lastActionMap = new Map<string, string>();
  for (const r of runRows ?? []) lastActionMap.set(`${r.instance_id}::${r.camera}`, r.last_action);

  const armedUpserts: any[] = [];
  const runUpserts: any[] = [];
  let applied = 0;

  for (const [k, d] of decisions) {
    const wantArmed = d.action === "arm";
    const isArmed = armedMap.get(k);
    const lastAction = lastActionMap.get(k);
    // Apply if state mismatches OR we haven't recorded this action yet today
    if (isArmed === wantArmed && lastAction === d.action) continue;
    const [instance_id, camera] = k.split("::");
    armedUpserts.push({ instance_id, camera, armed: wantArmed, updated_by: null });
    runUpserts.push({ instance_id, camera, last_action: d.action, last_run_at: new Date().toISOString() });
    applied++;
  }

  if (armedUpserts.length) {
    const { error: e1 } = await supabase
      .from("camera_armed_state")
      .upsert(armedUpserts, { onConflict: "instance_id,camera" });
    if (e1) {
      return new Response(JSON.stringify({ error: e1.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { error: e2 } = await supabase
      .from("camera_arm_schedule_runs")
      .upsert(runUpserts, { onConflict: "instance_id,camera" });
    if (e2) {
      return new Response(JSON.stringify({ error: e2.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, applied, considered: decisions.size }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
