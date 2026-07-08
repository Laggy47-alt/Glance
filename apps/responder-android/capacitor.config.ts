import type { CapacitorConfig } from "@capacitor/cli";

// Point this at wherever you host the built responder web bundle.
// The APK will load its UI from here on every launch, so any change you
// push to this URL is picked up without rebuilding/reinstalling the APK.
// Set RESPONDER_SERVER_URL when running `npm run build` to override.
const REMOTE_URL =
  process.env.RESPONDER_SERVER_URL ?? "https://responder.abcglance.co.za";

const config: CapacitorConfig = {
  appId: "app.glance.responder",
  appName: "Glance Responder",
  webDir: "dist",
  server: {
    url: REMOTE_URL,
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    Geolocation: {
      // handled at runtime
    },
  },
};

export default config;

