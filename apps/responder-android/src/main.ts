import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { api } from "./api";
import { scanQR, parsePayload } from "./pairing";
import { clearPairing, getPairing, setPairing, type Pairing } from "./storage";
import { ensureLocationPermission, isTracking, startTracking, stopTracking } from "./tracker";

const $ = (id: string) => document.getElementById(id)!;

const els = {
  deviceLabel: $("deviceLabel"),
  pairView: $("pairView"),
  statusView: $("statusView"),
  actionsView: $("actionsView"),
  alertView: $("alertView"),
  alertLabel: $("alertLabel"),
  alertMeta: $("alertMeta"),
  alertSnapshot: $("alertSnapshot") as HTMLImageElement,
  scanBtn: $("scanBtn") as HTMLButtonElement,
  manualBtn: $("manualBtn") as HTMLButtonElement,
  unpairBtn: $("unpairBtn") as HTMLButtonElement,
  statusDot: $("statusDot"),
  statusText: $("statusText"),
  dispatchText: $("dispatchText"),
  siteText: $("siteText"),
  lastPing: $("lastPing"),
  log: $("log"),
};

let pairing: Pairing | null = null;
let currentDispatchId: string | null = null;
let lastNotifiedKey: string | null = null;
let pollTimer: number | null = null;
let lastPingAt = 0;
let notifPermission = false;

async function ensureNotifPermission(): Promise<boolean> {
  try {
    const state = await LocalNotifications.checkPermissions();
    if (state.display === "granted") { notifPermission = true; return true; }
    const req = await LocalNotifications.requestPermissions();
    notifPermission = req.display === "granted";
    return notifPermission;
  } catch {
    return false;
  }
}

async function notifyDispatch(title: string, body: string) {
  if (!notifPermission && !(await ensureNotifPermission())) return;
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: Math.floor(Math.random() * 2_147_483_000),
        title,
        body,
        schedule: { at: new Date(Date.now() + 200) },
      }],
    });
  } catch (e: any) {
    log(`notify failed: ${e?.message ?? e}`);
  }
}

function log(msg: string) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  els.log.textContent = (line + "\n" + (els.log.textContent ?? "")).split("\n").slice(0, 30).join("\n");
}

function renderAlert(payload: any | null | undefined) {
  if (!payload || (!payload.label && !payload.snapshot_url && !payload.camera)) {
    els.alertView.classList.add("hidden");
    els.alertSnapshot.style.display = "none";
    els.alertSnapshot.src = "";
    return;
  }
  els.alertView.classList.remove("hidden");
  els.alertLabel.textContent = payload.label ?? payload.camera ?? "Alert";
  const parts: string[] = [];
  if (payload.site) parts.push(payload.site);
  if (payload.camera) parts.push(payload.camera);
  if (payload.ts) {
    try { parts.push(new Date(payload.ts).toLocaleString()); } catch { /* ignore */ }
  }
  els.alertMeta.textContent = parts.join(" · ") || "—";
  if (payload.snapshot_url) {
    els.alertSnapshot.onload = () => log(`snapshot loaded`);
    els.alertSnapshot.onerror = () => {
      log(`snapshot failed to load: ${payload.snapshot_url}`);
      els.alertSnapshot.style.display = "none";
    };
    els.alertSnapshot.src = payload.snapshot_url;
    els.alertSnapshot.style.display = "block";
  } else {
    els.alertSnapshot.style.display = "none";
    els.alertSnapshot.src = "";
  }
}

function render() {
  els.pairView.classList.toggle("hidden", !!pairing);
  els.statusView.classList.toggle("hidden", !pairing);
  els.actionsView.classList.toggle("hidden", !pairing || !currentDispatchId);
  els.deviceLabel.textContent = pairing
    ? `Paired · ${pairing.responder_name ?? "responder"}`
    : "Not paired";
  els.lastPing.textContent = lastPingAt ? new Date(lastPingAt).toLocaleTimeString() : "—";
}

