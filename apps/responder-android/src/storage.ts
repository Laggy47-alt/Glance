import { Preferences } from "@capacitor/preferences";

export interface Pairing {
  endpoint: string; // e.g. https://host/functions/v1
  anon_key: string;
  token: string;
  responder_id?: string;
  responder_name?: string;
}

const KEY = "glance.pairing";

export async function getPairing(): Promise<Pairing | null> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return null;
  try { return JSON.parse(value) as Pairing; } catch { return null; }
}

export async function setPairing(p: Pairing): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(p) });
}

export async function clearPairing(): Promise<void> {
  await Preferences.remove({ key: KEY });
}
