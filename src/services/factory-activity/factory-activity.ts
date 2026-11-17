import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Store } from "../store/store.js";
import { LOCAL_HOST } from "../thread/thread.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

/**
 * The state of `.rowbly/state.json`, which the factory manager writes:
 * - `ok`: a valid version 1 file.
 * - `missing`: no file.
 * - `unavailable`: Rowbly cannot read or accept the file, so it shows no activity.
 * - `incomplete`: a valid file without some data. Rowbly shows the activity that it can match.
 */
type FactoryStateStatus = "ok" | "missing" | "unavailable" | "incomplete";

/**
 * The recorded factory activity of one Story in its current Stage. A Story with no active attempt has no entry.
 * - `active`: one worker, with the `model` of its attempt, or its `workerId`, and the `host` that runs it.
 * - `conflict`: more than one attempt could be active. Rowbly does not choose one.
 * - `unknown`: an attempt does not have the data to decide.
 */
export type StoryActivity =
  | { kind: "active"; label: string; host: string }
  | { kind: "conflict" }
  | { kind: "unknown" };

export interface FactoryActivity {
  /** The absolute path of the state file. */
  path: string;
  status: FactoryStateStatus;
  /** Why the status is `unavailable` or `incomplete`. */
  message?: string;
  /** The activity by Story ID. Always empty when the status is `unavailable`. */
  stories: Record<string, StoryActivity>;
}

export interface GetFactoryActivityInput {
  /** The current Stories. Attempts for other Stories are ignored. */
  stories: readonly { id: string; stage: string }[];
}

/** The active attempt statuses of the factory state (`src/services/factory-state/state-file.ts`). */
const ACTIVE_STATUSES = new Set(["preparing", "running"]);
const STATUSES = new Set([...ACTIVE_STATUSES, "completed", "failed", "blocked", "interrupted"]);
/** The mandatory attempt fields after `story`. */
const ATTEMPT_FIELDS = ["stage", "workerId", "status"] as const;

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})(\s|$)/m;

type Attempt = Partial<Record<"story" | "stage" | "workerId" | "status" | "model" | "host", string>>;

/** The attempts of a valid file, and the names of the parts that the file does not have. */
interface CheckedState {
  readonly attempts: Attempt[];
  readonly missing: string[];
}

/** The checked state, with the attempts of each Story in file order. Attempts without a Story have no group. */
interface GroupedState {
  readonly groups: ReadonlyMap<string, readonly Attempt[]>;
  readonly missing: readonly string[];
}

/** The parse result of one version of the file. `key` identifies the version by path, time, size and inode. */
interface CacheEntry {
  readonly key: string;
  readonly result: GroupedState | FactoryActivity;
}

/** One entry is sufficient: the TUI shows one Project at a time. */
const stateCache = new Store<{ entry?: CacheEntry }>({});

class InvalidState extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new InvalidState(`${path} must be a string`);
  }
}

function checkHeader(state: unknown): asserts state is Record<string, unknown> {
  if (!isObject(state)) {
    throw new InvalidState("The file is not a JSON object");
  }

  if (state.version === undefined) {
    throw new InvalidState("version is missing");
  }

  if (state.version !== 1) {
    throw new InvalidState(`Unsupported version ${JSON.stringify(state.version)}`);
  }

  if (state.updatedAt !== undefined && state.updatedAt !== null) {
    checkString(state.updatedAt, "updatedAt");
  }
}

/** Checks `scan`, and gives `["scan"]` when the file does not have it. */
function checkScan(scan: unknown): string[] {
  if (scan === undefined) {
    return ["scan"];
  }

  if (!isObject(scan)) {
    throw new InvalidState("scan must be an object");
  }

  const { count, stages } = scan;

  if (count !== undefined && typeof count !== "number") {
    throw new InvalidState("scan.count must be a number");
  }

  if (stages !== undefined) {
    if (!isObject(stages)) {
      throw new InvalidState("scan.stages must be an object");
    }

    for (const [id, stage] of Object.entries(stages)) {
      checkString(stage, `scan.stages.${id}`);
    }
  }

  return [];
}

/** Checks one attempt, and gives the names of its missing mandatory fields. */
function checkAttempt(attempt: unknown, i: number): { attempt: Attempt; missing: string[] } {
  const at = `attempts[${i}]`;

  if (!isObject(attempt)) {
    throw new InvalidState(`${at} must be an object`);
  }

  for (const key of ["story", "stage", "workerId", "status", "model", "host"] as const) {
    checkString(attempt[key], `${at}.${key}`);
  }

  if (typeof attempt.status === "string" && !STATUSES.has(attempt.status)) {
    throw new InvalidState(`${at}.status "${attempt.status}" is not a known status`);
  }

  const missing = (["story", ...ATTEMPT_FIELDS] as const)
    .filter((key) => attempt[key] === undefined)
    .map((key) => `${at}.${key}`);

  return { attempt: attempt as Attempt, missing };
}

