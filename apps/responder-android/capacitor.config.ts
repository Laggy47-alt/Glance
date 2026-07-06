import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.glance.responder",
  appName: "Glance Responder",
  webDir: "dist",
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
