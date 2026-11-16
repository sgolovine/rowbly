import type { ProjectConfig } from "../config/config.js";
import { readFactoryState } from "../factory-state/factory-state.js";
import { mapInOrder } from "../in-order/in-order.js";
import { formatStoryId, listStoryFileNames, type StoryFileName, storyTimeOf } from "../story-files/story-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import { type CopyGroup, type PlannedFile, type ReadStory, readStory, splitCopies, uidOf } from "./copy-plan.js";

export type { CopyGroup } from "./copy-plan.js";

/** A Story file that gets a new number. */
export interface PlannedRenumber extends PlannedFile {
  /** The new ID that the plan expects. The repair takes the next free number again. */
  readonly to: string;
  /**
   * The `uid` of the Story, when each Story of the group has a `uid`. Then the records with this `storyUid` follow
   * the Story. `undefined` for a group of the ROW-81 rules.
   */
  readonly storyUid: string | undefined;
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
  /** The copies of a Story. The repair removes them before it gives a new number. */
  readonly copies: readonly CopyGroup[];
  readonly groups: readonly DuplicateGroup[];
  readonly unrepaired: readonly UnrepairedDuplicate[];
}

/** A Story file of a group, with the values that select the Story that keeps the ID. */
interface Candidate {
  readonly file: PlannedFile;
  readonly createdAt: number;
  readonly mtimeMs: number;
  readonly factoryState: boolean;
  readonly uid: string | undefined;
}

/** An attempt of `.rowbly/state.json`: the Story ID, the Story `uid`, the Stage and the status. */
interface StoryAttempt {
  readonly story: string;
  readonly storyUid?: string;
  readonly stage: string;
  readonly status: string;
}

/** A Story file that gets a new number, before the plan gives it the expected ID. */
type RenumberFile = Omit<PlannedRenumber, "to">;

type GroupDecision =
  | { readonly group: Omit<DuplicateGroup, "renumber"> & { readonly renumber: readonly RenumberFile[] } }
  | { readonly unrepaired: UnrepairedDuplicate }
  | { readonly copy: CopyGroup };

const FACTORY_FIELDS = ["worktree", "pull_request"] as const;

/** The statuses of an attempt in which a worker can write the Story file or its attachments. */
const RUNNING_STATUSES: ReadonlySet<string> = new Set(["preparing", "running"]);

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

function candidateOf(story: ReadStory, canonicalId: string, attempts: readonly StoryAttempt[]): Candidate {
  return {
    file: story.file,
    createdAt: createdTime({ ...story.data }),
    mtimeMs: story.mtimeMs,
    factoryState: hasFactoryState(story.data, [story.file.id, canonicalId], attempts),
    uid: uidOf(story),
  };
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

function unrepairedGroup(id: string, paths: readonly string[], reason: string): GroupDecision {
  return { unrepaired: { id, paths, reason } };
}

function ruleFile(file: PlannedFile): RenumberFile {
  return { ...file, storyUid: undefined };
}

/**
 * The ROW-81 rules for a group with a Story without `uid`. Selects the Story that keeps the ID: the only Story with
 * factory state, or else the oldest Story. A group with more than one Story with factory state is not repaired.
 */
function decideByState(id: string, stories: readonly ReadStory[], attempts: readonly StoryAttempt[]): GroupDecision {
  const ordered = stories.map((story) => candidateOf(story, id, attempts)).toSorted(compareAge);
  const withState = ordered.filter((candidate) => candidate.factoryState);

  if (withState.length > 1) {
    const paths = stories.map((story) => story.file.path);

    return unrepairedGroup(id, paths, "More than one Story with this ID has factory state");
  }

  const keep = withState[0] ?? (ordered[0] as Candidate);
  const renumber = ordered.filter((candidate) => candidate !== keep).map((candidate) => ruleFile(candidate.file));

  return { group: { id, keep: keep.file, renumber } };
}

/** Tells if an attempt of a Story of the group is running: by the `uid` of a Story, or else by the Story ID. */
function isRunningAttempt(attempt: StoryAttempt, ids: readonly string[], uids: readonly string[]): boolean {
  const byUid = attempt.storyUid !== undefined && uids.includes(attempt.storyUid);

  return RUNNING_STATUSES.has(attempt.status) && (byUid || ids.includes(attempt.story));
}

/**
 * The rules for a group in which each Story has a `uid`: each file is a different Story. The oldest Story keeps the
 * ID, and factory state does not block the repair. A running attempt of a Story of the group blocks the repair,
 * because the worker can write the Story file or its attachments.
 */
function decideByUid(
  id: string,
  stories: readonly ReadStory[],
  uids: readonly string[],
  attempts: readonly StoryAttempt[],
): GroupDecision {
  const ids = [id, ...stories.map((story) => story.file.id)];

  if (attempts.some((attempt) => isRunningAttempt(attempt, ids, uids))) {
    const paths = stories.map((story) => story.file.path);

    return unrepairedGroup(id, paths, "A Story with this ID has a running attempt");
  }

  const [keep, ...rest] = stories.map((story) => candidateOf(story, id, [])).toSorted(compareAge);
  const renumber = rest.map((candidate) => ({ ...candidate.file, storyUid: candidate.uid }));

  return { group: { id, keep: (keep as Candidate).file, renumber } };
}

/** Selects the rules of the group: the `uid` rules when each Story has a `uid`, or else the ROW-81 rules. */
function decideGroup(id: string, stories: readonly ReadStory[], attempts: readonly StoryAttempt[]): GroupDecision {
  const uids = stories.flatMap((story) => uidOf(story) ?? []);

  return uids.length === stories.length
    ? decideByUid(id, stories, uids, attempts)
    : decideByState(id, stories, attempts);
}

/**
 * Plans one group of Story files with the same number. The copies of a Story go first: the newest copy stays, and
 * the other files go to the re-number rules. A group with copies that are different is not repaired.
 */
async function decideNumber(
  names: readonly StoryFileName[],
  projectKey: string,
  attempts: readonly StoryAttempt[],
): Promise<GroupDecision[]> {
  const id = formatStoryId(projectKey, names[0]?.number ?? 0);
  const read = await mapInOrder(names, readStory);
  const stories = read.filter((story): story is ReadStory => story !== undefined);

  if (stories.length !== names.length) {
    return [
      unrepairedGroup(
        id,
        names.map((name) => name.path),
        "A Story file of the group cannot be read",
      ),
    ];
  }

  const split = splitCopies(id, stories);
  const copies = split.copies.map((copy) => ({ copy }));
  const different = split.different.map((paths) =>
    unrepairedGroup(id, paths, "The copies of the Story have different content. Merge them"),
  );

  if (different.length > 0 || split.rest.length < 2) {
    return [...copies, ...different];
  }

  return [...copies, decideGroup(id, split.rest, attempts)];
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
    return { copies: [], groups: [], unrepaired: [] };
  }

  const attempts = await readAttempts(paths.root);
  const planned = await mapInOrder(duplicates, (group) => decideNumber(group, config.projectKey, attempts));
  const decisions = planned.flat();
  const highest = Math.max(0, ...names.map((name) => name.number));

  return {
    copies: decisions.flatMap((decision) => ("copy" in decision ? [decision.copy] : [])),
    groups: withExpectedIds(decisions, config.projectKey, highest),
    unrepaired: decisions.flatMap((decision) => ("unrepaired" in decision ? [decision.unrepaired] : [])),
  };
}
