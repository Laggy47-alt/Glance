import { frigateUrl, type FrigateInstance } from "@/lib/webhookStore";

type StatsInstance = Pick<FrigateInstance, "id" | "base_url" | "is_local">;

const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { at: number; data: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

export async function fetchFrigateStats(instance: StatsInstance) {
  const url = frigateUrl(instance, "/api/stats");
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const existing = inFlight.get(url);
  if (existing) return existing;

  const request = fetch(url, { headers: { accept: "application/json" }, cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body ? `HTTP ${res.status}: ${body}` : `HTTP ${res.status}`);
      }
      const data = await res.json();
      cache.set(url, { at: Date.now(), data });
      return data;
    })
    .finally(() => inFlight.delete(url));

  inFlight.set(url, request);
  return request;
}