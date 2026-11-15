import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { SITE_URL } from "./src/lib/site";

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
      // The build writes dist/client/sitemap.xml from the prerendered pages. The crawl finds /how-it-works and /install.
      sitemap: {
        enabled: true,
        host: SITE_URL,
      },
      // GitHub Pages serves 404.html for each unknown path, so the build writes the /404 route to that file.
      // The 404 page is not in the sitemap.
      pages: [
        { path: "/" },
        { path: "/404", prerender: { enabled: true, outputPath: "/404.html" }, sitemap: { exclude: true } },
      ],
    }),
    viteReact(),
  ],
});
