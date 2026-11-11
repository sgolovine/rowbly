import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

/**
 * The state of `.rowbly/state.json`, which the factory supervisor writes:
 * - `ok`: a valid version 1 file.
 * - `missing`: no file.
 * - `unavailable`: Rowbly cannot read or accept the file, so it shows no activity.
 * - `incomplete`: a valid file without some data. Rowbly shows the activity that it can match.
 */
type FactoryStateStatus = "ok" | "missing" | "unavailable" | "incomplete";

/**
 * The recorded factory activity of one Story in its current Stage. A Story with no active attempt has no entry.
 * - `active`: one worker, with the `model` of its attempt, or its `workerId`.
 * - `conflict`: more than one attempt could be active. Rowbly does not choose one.
 * - `unknown`: an attempt does not have the data to decide.
 */
export type StoryActivity = { kind: "active"; label: string } | { kind: "conflict" } | { kind: "unknown" };

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

/** The attempt statuses of `skills/factory/scripts/factory-state.mjs`. */
const ACTIVE_STATUSES = new Set(["preparing", "running"]);
const STATUSES = new Set([...ACTIVE_STATUSES, "completed", "failed", "blocked", "interrupted"]);
/** The mandatory attempt fields after `story`. */
const ATTEMPT_FIELDS = ["stage", "workerId", "status"] as const;
const CONFLICT_MARKER = /^(<{7}|={7}|>{7})(\s|$)/m;

type Attempt = Partial<Record<"story" | "stage" | "workerId" | "status" | "model", string>>;

class InvalidState extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function checkString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "string") throw new InvalidState(`${path} must be a string`);
}

/** Checks the parts of the file that Rowbly uses. Throws `InvalidState`, and returns the missing parts. */
function validate(state: unknown): { attempts: Attempt[]; missing: string[] } {
  if (!isObject(state)) throw new InvalidState("The file is not a JSON object");
  if (state.version === undefined) throw new InvalidState("version is missing");
  if (state.version !== 1) throw new InvalidState(`Unsupported version ${JSON.stringify(state.version)}`);
  if (state.updatedAt !== undefined && state.updatedAt !== null) checkString(state.updatedAt, "updatedAt");
  const missing: string[] = [];
  if (state.scan === undefined) missing.push("scan");
  else if (!isObject(state.scan)) throw new InvalidState("scan must be an object");
  else {
    const { count, stages } = state.scan;
    if (count !== undefined && typeof count !== "number") throw new InvalidState("scan.count must be a number");
    if (stages !== undefined) {
      if (!isObject(stages)) throw new InvalidState("scan.stages must be an object");
      for (const [id, stage] of Object.entries(stages)) checkString(stage, `scan.stages.${id}`);
    }
  }
  if (state.attempts === undefined) {
    missing.push("attempts");
    return { attempts: [], missing };
  }
  if (!Array.isArray(state.attempts)) throw new InvalidState("attempts must be an array");
  const attempts = state.attempts.map((attempt: unknown, i): Attempt => {
    const at = `attempts[${i}]`;
    if (!isObject(attempt)) throw new InvalidState(`${at} must be an object`);
    for (const key of ["story", "stage", "workerId", "status", "model"] as const)
      checkString(attempt[key], `${at}.${key}`);
    if (typeof attempt.status === "string" && !STATUSES.has(attempt.status)) {
      throw new InvalidState(`${at}.status "${attempt.status}" is not a known status`);
    }
    if (attempt.story === undefined) missing.push(`${at}.story`);
    for (const key of ATTEMPT_FIELDS) if (attempt[key] === undefined) missing.push(`${at}.${key}`);
    return attempt as Attempt;
  });
  return { attempts, missing };
}

/** The activity of one Story from its attempts, by the activity rules. */
function storyActivity(story: { id: string; stage: string }, attempts: readonly Attempt[]): StoryActivity | undefined {
  // An attempt without a Stage can belong to the current Stage, so it counts here.
  const matched = attempts.filter((a) => a.story === story.id && (a.stage === undefined || a.stage === story.stage));
  if (matched.some((a) => ATTEMPT_FIELDS.some((key) => a[key] === undefined))) return { kind: "unknown" };
  const active = matched.flatMap((a, i) => (ACTIVE_STATUSES.has(a.status as string) ? [i] : []));
  if (active.length === 0) return undefined;
  // A later attempt replaces an active one, so the two disagree. Do not show the earlier worker.
  if (active.length > 1 || active[0] !== matched.length - 1) return { kind: "conflict" };
  const last = matched[matched.length - 1] as Attempt;
  return { kind: "active", label: last.model ?? (last.workerId as string) };
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
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { path, status: "missing", stories: {} };
    return { path, status: "unavailable", message: (err as Error).message, stories: {} };
  }
  let checked: ReturnType<typeof validate>;
  try {
    if (CONFLICT_MARKER.test(text)) throw new InvalidState("The file has Git conflict markers");
    let state: unknown;
    try {
      state = JSON.parse(text);
    } catch (err) {
      throw new InvalidState(`The file is not valid JSON: ${(err as Error).message}`);
    }
    checked = validate(state);
  } catch (err) {
    if (!(err instanceof InvalidState)) throw err;
    return { path, status: "unavailable", message: err.message, stories: {} };
  }
  const stories: Record<string, StoryActivity> = {};
  for (const story of input.stories) {
    const activity = storyActivity(story, checked.attempts);
    if (activity) stories[story.id] = activity;
  }
  if (checked.missing.length === 0) return { path, status: "ok", stories };
  const [first, second, third, ...more] = checked.missing;
  const names = [first, second, third].filter(Boolean).join(", ") + (more.length ? ` and ${more.length} more` : "");
  return { path, status: "incomplete", message: `Missing ${names}`, stories };
}
