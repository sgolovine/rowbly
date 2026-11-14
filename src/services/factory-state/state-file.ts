// Reads and replaces the factory state. Assignment belongs to the supervisor.
import { randomUUID } from "node:crypto";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { acquireOwner, newOwner, type Owner, releaseOwner } from "../factory-ownership/ownership-lock.js";
import type { PolicyAttempt, PolicyState } from "../factory-policy/factory-policy.js";

const STATUSES = new Set(["preparing", "running", "completed", "failed", "blocked", "interrupted"]);
const HINT = "Repair the JSON and version 1 state, or check the harness for active workers, then move the file away.";
const LOCK_WAIT_MS = 120_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorCode(error: unknown): unknown {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}

function validAttempt(attempt: unknown): attempt is PolicyAttempt {
  return (
    isObject(attempt) &&
    ["story", "stage", "workerId"].every((key) => typeof attempt[key] === "string") &&
    STATUSES.has(attempt.status as string)
  );
}

function validate(state: unknown): PolicyState {
  if (
    !isObject(state) ||
    state.version !== 1 ||
    !isObject(state.scan) ||
    !isObject(state.scan.stages) ||
    !Object.values(state.scan.stages).every((stage) => typeof stage === "string") ||
    !Array.isArray(state.attempts) ||
    !state.attempts.every(validAttempt)
  ) {
    throw new Error("Invalid version 1 factory state");
  }

  return state as PolicyState;
}

function emptyState(): PolicyState {
  return { version: 1, updatedAt: null, scan: { stages: {} }, attempts: [] };
}

/** The path of the state file of the Project at `root`. */
function statePath(root: string): string {
  return join(resolve(root, ".rowbly"), "state.json");
}

/** Runs the action on the state file. Each failure names the file and the repair, for the report of the supervisor. */
async function guard<T>(root: string, action: (path: string) => Promise<T>): Promise<T> {
  try {
    if (!(await stat(resolve(root, ".rowbly"))).isDirectory()) {
      throw new Error("The Project path is not a directory");
    }

    return await action(statePath(root));
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      path: statePath(root),
      hint: HINT,
    });
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function load(path: string): Promise<PolicyState> {
  const content = await readText(path);

  return content === undefined ? emptyState() : validate(JSON.parse(content));
}

/** Gives the state of the Project. A Project without a state file gives an empty state. */
export function readState(root: string): Promise<PolicyState> {
  return guard(root, load);
}

async function writeTemporary(temporary: string, state: PolicyState): Promise<void> {
  const file = await open(temporary, "wx", 0o600);

  try {
    await file.writeFile(`${JSON.stringify(state, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
}

/** Removes the temporary file after a failure. A cleanup failure adds its message to the error. */
async function removeTemporary(temporary: string, error: unknown): Promise<unknown> {
  try {
    await unlink(temporary);

    return error;
  } catch (cleanupError) {
    const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);

    return error instanceof Error
      ? Object.assign(error, { message: `${error.message}; temporary file cleanup failed: ${cleanup}` })
      : error;
  }
}

async function replace(path: string, input: unknown): Promise<PolicyState> {
  const state = { ...validate(input), updatedAt: new Date().toISOString() };
  const temporary = `${path}.tmp-${randomUUID()}`;

  try {
    await writeTemporary(temporary, state);
    await rename(temporary, path);
  } catch (error) {
    throw await removeTemporary(temporary, error);
  }

  return state;
}

/** Validates the state, sets `updatedAt`, then replaces the file atomically. */
export function writeState(root: string, input: PolicyState): Promise<PolicyState> {
  return guard(root, async (path) => {
    // Do not replace a malformed file, even when the new input is valid.
    await load(path);

    return replace(path, input);
  });
}

async function acquireStateLock(lock: string, owner: Owner, deadline: number): Promise<void> {
  const result = await acquireOwner(lock, `${lock}.guard`, owner);

  if (result.acquired) {
    return;
  }

  if (Date.now() >= deadline) {
    throw new Error(`State lock is busy: ${lock}`);
  }

  await sleep(50);

  return acquireStateLock(lock, owner, deadline);
}

/** Serializes state transactions. A live or uncertain owner retains its lock. */
export async function withStateLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const lock = `${statePath(root)}.lock`;
  const owner = await newOwner();

  await acquireStateLock(lock, owner, Date.now() + LOCK_WAIT_MS);

  try {
    return await action();
  } finally {
    await releaseOwner(lock, `${lock}.guard`, owner.token);
  }
}

const KEPT: Record<string, (value: unknown) => boolean> = {
  prompts: isObject,
  notes: (value) => Array.isArray(value) && value.every((note) => typeof note === "string"),
  rowbly: (value) => Array.isArray(value) && value.every((part) => typeof part === "string"),
  writeLock: (value) => typeof value === "string",
  maxActive: (value) => typeof value === "number",
};

function parseOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Nothing of a file that is not JSON can stay.
    return null;
  }
}

/** Gives a new state with each valid part of the old file. */
function salvage(old: unknown): PolicyState {
  if (!isObject(old)) {
    return emptyState();
  }

  const attempts = Array.isArray(old.attempts) ? old.attempts.filter(validAttempt) : [];
  const count = isObject(old.scan) && Number.isInteger(old.scan.count) ? { count: old.scan.count as number } : {};
  const kept = Object.fromEntries(
    Object.entries(KEPT)
      .filter(([key, valid]) => valid(old[key]))
      .map(([key]) => [key, old[key]]),
  );

  return { ...emptyState(), scan: { stages: {}, ...count }, attempts, ...kept };
}

/**
 * Moves a state file that is not valid out of the way, and starts a new state with each part of the old file that
 * is valid. The attempts are the most important part: without them, a Story with a worker gets a second worker.
 */
export function resetState(root: string): Promise<{ moved: string | null; attempts: number }> {
  return guard(root, async (path) => {
    const text = await readText(path);

    if (text === undefined) {
      return { moved: null, attempts: 0 };
    }

    const moved = `${path}.invalid-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;

    await rename(path, moved);

    const state = salvage(parseOrNull(text));

    await replace(path, state);

    return { moved, attempts: state.attempts.length };
  });
}
