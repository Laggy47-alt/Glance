import { useSyncExternalStore } from "react";
import { webhookStore } from "@/lib/webhookStore";

export function useWebhookStore(enabled = true) {
  useSyncExternalStore(
    (l) => enabled ? webhookStore.subscribe(l) : () => undefined,
    () =>
      webhookStore.sources.length +
      ":" + webhookStore.events.length +
      ":" + webhookStore.media.length +
      ":" + webhookStore.rules.length +
      ":" + webhookStore.frigates.length +
      ":" + (webhookStore.loaded ? "1" : "0") +
      ":" + (webhookStore.error ?? "") +
      ":" + webhookStore.events.map((e) => `${e.id}${e.read ? 1 : 0}${e.archived ? 1 : 0}`).join(",") +
      ":" + webhookStore.media.map((m) => `${m.id}${m.archived ? 1 : 0}`).join(",") +
      ":" + webhookStore.frigates.map((f) => `${f.id}${f.name}${f.base_url}${f.api_key ?? ""}${f.auth_username ?? ""}${f.color}${f.is_local ? 1 : 0}${f.enabled ? 1 : 0}${f.poll_enabled ? 1 : 0}${f.poll_interval_seconds}${f.last_polled_at ?? ""}${f.mute_enabled ? 1 : 0}${f.mute_start ?? ""}${f.mute_end ?? ""}`).join(",") +
      ":" + webhookStore.hikvisions.map((h) => `${h.id}${h.name}${h.enabled ? 1 : 0}${h.last_seen_at ?? ""}${h.last_event_ts ?? ""}`).join(",") +
      ":" + webhookStore.unifis.map((u) => `${u.id}${u.name}${u.enabled ? 1 : 0}${u.last_seen_at ?? ""}${u.last_event_ts ?? ""}${u.color}`).join(","),

    () => "0"
  );
  return webhookStore;
}
