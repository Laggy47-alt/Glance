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
      ":" + webhookStore.events.map((e) => `${e.id}${e.read ? 1 : 0}`).join(",") +
      ":" + webhookStore.frigates.map((f) => `${f.id}${f.enabled ? 1 : 0}${f.poll_enabled ? 1 : 0}${f.last_polled_at ?? ""}${f.mute_enabled ? 1 : 0}${f.mute_start ?? ""}${f.mute_end ?? ""}`).join(","),
    () => "0"
  );
  return webhookStore;
}