function setStatus(cls: "on" | "warn" | "err" | "", text: string) {
  els.statusDot.className = `status-dot ${cls}`;
  els.statusText.textContent = text;
}

async function pollOnce() {
  if (!pairing) return;
  try {
    const res = await api.poll(pairing);
    if (res.dispatch) {
      const d = res.dispatch;
      const key = `${d.id}:${d.status}`;
      // Notify on new dispatch id or status transition into pending/en_route.
      if (key !== lastNotifiedKey && (d.status === "pending" || d.status === "en_route")) {
        const isNew = currentDispatchId !== d.id;
        const title = isNew
          ? `🚨 New dispatch · ${d.priority ?? "normal"}`
          : `Dispatch · ${d.status.replace(/_/g, " ")}`;
        const ap = d.alert_payload;
        const body = ap?.label
          ? `${d.site_name ?? "Site"} — ${ap.label}`
          : `${d.site_name ?? "Site"}${ap?.camera ? ` · ${ap.camera}` : ""}`;
        void notifyDispatch(title, body);
        lastNotifiedKey = key;
      }
      currentDispatchId = d.id;
      els.dispatchText.textContent = `${d.priority ?? "—"} · ${d.status}`;
      els.siteText.textContent = d.site_name ?? "—";
      renderAlert(d.alert_payload);
      if (res.tracking) {
        setStatus("on", "Tracking");
        if (!isTracking()) {
          await startTracking(
            pairing,
            (t) => { lastPingAt = t; render(); },
            (message) => log(`GPS ping failed: ${message}`),
          );
          log("started GPS tracking");
        }
      } else {
        setStatus("warn", d.status);
        if (isTracking()) { await stopTracking(); log("stopped GPS tracking"); }
      }
    } else {
      currentDispatchId = null;
      lastNotifiedKey = null;
      els.dispatchText.textContent = "—";
      els.siteText.textContent = "—";
      renderAlert(null);
      setStatus("", "Idle");
      if (isTracking()) { await stopTracking(); log("no active dispatch, stopped GPS"); }
    }
    render();
    schedulePoll(res.interval_ms);
  } catch (e: any) {
    setStatus("err", e?.message ?? "poll failed");
    log(`poll error: ${e?.message ?? e}`);
    schedulePoll(15000);
  }
}

function schedulePoll(ms: number) {
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(pollOnce, ms);
}

async function onPair(p: Pairing) {
  await setPairing(p);
  pairing = p;
  log(`paired as ${p.responder_name ?? p.responder_id ?? "responder"}`);
  render();
  // Prompt for location up-front so it's granted before a dispatch arrives.
  try {
    const ok = await ensureLocationPermission();
    log(ok ? "location permission granted" : "location permission denied");
  } catch (e: any) {
    log(`location prompt error: ${e?.message ?? e}`);
  }
  // Prompt for notification permission so we can alert the responder on dispatch.
  try {
    const ok = await ensureNotifPermission();
    log(ok ? "notifications enabled" : "notifications denied");
  } catch (e: any) {
    log(`notif prompt error: ${e?.message ?? e}`);
  }
  pollOnce();
}




els.scanBtn.addEventListener("click", async () => {
  try {
    const p = await scanQR();
    if (!p) { log("scan cancelled or invalid QR"); return; }
    await onPair(p);
  } catch (e: any) {
    log(`scan error: ${e?.message ?? e}`);
  }
});

els.manualBtn.addEventListener("click", async () => {
  const raw = prompt("Paste pairing JSON:");
  if (!raw) return;
  const p = parsePayload(raw);
  if (!p) { alert("Invalid pairing payload"); return; }
  await onPair(p);
});

els.unpairBtn.addEventListener("click", async () => {
  if (!confirm("Unpair this device?")) return;
  await stopTracking();
  await clearPairing();
  pairing = null;
  currentDispatchId = null;
  render();
  log("unpaired");
});

App.addListener("resume", () => { if (pairing) pollOnce(); });

(async function boot() {
  pairing = await getPairing();
  render();
  if (pairing) pollOnce();
})();
