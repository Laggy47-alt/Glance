import { useSyncExternalStore } from "react";
import { webhookStore } from "@/lib/webhookStore";

export function useWebhookStore() {
  useSyncExternalStore(
    (l) => webhookStore.subscribe(l),
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
      ":" + webhookStore.frigates.map((f) => `${f.id}${f.name}${f.base_url}${f.api_key ?? ""}${f.color}${f.is_local ? 1 : 0}${f.enabled ? 1 : 0}${f.poll_enabled ? 1 : 0}${f.poll_interval_seconds}${f.last_polled_at ?? ""}${f.mute_enabled ? 1 : 0}${f.mute_start ?? ""}${f.mute_end ?? ""}`).join(","),
    () => "0"
  );
  return webhookStore;
}
