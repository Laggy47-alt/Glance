import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TZ = "Africa/Johannesburg";

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
  organization_id: string;
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

  const { weekday: todayDow, minutes: nowMin } = nowInSast();

  // Pull ALL enabled schedules — we need to scan boundaries from prior days too
  // (e.g. Friday's "disarm 17:00" should keep cameras disarmed all Saturday
  // until Monday's "arm 08:00" boundary if nothing else intervenes).
  const { data: scheds, error } = await supabase
    .from("camera_arm_schedules")
    .select("organization_id,instance_id,camera,weekday,arm_time,disarm_time,enabled")
    .eq("enabled", true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Group schedules per (instance, camera)
  type Boundary = { action: "arm" | "disarm"; weekday: number; min: number };
  const grouped = new Map<string, { orgId: string; boundaries: Boundary[] }>();
  for (const s of (scheds ?? []) as Schedule[]) {
    const k = `${s.instance_id}::${s.camera}`;
    const armM = timeToMinutes(s.arm_time);
    const disarmM = timeToMinutes(s.disarm_time);
    if (!grouped.has(k)) grouped.set(k, { orgId: s.organization_id, boundaries: [] });
    const g = grouped.get(k)!;
    if (armM !== null) g.boundaries.push({ action: "arm", weekday: s.weekday, min: armM });
    if (disarmM !== null) g.boundaries.push({ action: "disarm", weekday: s.weekday, min: disarmM });
  }

  // For each camera, find the MOST RECENT boundary at-or-before "now" within
  // the last 7 days. That boundary's action is the desired current state.
  // "minutesAgo" = how long ago that boundary occurred, walking backwards
  // through the week. 0 means it just happened now.
  type Decision = { action: "arm" | "disarm"; orgId: string; minutesAgo: number };
  const decisions = new Map<string, Decision>();

  for (const [k, { orgId, boundaries }] of grouped) {
    let best: { action: "arm" | "disarm"; minutesAgo: number } | null = null;
    for (const b of boundaries) {
      // How many days back from today is b.weekday? 0 = today, 1 = yesterday, ...
      let dayDelta = (todayDow - b.weekday + 7) % 7;
      let minutesAgo: number;
      if (dayDelta === 0) {
        if (b.min <= nowMin) {
          minutesAgo = nowMin - b.min;
        } else {
          // Boundary is later today — treat as last week's occurrence
          dayDelta = 7;
          minutesAgo = dayDelta * 1440 + (nowMin - b.min);
        }
      } else {
        minutesAgo = dayDelta * 1440 + (nowMin - b.min);
      }
      if (minutesAgo < 0) continue;
      if (!best || minutesAgo < best.minutesAgo) {
        best = { action: b.action, minutesAgo };
      }
    }
    if (best) decisions.set(k, { action: best.action, orgId, minutesAgo: best.minutesAgo });
  }

  if (decisions.size === 0) {
    return new Response(JSON.stringify({ ok: true, applied: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const keys = Array.from(decisions.keys());
  const instIds = Array.from(new Set(keys.map((k) => k.split("::")[0])));

  const { data: armedRows } = await supabase
    .from("camera_armed_state")
    .select("instance_id,camera,armed")
    .in("instance_id", instIds);

  const armedMap = new Map<string, boolean>();
  for (const r of armedRows ?? []) armedMap.set(`${r.instance_id}::${r.camera}`, r.armed);

  const armedUpserts: any[] = [];
  const runUpserts: any[] = [];
  const auditInserts: any[] = [];
  let applied = 0;

  for (const [k, d] of decisions) {
    const wantArmed = d.action === "arm";
    const currentArmed = armedMap.get(k);
    // Only write when state actually changes — this keeps manual toggles that
    // happen to match the schedule from generating noise, but still enforces
    // the schedule continuously (a manual override that contradicts the
    // schedule is corrected on the next run).
    if (currentArmed === wantArmed) continue;

    const [instance_id, camera] = k.split("::");
    armedUpserts.push({ organization_id: d.orgId, instance_id, camera, armed: wantArmed, updated_by: null });
    runUpserts.push({ organization_id: d.orgId, instance_id, camera, last_action: d.action, last_run_at: new Date().toISOString() });
    auditInserts.push({
      organization_id: d.orgId,
      instance_id, camera, action: d.action, source: "schedule",
      actor: null, actor_name: "schedule",
      note: `Auto ${d.action} enforced by schedule`,
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
