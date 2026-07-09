import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  css: {
    // Do not inherit the parent repo's tailwind/postcss config.
    postcss: { plugins: [] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
