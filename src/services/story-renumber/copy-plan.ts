import { readFile, stat } from "node:fs/promises";
import { parseMarkdown } from "../markdown/markdown.js";
import { type StoryFileName, storyTimeOf } from "../story-files/story-files.js";

/** One Story file of a duplicate group, as the plan read it. */
export interface PlannedFile {
  readonly path: string;
  /** The ID of the file name, for example `ROW-77` or `ROW-7`. */
  readonly id: string;
  /** The text of the file when the plan read it. The repair stops when the file changed. */
  readonly text: string;
  /** The Stage of the frontmatter, or `null` when it is not a string. */
  readonly stage: string | null;
}

/** A Story file of a number group, with its parsed frontmatter and body. */
export interface ReadStory {
  readonly file: PlannedFile;
  readonly data: Readonly<Record<string, unknown>>;
  readonly body: string;
  readonly mtimeMs: number;
}

/** Two or more files of the same Story: the same number and the same `uid`. The newest copy stays. */
export interface CopyGroup {
  /** The canonical ID of the number: `ROW-78`. */
  readonly id: string;
  readonly keep: PlannedFile;
  readonly remove: readonly PlannedFile[];
}

/** The copies of a number group, and the files that stay for the re-number rules. */
export interface CopySplit {
  readonly copies: readonly CopyGroup[];
  /** The paths of each group of copies with different content. The repair does not change them. */
  readonly different: readonly (readonly string[])[];
  /** The files without a copy, and the copy that stays of each group. */
  readonly rest: readonly ReadStory[];
}

/** The keys that are different between copies of a Story that moved to a different Stage. */
const MOVE_KEYS: ReadonlySet<string> = new Set(["stage", "position", "updatedAt"]);

/** Reads one Story file of a group. A file that cannot be read or parsed gives `undefined`. */
export async function readStory(name: StoryFileName): Promise<ReadStory | undefined> {
  try {
    const text = await readFile(name.path, "utf8");
    const { mtimeMs } = await stat(name.path);
    const { data, body } = parseMarkdown(text, name.path);
    const stage = typeof data.stage === "string" ? data.stage : null;

    return { file: { path: name.path, id: name.id, text, stage }, data, body, mtimeMs };
  } catch {
    return undefined;
  }
}

/** The `uid` of the Story, or `undefined` when the file has none. */
export function uidOf(story: ReadStory): string | undefined {
  const uid = story.data.uid;

  return typeof uid === "string" && uid.trim() !== "" ? uid : undefined;
}

/** The frontmatter without the keys of a Stage move, and the body. Two copies with the same content are equal. */
function contentOf(story: ReadStory): string {
  const entries = Object.entries(story.data)
    .filter(([key]) => !MOVE_KEYS.has(key))
    .toSorted(([a], [b]) => Number(a > b) - Number(a < b));

  return JSON.stringify([entries, story.body]);
}

function updatedTime(story: ReadStory): number {
  const value = storyTimeOf({ ...story.data }, "updatedAt");

  return value === null ? Number.NEGATIVE_INFINITY : Date.parse(value);
}

/** The copy that stays comes first: the newest `updatedAt`, then the newest modification time, then the path. */
function compareNewest(a: ReadStory, b: ReadStory): number {
  const updated = updatedTime(b) - updatedTime(a);

  if (updated !== 0 && !Number.isNaN(updated)) {
    return updated;
  }

  return b.mtimeMs - a.mtimeMs || Number(a.file.path > b.file.path) - Number(a.file.path < b.file.path);
}

/** The groups of two or more files with the same `uid`. A file without `uid` is not a copy. */
function sameUid(stories: readonly ReadStory[]): ReadStory[][] {
  const uids = [...new Set(stories.flatMap((story) => uidOf(story) ?? []))];

  return uids.map((uid) => stories.filter((story) => uidOf(story) === uid)).filter((group) => group.length > 1);
}

function isSame(group: readonly ReadStory[]): boolean {
  return new Set(group.map(contentOf)).size === 1;
}

function copyGroup(id: string, group: readonly ReadStory[]): CopyGroup {
  const [keep, ...remove] = group.toSorted(compareNewest).map((story) => story.file);

  return { id, keep: keep as PlannedFile, remove };
}

/**
 * Finds the copies of a Story in a number group. Copies that are different only in `stage`, `position` and
 * `updatedAt` give a copy group. Copies with other differences are not repaired.
 */
export function splitCopies(id: string, stories: readonly ReadStory[]): CopySplit {
  const groups = sameUid(stories);
  const same = groups.filter(isSame);
  const copies = same.map((group) => copyGroup(id, group));
  const removed = new Set(copies.flatMap((copy) => copy.remove.map((file) => file.path)));

  return {
    copies,
    different: groups.filter((group) => !isSame(group)).map((group) => group.map((story) => story.file.path)),
    rest: stories.filter((story) => !removed.has(story.file.path)),
  };
}
