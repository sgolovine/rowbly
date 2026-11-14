import { defineConfig } from "tsup";

export default defineConfig({
  // The Pi worker is a second entry, so that `dist/pi-worker.js` is next to `dist/cli.js` and its chunks.
  entry: { cli: "src/cli.ts", "pi-worker": "src/services/pi-runtime/pi-worker.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  external: ["@earendil-works/pi-coding-agent"],
  banner: { js: "#!/usr/bin/env node" },
});
