#!/usr/bin/env node
// Read and replace the factory state. Assignment belongs to the supervisor.
import { randomUUID } from "node:crypto";
import { acquireOwner, newOwner, releaseOwner } from "./ownership-lock.mjs";
import { realpathSync } from "node:fs";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const statuses = new Set(["preparing", "running", "completed", "failed", "blocked", "interrupted"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hint = "Repair the JSON and version 1 state, or check the harness for active workers, then move the file away.";

const validAttempt = (attempt) => object(attempt) &&
  ["story", "stage", "workerId"].every((key) => typeof attempt[key] === "string") && statuses.has(attempt.status);

function validate(state) {
  if (!object(state) || state.version !== 1 || !object(state.scan) || !object(state.scan.stages) ||
    !Object.values(state.scan.stages).every((stage) => typeof stage === "string") ||
    !Array.isArray(state.attempts) || !state.attempts.every(validAttempt)) {
    throw new Error("Invalid version 1 factory state");
  }
  return state;
}

export const statePath = (root) => join(resolve(root, ".rowbly"), "state.json");

// Each failure names the file and the repair, for the supervisor's report.
async function guard(root, action) {
  try {
    if (!(await stat(resolve(root, ".rowbly"))).isDirectory()) throw new Error("The Project path is not a directory");
    return await action(statePath(root));
  } catch (error) {
    throw Object.assign(error, { path: statePath(root), hint });
  }
}

async function load(path) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, updatedAt: null, scan: { stages: {} }, attempts: [] };
    throw error;
  }
  return validate(JSON.parse(content));
}

/** Gives the state of the Project. A Project without a state file gives an empty state. */
export const readState = (root) => guard(root, load);

async function replace(path, input) {
  const state = validate(input);
  state.updatedAt = new Date().toISOString();
  const temporary = `${path}.tmp-${randomUUID()}`;
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(`${JSON.stringify(state, null, 2)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      error.message += `; temporary file cleanup failed: ${cleanupError.message}`;
    }
    throw error;
  }
  return state;
}

/** Validates the state, sets `updatedAt`, then replaces the file atomically. */
export const writeState = (root, input) => guard(root, async (path) => {
  // Do not replace a malformed file, even when the new input is valid.
  await load(path);
  return replace(path, input);
});

/** Serializes state transactions. A live or uncertain owner retains its lock. */
export async function withStateLock(root, action) {
  const lock = `${statePath(root)}.lock`;
  const guard = `${lock}.guard`;
  const owner = await newOwner();
  const deadline = Date.now() + 120_000;
  for (;;) {
    const result = await acquireOwner(lock, guard, owner);
    if (result.acquired) break;
    if (Date.now() >= deadline) throw new Error(`State lock is busy: ${lock}`);
    await sleep(50);
  }
  try { return await action(); }
  finally { await releaseOwner(lock, guard, owner.token); }
}

const KEPT = {
  prompts: object,
  notes: (value) => Array.isArray(value) && value.every((note) => typeof note === "string"),
  rowbly: (value) => Array.isArray(value) && value.every((part) => typeof part === "string"),
  writeLock: (value) => typeof value === "string",
  maxActive: (value) => typeof value === "number",
};

/**
 * Moves a state file that is not valid out of the way, and starts a new state with each part of the old file that
 * is valid. The attempts are the most important part: without them, a Story with a worker gets a second worker.
 */
export const resetState = (root) => guard(root, async (path) => {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { moved: null, attempts: 0 };
    throw error;
  }
  const moved = `${path}.invalid-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
  await rename(path, moved);
  let old = null;
  try {
    old = JSON.parse(text);
  } catch {
    // Nothing of a file that is not JSON can stay.
  }
  const state = { version: 1, updatedAt: null, scan: { stages: {} }, attempts: [] };
  if (object(old)) {
    if (Array.isArray(old.attempts)) state.attempts = old.attempts.filter(validAttempt);
    if (object(old.scan) && Number.isInteger(old.scan.count)) state.scan.count = old.scan.count;
    for (const [key, valid] of Object.entries(KEPT)) if (valid(old[key])) state[key] = old[key];
  }
  await replace(path, state);
  return { moved, attempts: state.attempts.length };
});

async function main() {
  let values;
  let command;
  try {
    const args = parseArgs({ options: { root: { type: "string" } }, allowPositionals: true });
    values = args.values;
    [command] = args.positionals;
    if (!values.root || args.positionals.length !== 1 || !["read", "write"].includes(command)) throw new Error();
  } catch {
    console.error("Usage: factory-state.mjs <read|write> --root <root>");
    process.exit(2);
  }
  try {
    if (command === "read") {
      console.log(JSON.stringify(await readState(values.root)));
    } else {
      await readState(values.root);
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      await writeState(values.root, JSON.parse(input));
    }
  } catch (error) {
    console.error(JSON.stringify({ error: { message: error.message, path: statePath(values.root), hint } }));
    process.exitCode = 1;
  }
}

// An installed skill can be a symlink, so compare the real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
