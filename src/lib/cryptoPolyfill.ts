/**
 * Polyfill for `crypto.randomUUID` and `crypto.getRandomValues`.
 *
 * `crypto.randomUUID` is only exposed by browsers in a **secure context**
 * (HTTPS or http://localhost). When the app is self-hosted over plain HTTP
 * on a LAN IP (e.g. http://192.168.1.20), `window.crypto` exists but
 * `randomUUID` is undefined, which breaks Supabase JS and other libs.
 *
 * This file installs safe fallbacks at module load time. Import it once at
 * the very top of `main.tsx`.
 */

(() => {
  const g: any = globalThis as any;
  if (!g.crypto) g.crypto = {};
  const c = g.crypto;

  // getRandomValues fallback (Math.random — NOT cryptographically secure,
  // but enough to keep UI libs from crashing in non-secure contexts).
  if (typeof c.getRandomValues !== "function") {
    c.getRandomValues = function <T extends ArrayBufferView | null>(buf: T): T {
      if (!buf) return buf;
      const view = buf as unknown as { length: number; [i: number]: number };
      for (let i = 0; i < view.length; i++) {
        view[i] = Math.floor(Math.random() * 256);
      }
      return buf;
    };
  }

  if (typeof c.randomUUID !== "function") {
    c.randomUUID = function (): string {
      // RFC4122 v4 UUID using getRandomValues (which we just guaranteed).
      const bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
      const hex: string[] = [];
      for (let i = 0; i < 256; i++) hex.push((i + 0x100).toString(16).slice(1));
      return (
        hex[bytes[0]] + hex[bytes[1]] + hex[bytes[2]] + hex[bytes[3]] + "-" +
        hex[bytes[4]] + hex[bytes[5]] + "-" +
        hex[bytes[6]] + hex[bytes[7]] + "-" +
        hex[bytes[8]] + hex[bytes[9]] + "-" +
        hex[bytes[10]] + hex[bytes[11]] + hex[bytes[12]] +
        hex[bytes[13]] + hex[bytes[14]] + hex[bytes[15]]
      );
    };
  }
})();

export {};
