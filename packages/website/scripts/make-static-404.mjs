// Removes the client scripts from dist/client/404.html, so that the 404 page is static HTML.
// GitHub Pages serves 404.html for each unknown path. The page was prerendered for the /404 route, so React
// cannot hydrate it at a different URL. Without the scripts, the page shows the same HTML, CSS and fonts.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script>/g;
const MODULE_PRELOAD = /<link\b[^>]*\brel="modulepreload"[^>]*\/?>/g;

/** Gives the HTML without its script elements and module preload links. */
function removeClientScripts(html) {
  return html.replace(SCRIPT, "").replace(MODULE_PRELOAD, "");
}

const path = fileURLToPath(new URL("../dist/client/404.html", import.meta.url));

writeFileSync(path, removeClientScripts(readFileSync(path, "utf8")));
