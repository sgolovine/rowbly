// Checks that each file and folder that Git tracks has a dash-case name.
// Biome checks only the names of script files, so this script also checks folders, Markdown and HTML.
// Run it with `node scripts/check-names.mjs`. It prints each bad path and exits with code 1.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DASH_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Conventional meta files keep their uppercase names, for example `README.md` and `SKILL.md`.
const META_FILES = new Set(["README", "AGENTS", "CLAUDE", "SKILL", "LICENSE", "UPSTREAM", "CHANGELOG"]);

// Paths that keep their names:
// - `.agents/skills/agentic-tui/` is an unchanged copy of an upstream skill.
// - `.rowbly/` is product data: stage keys (`IN_REVIEW.md`), story IDs (`ROW-01.md`) and `ROWBLY.md`.
// - `stages/*.md` are the default stage prompts, and each name is a stage key (`BACKLOG.md`).
const IGNORED_PATHS = [/^\.agents\/skills\/agentic-tui\//, /^\.rowbly\//, /^stages\/[^/]+\.md$/];

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

/** Tells if all segments of a path have good names. */
function isGoodPath(path) {
  const segments = path.split("/");

  return segments.every((segment, index) => isGoodSegment(segment, index === segments.length - 1));
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
