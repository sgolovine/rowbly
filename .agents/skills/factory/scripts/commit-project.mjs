#!/usr/bin/env node
// Commits the canonical Project files. It never commits source files or the factory state.
// A problem gives a result, not an exception, because a commit problem must not stop the factory.
// Usage: node commit-project.mjs --root <dir> [--message <text>] [--lock <path>]

import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const run = promisify(execFile);
const self = fileURLToPath(import.meta.url);
const LOCK_WAIT_SECONDS = 60;
const CONFLICTS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const DEFAULT_MESSAGE = "chore(rowbly): record project changes after scan";

const GIT_TIMEOUT_MS = 120_000;
const git = async (cwd, args) =>
  (await run("git", ["-C", cwd, ...args], { maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS })).stdout;
const describe = (error) => error.stderr?.trim() || error.stdout?.trim() || error.message;

/** The lock that all writers of the canonical Project files share. */
export async function lockPath(root) {
  try {
    const common = (await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
    return join(common, "rowbly-project-write.lock");
  } catch {
    return resolve(root, ".rowbly-factory-write.lock");
  }
}

// Run this only while the process holds the shared write lock.
async function commitLocked(root, message = DEFAULT_MESSAGE) {
  let repository;
  try {
    repository = realpathSync((await git(root, ["rev-parse", "--show-toplevel"])).trim());
  } catch {
    return { status: "no-git", detail: "The Project is not in a Git repository." };
  }
  try {
    const project = relative(repository, realpathSync(resolve(root, ".rowbly")));
    // Without rename detection, a rename has separate old and new paths.
    const status = await git(repository, [
      "-c", "status.renames=false", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", project,
    ]);
    const records = status.split("\0").filter(Boolean)
      .map((record) => ({ code: record.slice(0, 2), path: record.slice(3) }))
      .filter(({ path }) => path !== `${project}/state.json` && !path.startsWith(`${project}/state.json.`) && path !== `${project}/runtime` && !path.startsWith(`${project}/runtime/`));
    const conflicts = records.filter(({ code }) => CONFLICTS.has(code)).map(({ path }) => path);
    if (conflicts.length > 0) {
      return { status: "conflict", paths: conflicts, detail: "Resolve the merge conflict in these files." };
    }
    // A file with a staged version and a later edit stays as it is. A commit would lose the staged version.
    const isHeld = ({ code }) => !" ?".includes(code[0]) && code[1] !== " ";
    const held = records.filter(isHeld).map(({ path }) => path);
    const paths = records.filter((record) => !isHeld(record)).map(({ path }) => path);
    if (paths.length === 0) return held.length > 0 ? { status: "held", held } : { status: "clean" };
    const pathspec = ["--literal-pathspecs"];
    await git(repository, [...pathspec, "add", "--all", "--", ...paths]);
    const body = paths.slice(0, 20).join("\n") + (paths.length > 20 ? `\nand ${paths.length - 20} more` : "");
    await git(repository, [...pathspec, "commit", "--only", "-m", message, "-m", body, "--", ...paths]);
    const commit = (await git(repository, ["rev-parse", "--short", "HEAD"])).trim();
    return { status: "committed", commit, paths, ...(held.length > 0 ? { held } : {}) };
  } catch (error) {
    return { status: "failed", detail: describe(error) };
  }
}

/**
 * Commits each changed file of `<root>/.rowbly/` that Git does not ignore, except the state file.
 * The status is `committed`, `clean`, `held`, `conflict`, `no-git` or `failed`.
 */
export async function commitProject(root, { message, lock, lockWaitSeconds = LOCK_WAIT_SECONDS } = {}) {
  const path = lock ?? (await lockPath(root));
  const args = [self, "--root", root, "--locked", ...(message ? ["--message", message] : [])];
  try {
    // A commit that does not end must not keep the lock: all writers wait for it.
    const timeout = lockWaitSeconds * 1000 + 3 * GIT_TIMEOUT_MS;
    const { stdout } = await run("flock", ["-w", String(lockWaitSeconds), path, process.execPath, ...args], { timeout });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.code === "ENOENT") return { ...(await commitLocked(root, message)), lock: "flock is not available" };
    return { status: "failed", detail: `The write lock ${path} is busy, or the commit did not run: ${describe(error)}` };
  }
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        root: { type: "string" },
        message: { type: "string" },
        lock: { type: "string" },
        locked: { type: "boolean", default: false },
      },
    }));
    if (!values.root) throw new Error();
  } catch {
    console.error("Usage: commit-project.mjs --root <dir> [--message <text>] [--lock <path>]");
    process.exit(2);
  }
  const result = values.locked ? await commitLocked(values.root, values.message) : await commitProject(values.root, values);
  console.log(JSON.stringify(result));
}

// An installed skill can be a symlink, so compare the real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === self) await main();
