// Checks that each file and folder that Git tracks has a dash-case name.
// Biome checks only the names of script files, so this script also checks folders, Markdown and HTML.
// Run it with `node scripts/check-names.mjs`. It prints each bad path and exits with code 1.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DASH_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Conventional meta files keep their uppercase names, for example `README.md`, `SKILL.md` and the GitHub Pages `CNAME`.
const META_FILES = new Set(["README", "AGENTS", "CLAUDE", "SKILL", "LICENSE", "UPSTREAM", "CHANGELOG", "CNAME"]);

// Paths that keep their names:
// - `.agents/skills/agentic-tui/` is an unchanged copy of an upstream skill.
// - `.rowbly/` is product data: stage keys (`IN_REVIEW.md`), story IDs (`ROW-01.md`) and prompts (`SYSTEM.md`).
// - `packages/cli/stages/*.md` are the default stage prompts, and each name is a stage key (`BACKLOG.md`).
// - `packages/cli/src/config/prompts/*.md` are the system prompts, with the names of the user prompts (`SYSTEM.md`).
const IGNORED_PATHS = [
  /^\.agents\/skills\/agentic-tui\//,
  /^\.rowbly\//,
  /^packages\/cli\/stages\/[^/]+\.md$/,
  /^packages\/cli\/src\/config\/prompts\/[^/]+\.md$/,
];

/** Gives the part of a name before its first dot. A dotfile or a dotfolder loses its first dot. */
function baseName(segment) {
  const name = segment.startsWith(".") ? segment.slice(1) : segment;

  return name.split(".")[0];
}

/** Tells if one segment of a path has a good name. Only the last segment of a path is a file. */
function isGoodSegment(segment, isFile) {
  const base = baseName(segment);

  if (isFile && META_FILES.has(base)) {
    return true;
  }

  return DASH_CASE.test(base);
}

// TanStack Router gives a meaning to some characters in the file and folder names of its file-based routes.
// Only the paths below this prefix can use these names. Each word in them is still dash-case.
const ROUTES_PREFIX = "packages/website/src/routes/";

const WORD = "[a-z0-9]+(?:-[a-z0-9]+)*";

// One dot-separated part of a route name:
// `$` (splat), `$name` (path parameter), `{-$name}` (optional path parameter),
// `_name` (pathless layout), `name_` (non-nested) and plain `name` (also `index`, `route` and `lazy`).
const ROUTE_PART = new RegExp(`^(?:\\$|(?:_|\\$|\\{-\\$)?${WORD}\\}?_?)$`);
const ROUTE_GROUP = new RegExp(`^\\(${WORD}\\)$`);

// An escaped character, for example `[.]` in `script[.]js.tsx`. The router uses the text in the brackets as it is.
const ESCAPE = /\[[^\]/]+\]/g;

/** Tells if one route part has a good name. A brace must open with `{-$` and close at the end of the name. */
function isGoodRoutePart(part) {
  if (!ROUTE_PART.test(part)) {
    return false;
  }

  return part.startsWith("{-$") === /\}_?$/.test(part);
}

/**
 * Tells if one segment of a path below `packages/website/src/routes/` has a good TanStack Router name.
 * Only the last segment of a path is a file. The check removes the extension of a file.
 */
export function isGoodRouteSegment(segment, isFile) {
  if (segment.startsWith(".")) {
    return isGoodSegment(segment, isFile);
  }
  // The router ignores a name that starts with `-`. The rest of the name obeys the usual rule.
  if (segment.startsWith("-")) {
    return isGoodSegment(segment.slice(1), isFile);
  }
  if (isFile && META_FILES.has(baseName(segment))) {
    return true;
  }
  if (!isFile && ROUTE_GROUP.test(segment)) {
    return true;
  }

  const unescaped = segment.replace(ESCAPE, "x");
  const name = isFile && unescaped.includes(".") ? unescaped.slice(0, unescaped.lastIndexOf(".")) : unescaped;

  if (isFile && name === "__root") {
    return true;
  }

  return name.split(".").every(isGoodRoutePart);
}

/** Tells if all segments of a path have good names. */
function isGoodPath(path) {
  const segments = path.split("/");
  const routeStart = path.startsWith(ROUTES_PREFIX) ? ROUTES_PREFIX.split("/").length - 1 : segments.length;

  return segments.every((segment, index) => {
    const isFile = index === segments.length - 1;

    return index < routeStart ? isGoodSegment(segment, isFile) : isGoodRouteSegment(segment, isFile);
  });
}

/** Gives the paths that do not have dash-case names, in their input order. */
export function findBadNames(paths) {
  return paths
    .filter((path) => !IGNORED_PATHS.some((pattern) => pattern.test(path)))
    .filter((path) => !isGoodPath(path));
}

/** Gives the paths of all files that Git tracks, also new files that are not ignored. */
function trackedPaths() {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });

  return output.split("\0").filter((path) => path !== "");
}

function main() {
  const bad = findBadNames(trackedPaths());

  if (bad.length === 0) {
    return;
  }

  for (const path of bad) {
    console.error(`Not dash-case: ${path}`);
  }
  console.error(
    `${bad.length} path(s) do not have dash-case names. Rename them, or see the exceptions in this script.`,
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
