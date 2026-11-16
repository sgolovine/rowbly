import { readFile, stat } from "node:fs/promises";
import type { ProjectConfig } from "../config/config.js";
import { readFactoryState } from "../factory-state/factory-state.js";
import { mapInOrder } from "../in-order/in-order.js";
import { parseMarkdown } from "../markdown/markdown.js";
import { formatStoryId, listStoryFileNames, type StoryFileName, storyTimeOf } from "../story-files/story-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";

/** One Story file of a duplicate group, as the plan read it. */
interface PlannedFile {
  readonly path: string;
  /** The ID of the file name, for example `ROW-77` or `ROW-7`. */
  readonly id: string;
  /** The text of the file when the plan read it. The repair stops when the file changed. */
  readonly text: string;
  /** The Stage of the frontmatter, or `null` when it is not a string. */
  readonly stage: string | null;
}

/** A Story file that gets a new number. */
export interface PlannedRenumber extends PlannedFile {
  /** The new ID that the plan expects. The repair takes the next free number again. */
  readonly to: string;
}

/** Two or more Story files with the same number, and the Story that keeps the ID. */
export interface DuplicateGroup {
  /** The canonical ID of the number: `ROW-77`. */
  readonly id: string;
  readonly keep: PlannedFile;
  readonly renumber: readonly PlannedRenumber[];
}

/** A duplicate ID that the repair does not change, with the reason. */
export interface UnrepairedDuplicate {
  readonly id: string;
  readonly paths: readonly string[];
  readonly reason: string;
}

/** The duplicate Story IDs of the Project, and the changes that the repair makes. */
export interface DuplicatePlan {
  readonly groups: readonly DuplicateGroup[];
  readonly unrepaired: readonly UnrepairedDuplicate[];
}

/** A Story file of a group, with the values that select the Story that keeps the ID. */
interface Candidate {
  readonly file: PlannedFile;
  readonly createdAt: number;
  readonly mtimeMs: number;
  readonly factoryState: boolean;
}

/** An attempt of `.rowbly/state.json`: the Story ID and the Stage. */
interface StoryAttempt {
  readonly story: string;
  readonly stage: string;
}

type GroupDecision =
  | { readonly group: Omit<DuplicateGroup, "renumber"> & { readonly renumber: readonly PlannedFile[] } }
  | { readonly unrepaired: UnrepairedDuplicate };

const FACTORY_FIELDS = ["worktree", "pull_request"] as const;

/** The Story files of the project key, in groups of two or more files with the same number. */
function duplicateNames(names: readonly StoryFileName[], projectKey: string): StoryFileName[][] {
  const sorted = names.filter((name) => name.projectKey === projectKey).toSorted((a, b) => a.number - b.number);
  const starts = sorted.flatMap((name, index) => (sorted[index - 1]?.number === name.number ? [] : [index]));
  const runs = starts.map((start, index) => sorted.slice(start, starts[index + 1] ?? sorted.length));

  return runs.filter((run) => run.length > 1);
}

/** The attempts of the factory state. A missing or invalid state file has no attempts. The state lock is not taken. */
async function readAttempts(root: string): Promise<readonly StoryAttempt[]> {
  try {
    return (await readFactoryState(root)).attempts;
  } catch {
    return [];
  }
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim() !== "" : value !== null && value !== undefined;
}

function hasFactoryState(
  data: Readonly<Record<string, unknown>>,
  ids: readonly string[],
  attempts: readonly StoryAttempt[],
): boolean {
  const stage = data.stage;

  return (
    FACTORY_FIELDS.some((key) => hasValue(data[key])) ||
    attempts.some((attempt) => ids.includes(attempt.story) && attempt.stage === stage)
  );
}

/** A Story without a valid `createdAt` is older than each Story with one. */
function createdTime(data: Record<string, unknown>): number {
  const value = storyTimeOf(data, "createdAt");

  return value === null ? Number.NEGATIVE_INFINITY : Date.parse(value);
}

