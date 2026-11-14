import { isAbsolute } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { validModel } from "../factory-settings/factory-settings.js";
import type { ThreadRecord, ThreadRun, ThreadStatus, WorkerResult } from "./thread-types.js";

const STATUSES: readonly ThreadStatus[] = ["pending", "running", "completed", "failed", "cancelled", "interrupted"];
const ROLES: readonly string[] = ["worker", "supervisor"];
const ERROR_CLASSES: readonly string[] = [
  "auth",
  "quota",
  "transient",
  "launch",
  "storage",
  "configuration",
  "unknown",
];
const STORY_ID = /^[A-Z][A-Z0-9]*-\d+$/;
const STAGE_KEY = /^[A-Z][A-Z0-9_]*$/;
const MAX_SUMMARY_LENGTH = 1000;
const MAX_NOTES = 10;
const MAX_NOTE_LENGTH = 500;
const MAX_COMMITS = 20;
const MAX_CHECKS = 20;

/** Tells if an ID is safe as a file name: letters, digits, `_` and `-`, at most 128 characters. */
export function validId(id: string): boolean {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

function optionalDate(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function hasIdentity(t: ThreadRecord): boolean {
  return (
    t?.version === 1 &&
    typeof t.id === "string" &&
    validId(t.id) &&
    Number.isSafeInteger(t.revision) &&
    t.revision >= 1 &&
    ROLES.includes(t.role) &&
    STATUSES.includes(t.status) &&
    Number.isFinite(Date.parse(t.createdAt)) &&
    typeof t.cwd === "string" &&
    isAbsolute(t.cwd) &&
    typeof t.resumable === "boolean"
  );
}

function hasStoryFields(t: ThreadRecord): boolean {
  return (
    !(t.role === "worker" && (!t.storyId || !t.stage)) &&
    (t.storyId === undefined || (typeof t.storyId === "string" && STORY_ID.test(t.storyId))) &&
    (t.stage === undefined || (typeof t.stage === "string" && STAGE_KEY.test(t.stage))) &&
    (t.parentThreadId === undefined || validId(t.parentThreadId)) &&
    (t.attemptNumber === undefined || (Number.isSafeInteger(t.attemptNumber) && t.attemptNumber >= 1))
  );
}

function hasOptionalFields(t: ThreadRecord): boolean {
  return (
    [t.startedAt, t.completedAt, t.lastActivityAt].every(optionalDate) &&
    [t.branch, t.lastTool].every((value) => value === undefined || typeof value === "string") &&
    (t.worktree === undefined || (typeof t.worktree === "string" && isAbsolute(t.worktree)))
  );
}

function validUsage(usage: ThreadRecord["usage"]): boolean {
  if (usage === undefined) {
    return true;
  }

  return (
    !!usage &&
    [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.cost].every(
      (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
    )
  );
}

function validError(error: ThreadRecord["error"]): boolean {
  if (error === undefined) {
    return true;
  }

  return (
    !!error &&
    ERROR_CLASSES.includes(error.class) &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  );
}

function validChecks(checks: ThreadRecord["checks"]): boolean {
  if (checks === undefined) {
    return true;
  }

  return (
    Array.isArray(checks) &&
    checks.length <= MAX_CHECKS &&
    checks.every((check) => [check?.id, check?.key, check?.scope, check?.status].every((v) => typeof v === "string"))
  );
}

function validSession(t: ThreadRecord): boolean {
  return !!t.session && t.session.id === t.id && (t.session.file === null || typeof t.session.file === "string");
}

function validRun(run: ThreadRun): boolean {
  return (
    !!run &&
    validId(run.id) &&
    typeof run.ownerToken === "string" &&
    !!run.ownerToken &&
    STATUSES.includes(run.status) &&
    Number.isFinite(Date.parse(run.createdAt)) &&
    [run.startedAt, run.endedAt].every(optionalDate) &&
    (run.reason === undefined || typeof run.reason === "string")
  );
}

function validRuns(t: ThreadRecord): boolean {
  return (
    Array.isArray(t.runs) &&
    t.runs.length > 0 &&
    t.runs.every(validRun) &&
    new Set(t.runs.map((run) => run.id)).size === t.runs.length &&
    t.runs.at(-1)?.status === t.status
  );
}

function validMetadata(t: ThreadRecord): boolean {
  return (
    hasIdentity(t) &&
    hasStoryFields(t) &&
    hasOptionalFields(t) &&
    validUsage(t.usage) &&
    validError(t.error) &&
    validChecks(t.checks) &&
    validSession(t) &&
    validRuns(t) &&
    (t.model === undefined || validModel(t.model))
  );
}

function validNotes(notes: string[]): boolean {
  return notes.length <= MAX_NOTES && notes.every((note) => typeof note === "string" && note.length <= MAX_NOTE_LENGTH);
}

function validCommits(commits: WorkerResult["commits"]): boolean {
  return (
    commits === undefined ||
    (Array.isArray(commits) && commits.length <= MAX_COMMITS && commits.every((commit) => typeof commit === "string"))
  );
}

function validResult(result: ThreadRecord["result"]): boolean {
  if (result === undefined) {
    return true;
  }

  return (
    !!result &&
    typeof result.outcome === "string" &&
    typeof result.summary === "string" &&
    result.summary.length <= MAX_SUMMARY_LENGTH &&
    Array.isArray(result.blockers) &&
    Array.isArray(result.problems) &&
    [result.blockers, result.problems].every(validNotes) &&
    validCommits(result.commits)
  );
}

/** Gives the value as Thread metadata, or throws when the metadata or its worker result is invalid. */
export function validateThread(value: unknown): ThreadRecord {
  const t = value as ThreadRecord;

  if (!validMetadata(t)) {
    throw new ValidationError("Invalid thread metadata");
  }

  if (!validResult(t.result)) {
    throw new ValidationError("Invalid worker result");
  }

  return t;
}
