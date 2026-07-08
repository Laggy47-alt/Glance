import { App } from "@capacitor/app";
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
  scanBtn: $("scanBtn") as HTMLButtonElement,
  manualBtn: $("manualBtn") as HTMLButtonElement,
  unpairBtn: $("unpairBtn") as HTMLButtonElement,
  ackBtn: $("ackBtn") as HTMLButtonElement,
  arriveBtn: $("arriveBtn") as HTMLButtonElement,
  completeBtn: $("completeBtn") as HTMLButtonElement,
  statusDot: $("statusDot"),
  statusText: $("statusText"),
  dispatchText: $("dispatchText"),
  siteText: $("siteText"),
  lastPing: $("lastPing"),
  log: $("log"),
};

let pairing: Pairing | null = null;
let currentDispatchId: string | null = null;
let pollTimer: number | null = null;
let lastPingAt = 0;

function log(msg: string) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  els.log.textContent = (line + "\n" + (els.log.textContent ?? "")).split("\n").slice(0, 30).join("\n");
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
      currentDispatchId = res.dispatch.id;
      els.dispatchText.textContent = `${res.dispatch.priority ?? "—"} · ${res.dispatch.status}`;
      els.siteText.textContent = res.dispatch.site_name ?? "—";
      if (res.tracking) {
        setStatus("on", "Tracking");
        if (!isTracking()) {
          await startTracking(pairing, (t) => { lastPingAt = t; render(); });
          log("started GPS tracking");
        }
      } else {
        setStatus("warn", res.dispatch.status);
        if (isTracking()) { await stopTracking(); log("stopped GPS tracking"); }
      }
    } else {
      currentDispatchId = null;
      els.dispatchText.textContent = "—";
      els.siteText.textContent = "—";
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
  pollOnce();
}

async function doAction(action: "acknowledge" | "arrive" | "complete" | "cancel") {
  if (!pairing) return;
  try {
    await api.state(pairing, action, currentDispatchId ?? undefined);
    log(`action: ${action}`);
    pollOnce();
  } catch (e: any) {
    log(`action ${action} failed: ${e?.message ?? e}`);
  }
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

els.ackBtn.addEventListener("click", () => doAction("acknowledge"));
els.arriveBtn.addEventListener("click", () => doAction("arrive"));
els.completeBtn.addEventListener("click", () => doAction("complete"));

App.addListener("resume", () => { if (pairing) pollOnce(); });

(async function boot() {
  pairing = await getPairing();
  render();
  if (pairing) pollOnce();
})();
