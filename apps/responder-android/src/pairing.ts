import { BarcodeScanner } from "@capacitor-mlkit/barcode-scanning";
import type { Pairing } from "./storage";

// Expected QR payload (JSON):
// { "endpoint": "https://host/functions/v1", "anon_key": "...", "token": "...",
//   "responder_id": "uuid", "responder_name": "Alice" }
export function parsePayload(raw: string): Pairing | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj.endpoint || !obj.anon_key || !obj.token) return null;
    return obj as Pairing;
  } catch {
    return null;
  }
}

export async function scanQR(): Promise<Pairing | null> {
  const perm = await BarcodeScanner.requestPermissions();
  if (perm.camera !== "granted" && perm.camera !== "limited") throw new Error("Camera permission denied");
  const { barcodes } = await BarcodeScanner.scan({ formats: ["QR_CODE" as any] });
  if (!barcodes.length) return null;
  return parsePayload(barcodes[0].rawValue ?? "");
}
