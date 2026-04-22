import mqtt, { MqttClient } from "mqtt";

export type MqttMessage = {
  id: string;
  topic: string;
  payload: string;
  ts: number;
  read: boolean;
  archived: boolean;
};

export type AutoReadRule = {
  id: string;
  pattern: string; // MQTT topic pattern, supports + and #
  enabled: boolean;
};

export type ConnectionConfig = {
  host: string;
  port: number;
  path: string;
  secure: boolean;
  username?: string;
  password?: string;
  clientId: string;
  demoMode: boolean;
};

export type Status = "disconnected" | "connecting" | "connected" | "error";

type Listener = () => void;

const STORAGE_KEY = "mqtt-dashboard-state-v1";

interface PersistedState {
  config: ConnectionConfig;
  rules: AutoReadRule[];
  subscriptions: string[];
  messages: MqttMessage[];
}

const defaultConfig: ConnectionConfig = {
  host: "localhost",
  port: 9001,
  path: "/mqtt",
  secure: false,
  clientId: "dashboard-" + Math.random().toString(16).slice(2, 8),
  demoMode: true,
};

function topicMatches(pattern: string, topic: string): boolean {
  const p = pattern.split("/");
  const t = topic.split("/");
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "#") return true;
    if (p[i] === "+") {
      if (t[i] === undefined) return false;
      continue;
    }
    if (p[i] !== t[i]) return false;
  }
  return p.length === t.length;
}

class MqttStore {
  private client: MqttClient | null = null;
  private listeners = new Set<Listener>();
  private demoTimer: number | null = null;

  config: ConnectionConfig = defaultConfig;
  status: Status = "disconnected";
  error: string | null = null;
  messages: MqttMessage[] = [];
  rules: AutoReadRule[] = [
    { id: "r1", pattern: "sensors/+/heartbeat", enabled: true },
  ];
  subscriptions: string[] = ["#"];

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as PersistedState;
        this.config = { ...defaultConfig, ...s.config };
        this.rules = s.rules ?? this.rules;
        this.subscriptions = s.subscriptions ?? this.subscriptions;
        this.messages = (s.messages ?? []).slice(-500);
      }
    } catch {}
  }

  private save() {
    const s: PersistedState = {
      config: this.config,
      rules: this.rules,
      subscriptions: this.subscriptions,
      messages: this.messages.slice(-500),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {}
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    this.save();
    this.listeners.forEach((l) => l());
  }

  setConfig(cfg: Partial<ConnectionConfig>) {
    this.config = { ...this.config, ...cfg };
    this.emit();
  }

  setRules(rules: AutoReadRule[]) {
    this.rules = rules;
    this.emit();
  }

  setSubscriptions(subs: string[]) {
    const prev = this.subscriptions;
    this.subscriptions = subs;
    if (this.client && this.status === "connected") {
      prev.forEach((s) => !subs.includes(s) && this.client?.unsubscribe(s));
      subs.forEach((s) => !prev.includes(s) && this.client?.subscribe(s));
    }
    this.emit();
  }

  markRead(id: string, read = true) {
    this.messages = this.messages.map((m) => (m.id === id ? { ...m, read } : m));
    this.emit();
  }

  markAllRead() {
    this.messages = this.messages.map((m) => ({ ...m, read: true }));
    this.emit();
  }

  clearMessages() {
    this.messages = [];
    this.emit();
  }

  publish(topic: string, payload: string) {
    if (this.config.demoMode) {
      this.ingest(topic, payload);
      return;
    }
    this.client?.publish(topic, payload);
  }

  private ingest(topic: string, payload: string) {
    const matchedRule = this.rules.find(
      (r) => r.enabled && topicMatches(r.pattern, topic)
    );
    const msg: MqttMessage = {
      id: crypto.randomUUID(),
      topic,
      payload,
      ts: Date.now(),
      read: !!matchedRule,
      archived: !!matchedRule,
    };
    this.messages = [...this.messages, msg].slice(-500);
    this.emit();
  }

  connect() {
    this.disconnect();
    this.error = null;

    if (this.config.demoMode) {
      this.status = "connected";
      this.emit();
      this.startDemo();
      return;
    }

    this.status = "connecting";
    this.emit();

    try {
      const proto = this.config.secure ? "wss" : "ws";
      const url = `${proto}://${this.config.host}:${this.config.port}${this.config.path}`;
      const client = mqtt.connect(url, {
        clientId: this.config.clientId,
        username: this.config.username || undefined,
        password: this.config.password || undefined,
        reconnectPeriod: 4000,
        connectTimeout: 8000,
      });
      this.client = client;

      client.on("connect", () => {
        this.status = "connected";
        this.error = null;
        this.subscriptions.forEach((s) => client.subscribe(s));
        this.emit();
      });
      client.on("reconnect", () => {
        this.status = "connecting";
        this.emit();
      });
      client.on("error", (err) => {
        this.error = err.message;
        this.status = "error";
        this.emit();
      });
      client.on("close", () => {
        if (this.status === "connected") this.status = "disconnected";
        this.emit();
      });
      client.on("message", (topic, payload) => {
        this.ingest(topic, payload.toString());
      });
    } catch (e) {
      this.error = (e as Error).message;
      this.status = "error";
      this.emit();
    }
  }

  disconnect() {
    if (this.demoTimer) {
      clearInterval(this.demoTimer);
      this.demoTimer = null;
    }
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    this.status = "disconnected";
    this.emit();
  }

  private startDemo() {
    if (this.demoTimer) clearInterval(this.demoTimer);
    const topics = [
      "sensors/livingroom/temperature",
      "sensors/kitchen/humidity",
      "sensors/garage/door",
      "sensors/outdoor/heartbeat",
      "lights/hallway/state",
      "alerts/motion/frontdoor",
    ];
    this.demoTimer = window.setInterval(() => {
      const topic = topics[Math.floor(Math.random() * topics.length)];
      let payload: string;
      if (topic.includes("temperature")) payload = (18 + Math.random() * 8).toFixed(1) + "°C";
      else if (topic.includes("humidity")) payload = Math.round(35 + Math.random() * 30) + "%";
      else if (topic.includes("door")) payload = Math.random() > 0.5 ? "open" : "closed";
      else if (topic.includes("heartbeat")) payload = "ok";
      else if (topic.includes("state")) payload = Math.random() > 0.5 ? "on" : "off";
      else payload = "detected";
      this.ingest(topic, payload);
    }, 1800);
  }
}

export const mqttStore = new MqttStore();
export { topicMatches };
