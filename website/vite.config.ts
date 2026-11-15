import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The site is served at the root of https://rowbly.com, so the base path is "/".
// Prerendering writes plain static files to dist/client/ for GitHub Pages.
export default defineConfig({
  base: "/",
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      router: {
        // This path is relative to the source folder, so the file is src/route-tree.gen.ts (a dash-case name).
        generatedRouteTree: "./route-tree.gen.ts",
      },
      prerender: {
        enabled: true,
        crawlLinks: true,
      },
    }),
    viteReact(),
  ],
});