/** Reads one Story file of a group. A file that cannot be read or parsed gives `undefined`. */
async function readCandidate(
  name: StoryFileName,
  canonicalId: string,
  attempts: readonly StoryAttempt[],
): Promise<Candidate | undefined> {
  try {
    const text = await readFile(name.path, "utf8");
    const { mtimeMs } = await stat(name.path);
    const { data } = parseMarkdown(text, name.path);
    const stage = typeof data.stage === "string" ? data.stage : null;

    return {
      file: { path: name.path, id: name.id, text, stage },
      createdAt: createdTime(data),
      mtimeMs,
      factoryState: hasFactoryState(data, [name.id, canonicalId], attempts),
    };
  } catch {
    return undefined;
  }
}

function compareText(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}

/** The older Story comes first: the earliest `createdAt`, then the earliest modification time, then the path. */
function compareAge(a: Candidate, b: Candidate): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }

  return a.mtimeMs - b.mtimeMs || compareText(a.file.path, b.file.path);
}

function unrepairedGroup(id: string, names: readonly StoryFileName[], reason: string): GroupDecision {
  return { unrepaired: { id, paths: names.map((name) => name.path), reason } };
}

/**
 * Selects the Story that keeps the ID: the only Story with factory state, or else the oldest Story. A group with
 * more than one Story with factory state, or with a file that cannot be read, is not repaired.
 */
async function decideGroup(
  names: readonly StoryFileName[],
  projectKey: string,
  attempts: readonly StoryAttempt[],
): Promise<GroupDecision> {
  const id = formatStoryId(projectKey, names[0]?.number ?? 0);
  const read = await mapInOrder(names, (name) => readCandidate(name, id, attempts));
  const candidates = read.filter((candidate): candidate is Candidate => candidate !== undefined);

  if (candidates.length !== names.length) {
    return unrepairedGroup(id, names, "A Story file of the group cannot be read");
  }

  const ordered = candidates.toSorted(compareAge);
  const withState = ordered.filter((candidate) => candidate.factoryState);

  if (withState.length > 1) {
    return unrepairedGroup(id, names, "More than one Story with this ID has factory state");
  }

  const keep = withState[0] ?? (ordered[0] as Candidate);
  const renumber = ordered.filter((candidate) => candidate !== keep).map((candidate) => candidate.file);

  return { group: { id, keep: keep.file, renumber } };
}

/** Gives each Story that gets a new number the ID that the repair expects, in the order of the repair. */
function withExpectedIds(decisions: readonly GroupDecision[], projectKey: string, highest: number): DuplicateGroup[] {
  const groups = decisions.flatMap((decision) => ("group" in decision ? [decision.group] : []));
  const files = groups.flatMap((group) => group.renumber);
  const expected = new Map(files.map((file, index) => [file.path, formatStoryId(projectKey, highest + index + 1)]));

  return groups.map((group) => ({
    ...group,
    renumber: group.renumber.map((file) => ({ ...file, to: expected.get(file.path) ?? "" })),
  }));
}

/** Finds the Story files of the project key with the same number, and plans the repair. No file changes. */
export async function planDuplicates(paths: ProjectPaths, config: ProjectConfig): Promise<DuplicatePlan> {
  const names = await listStoryFileNames(paths);
  const duplicates = duplicateNames(names, config.projectKey);

  if (duplicates.length === 0) {
    return { groups: [], unrepaired: [] };
  }

  const attempts = await readAttempts(paths.root);
  const decisions = await mapInOrder(duplicates, (group) => decideGroup(group, config.projectKey, attempts));
  const highest = Math.max(0, ...names.map((name) => name.number));

  return {
    groups: withExpectedIds(decisions, config.projectKey, highest),
    unrepaired: decisions.flatMap((decision) => ("unrepaired" in decision ? [decision.unrepaired] : [])),
  };
}