/** Checks the parts of the file that Rowbly uses. Throws `InvalidState`, and returns the missing parts. */
function validate(state: unknown): CheckedState {
  checkHeader(state);

  const scanMissing = checkScan(state.scan);

  if (state.attempts === undefined) {
    return { attempts: [], missing: [...scanMissing, "attempts"] };
  }

  if (!Array.isArray(state.attempts)) {
    throw new InvalidState("attempts must be an array");
  }

  const checked = state.attempts.map((attempt: unknown, i) => checkAttempt(attempt, i));

  return {
    attempts: checked.map((entry) => entry.attempt),
    missing: [...scanMissing, ...checked.flatMap((entry) => entry.missing)],
  };
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

/**
 * Groups the attempts by Story in one sort. The sort is stable, so each group keeps the file order.
 * Attempts without a Story are not in a group.
 */
function groupByStory(attempts: readonly Attempt[]): ReadonlyMap<string, readonly Attempt[]> {
  const sorted = attempts
    .filter((a) => a.story !== undefined)
    .toSorted((a, b) => compareText(a.story as string, b.story as string));
  const starts = sorted.flatMap((a, i) => (i === 0 || a.story !== sorted[i - 1]?.story ? [i] : []));

  return new Map(starts.map((start, n) => [sorted[start]?.story as string, sorted.slice(start, starts[n + 1])]));
}

/** The activity of one Story from its attempts, by the activity rules. */
function storyActivity(story: { id: string; stage: string }, attempts: readonly Attempt[]): StoryActivity | undefined {
  // An attempt without a Stage can belong to the current Stage, so it counts here.
  const matched = attempts.filter((a) => a.stage === undefined || a.stage === story.stage);

  if (matched.some((a) => ATTEMPT_FIELDS.some((key) => a[key] === undefined))) {
    return { kind: "unknown" };
  }

  const active = matched.flatMap((a, i) => (ACTIVE_STATUSES.has(a.status as string) ? [i] : []));

  if (active.length === 0) {
    return undefined;
  }

  // A later attempt replaces an active one, so the two disagree. Do not show the earlier worker.
  if (active.length > 1 || active[0] !== matched.length - 1) {
    return { kind: "conflict" };
  }

  const last = matched[matched.length - 1] as Attempt;

  return { kind: "active", label: last.model ?? (last.workerId as string), host: last.host ?? LOCAL_HOST };
}

/** Gives the text of the file, or the activity for a file that is absent or cannot be read. */
async function readStateText(path: string): Promise<string | FactoryActivity> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, status: "missing", stories: {} };
    }

    return { path, status: "unavailable", message: (err as Error).message, stories: {} };
  }
}

function parseState(text: string): unknown {
  if (CONFLICT_MARKER.test(text)) {
    throw new InvalidState("The file has Git conflict markers");
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new InvalidState(`The file is not valid JSON: ${(err as Error).message}`);
  }
}

/** Gives the grouped state, or the `unavailable` activity of a file that Rowbly cannot accept. */
function checkText(path: string, text: string): GroupedState | FactoryActivity {
  try {
    const checked = validate(parseState(text));

    return { groups: groupByStory(checked.attempts), missing: checked.missing };
  } catch (err) {
    if (!(err instanceof InvalidState)) {
      throw err;
    }

    return { path, status: "unavailable", message: err.message, stories: {} };
  }
}

function activityEntry(
  story: { id: string; stage: string },
  groups: ReadonlyMap<string, readonly Attempt[]>,
): [string, StoryActivity][] {
  const activity = storyActivity(story, groups.get(story.id) ?? []);

  return activity ? [[story.id, activity]] : [];
}

function activities(
  stories: readonly { id: string; stage: string }[],
  groups: ReadonlyMap<string, readonly Attempt[]>,
): Record<string, StoryActivity> {
  return Object.fromEntries(stories.flatMap((story) => activityEntry(story, groups)));
}

/** Gives the cache key of the current version of the file, or the activity for a file that is absent. */
async function stateKey(path: string): Promise<string | FactoryActivity> {
  try {
    const info = await stat(path);

    return `${path}|${info.mtimeMs}|${info.size}|${info.ino}`;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, status: "missing", stories: {} };
    }

    return { path, status: "unavailable", message: (err as Error).message, stories: {} };
  }
}

/**
 * Gives the grouped state of the file. An unchanged file is not parsed again. A missing file or a read
 * error is not cached, so the next call reads the file again.
 */
async function loadState(path: string): Promise<GroupedState | FactoryActivity> {
  const key = await stateKey(path);

  if (typeof key !== "string") {
    return key;
  }

  const cached = stateCache.current.entry;

  if (cached?.key === key) {
    return cached.result;
  }

  const text = await readStateText(path);

  if (typeof text !== "string") {
    return text;
  }

  const result = checkText(path, text);

  stateCache.update(() => ({ entry: { key, result } }));

  return result;
}

function missingMessage(missing: readonly string[]): string {
  const [first, second, third, ...more] = missing;
  const names = [first, second, third].filter(Boolean).join(", ") + (more.length ? ` and ${more.length} more` : "");

  return `Missing ${names}`;
}

/**
 * Reads `.rowbly/state.json` and gives the recorded factory activity of each Story. It only reads the file.
 * A problem with the file gives a status, not an error, so the Stories still load. It does not check that
 * a worker is alive.
 */
export async function getFactoryActivity(
  input: GetFactoryActivityInput,
  ctx: ServiceContext = {},
): Promise<FactoryActivity> {
  const path = join((await findProject(ctx)).dir, "state.json");
  const checked = await loadState(path);

  if ("status" in checked) {
    return checked;
  }

  const stories = activities(input.stories, checked.groups);

  if (checked.missing.length === 0) {
    return { path, status: "ok", stories };
  }

  return { path, status: "incomplete", message: missingMessage(checked.missing), stories };
}
