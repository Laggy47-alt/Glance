import { useSyncExternalStore } from "react";
import { mqttStore } from "@/lib/mqttStore";

export function useMqttStore() {
  useSyncExternalStore(
    (l) => mqttStore.subscribe(l),
    () => mqttStore.messages.length + ":" + mqttStore.status + ":" + mqttStore.rules.length + ":" + mqttStore.subscriptions.length + ":" + (mqttStore.error ?? ""),
    () => "0::"
  );
  return mqttStore;
}
