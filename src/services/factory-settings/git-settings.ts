import { ValidationError } from "../errors/errors.js";

/** The Git settings of the canonical checkout: the commits that the factory makes and the periodic sync. */
export interface GitSettings {
  readonly commitMessage?: string;
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly push?: boolean;
  readonly pull?: boolean;
  readonly syncIntervalSeconds?: number;
}

/** The Git sync of the canonical checkout, with the defaults for the absent keys. */
export interface GitSync {
  readonly push: boolean;
  readonly pull: boolean;
  readonly syncIntervalSeconds: number;
}

/** The Git values of `rowbly factory configure`. An empty string clears the value. */
export interface GitInput {
  readonly commitMessage?: string;
  readonly commitAuthor?: string;
  readonly gitPush?: boolean;
  readonly gitPull?: boolean;
  readonly gitSyncInterval?: number;
}

type Author = Pick<GitSettings, "authorName" | "authorEmail">;
type SyncKeys = Pick<GitSettings, "push" | "pull" | "syncIntervalSeconds">;

const TEXT_KEYS: readonly (keyof GitSettings)[] = ["commitMessage", "authorName", "authorEmail"];
const GIT_KEYS: readonly (keyof GitSettings)[] = [...TEXT_KEYS, "push", "pull", "syncIntervalSeconds"];
const IDENTITY = /^([^<>\n]*[^<>\s])\s*<([^<>\s]+)>$/;

export const MIN_SYNC_SECONDS = 60;
export const MAX_SYNC_SECONDS = 86_400;
/** The message of a canonical commit without `commitMessage`. `commit-project.mjs` uses the same text. */
export const DEFAULT_COMMIT_MESSAGE = "chore(rowbly): record project changes after scan";
export const DEFAULT_GIT_SYNC: GitSync = { push: false, pull: false, syncIntervalSeconds: 300 };

function validText(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && !!value.trim());
}

function validFlag(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

/** Tells if a sync interval is absent, or a whole number of seconds in the permitted range. */
function validInterval(value: unknown): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && (value as number) >= MIN_SYNC_SECONDS && (value as number) <= MAX_SYNC_SECONDS)
  );
}

/**
 * Tells if a value is a Git section with non-empty strings, the author name and email together,
 * boolean `push` and `pull`, and a sync interval in the permitted range.
 */
export function validGit(value: unknown): value is GitSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const git = value as Record<string, unknown>;

  return (
    TEXT_KEYS.every((key) => validText(git[key])) &&
    (git.authorName === undefined) === (git.authorEmail === undefined) &&
    validFlag(git.push) &&
    validFlag(git.pull) &&
    validInterval(git.syncIntervalSeconds)
  );
}

/** Gives the Git sync settings. Absent keys use the defaults. */
export function gitSync(git: GitSettings | undefined): GitSync {
  return {
    push: git?.push ?? DEFAULT_GIT_SYNC.push,
    pull: git?.pull ?? DEFAULT_GIT_SYNC.pull,
    syncIntervalSeconds: git?.syncIntervalSeconds ?? DEFAULT_GIT_SYNC.syncIntervalSeconds,
  };
}

/** Parses a `Name <email>` identity. */
export function parseAuthor(value: string): Required<Author> {
  const match = IDENTITY.exec(value.trim());

  if (!match) {
    throw new ValidationError('Use "Name <email>" for the commit author');
  }

  return { authorName: (match[1] as string).trim(), authorEmail: match[2] as string };
}

/** Gives the `Name <email>` identity of the settings, or nothing without an author. */
export function formatAuthor(git: GitSettings | undefined): string | undefined {
  if (!git?.authorName || !git.authorEmail) {
    return undefined;
  }

  return `${git.authorName} <${git.authorEmail}>`;
}

function nextMessage(current: GitSettings | undefined, input: GitInput): string | undefined {
  if (input.commitMessage === undefined) {
    return current?.commitMessage;
  }

  return input.commitMessage.trim() ? input.commitMessage : undefined;
}

function nextAuthor(current: GitSettings | undefined, input: GitInput): Author {
  if (input.commitAuthor === undefined) {
    return { authorName: current?.authorName, authorEmail: current?.authorEmail };
  }

  return input.commitAuthor.trim() ? parseAuthor(input.commitAuthor) : {};
}

/** Gives the sync keys of the input. A key that the input does not set keeps its current value. */
function nextSync(current: GitSettings | undefined, input: GitInput): SyncKeys {
  return {
    push: input.gitPush ?? current?.push,
    pull: input.gitPull ?? current?.pull,
    syncIntervalSeconds: input.gitSyncInterval ?? current?.syncIntervalSeconds,
  };
}

/** Applies the input to the Git section. Other keys stay. Without values, the section goes away. */
export function mergeGit(current: GitSettings | undefined, input: GitInput): GitSettings | undefined {
  const changed: GitSettings = {
    commitMessage: nextMessage(current, input),
    ...nextAuthor(current, input),
    ...nextSync(current, input),
  };
  const others = Object.entries(current ?? {}).filter(([key]) => !GIT_KEYS.includes(key as keyof GitSettings));
  const values = Object.entries(changed).filter(([, value]) => value !== undefined);

  const entries = [...others, ...values];

  return entries.length > 0 ? (Object.fromEntries(entries) as GitSettings) : undefined;
}

/** Tells if the input changes the Git section. */
export function hasGitInput(input: GitInput): boolean {
  return [input.commitMessage, input.commitAuthor, input.gitPush, input.gitPull, input.gitSyncInterval].some(
    (value) => value !== undefined,
  );
}
