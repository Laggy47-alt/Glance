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
      ":" + (webhookStore.loaded ? "1" : "0") +
      ":" + (webhookStore.error ?? "") +
      ":" + webhookStore.events.map((e) => `${e.id}${e.read ? 1 : 0}`).join(","),
    () => "0"
  );
  return webhookStore;
}
