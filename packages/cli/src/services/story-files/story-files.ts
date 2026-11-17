import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ProjectConfig } from "../config/config.js";
import { writeFileAtomic } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { type MarkdownDocument, parseMarkdown, serializeMarkdown } from "../markdown/markdown.js";
import { type ProjectPaths, storyStageDir } from "../workspace/workspace.js";
import { listStoryEntries, removeMovedStoryFile, type StoryEntry, storyWritePath } from "./story-folders.js";

export {
  isStageFolderName,
  listStoryEntries,
  listStoryFolders,
  moveStoryFile,
  removeStoryFile,
  type StoryEntry,
  storyHomePath,
} from "./story-folders.js";

/** A story file as it is on disk, before its contents are checked against the config. */
export interface StoryFile {
  /** From the file name: `ROW-01`. */
  id: string;
  projectKey: string;
  number: number;
  path: string;
  doc: MarkdownDocument;
}

/** A story file name in the Story folder or in a Stage folder, parsed without a read of the file. */
export interface StoryFileName {
  /** From the file name: `ROW-01`. */
  id: string;
  projectKey: string;
  number: number;
  /** `ROW-01.md`. */
  fileName: string;
  path: string;
  /** The Stage folder of the file, or `null` for a file directly in `stories/`. */
  folder: string | null;
}

/**
 * A change to the frontmatter of one story. Return the new frontmatter, or `false` for no change. `true` means
 * that the function changed `data`, which is a copy.
 */
export type StoryDataChange = (data: Record<string, unknown>, file: StoryFile) => Record<string, unknown> | boolean;

const STORY_FILE_NAME = /^([A-Z][A-Z0-9]*)-(\d+)\.md$/;

/** The keys that come first in the frontmatter, before the custom fields. */
const LEADING_KEYS = ["title", "stage", "position", "uid", "dependsOn", "tags", "createdAt", "updatedAt"];

/** A UUID in any case, for example `0b7c6f3e-2d4a-4f1e-9c8b-5a6d7e8f9a0b`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tells if a frontmatter value is a valid Story `uid`: a UUID string. */
export function isStoryUid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** The frontmatter keys of the creation time and the time of the last change of a story. */
export const STORY_TIME_KEYS = ["createdAt", "updatedAt"] as const;

export type StoryTimeKey = (typeof STORY_TIME_KEYS)[number];

/** `ROW` and `1` → `ROW-01`. */
export function formatStoryId(projectKey: string, number: number): string {
  return `${projectKey}-${String(number).padStart(2, "0")}`;
}

/** `ROW-01.md` → the project key and the number; `undefined` when the name is not a story file name. */
export function parseStoryFileName(name: string): { projectKey: string; number: number } | undefined {
  const match = STORY_FILE_NAME.exec(name);

  return match ? { projectKey: match[1] as string, number: Number(match[2]) } : undefined;
}

/**
 * The `dependsOn` list of the frontmatter. A missing key or a value that is not a list gives `[]`, and items that are
 * not strings are ignored, so that a bad value does not make the board unreadable.
 */
export function dependsOnOf(data: Record<string, unknown>): string[] {
  const value = data.dependsOn;

  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * The `tags` list of the frontmatter. A missing key or a value that is not a list gives `[]`, and items that are not
 * strings are ignored, so that a bad value does not make the board unreadable.
 */
export function tagsOf(data: Record<string, unknown>): string[] {
  const value = data.tags;

  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * A time of the frontmatter as it is saved. A missing value or a value that is not a valid date string gives `null`,
 * so that a bad value does not make the board unreadable.
 */
export function storyTimeOf(data: Record<string, unknown>, key: StoryTimeKey): string | null {
  const value = data[key];

  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** The frontmatter with `updatedAt` set to `now`, as an ISO 8601 UTC string. */
export function withUpdatedAt(data: Record<string, unknown>, now: Date): Record<string, unknown> {
  return { ...data, updatedAt: now.toISOString() };
}

/** The frontmatter with the `dependsOn` list. An empty list removes the key. */
export function withDependsOn(data: Record<string, unknown>, dependsOn: readonly string[]): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(data).filter(([key]) => key !== "dependsOn"));

  return dependsOn.length === 0 ? rest : { ...rest, dependsOn: [...dependsOn] };
}

/** The frontmatter with the `tags` list. An empty list removes the key. */
export function withTags(data: Record<string, unknown>, tags: readonly string[]): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(data).filter(([key]) => key !== "tags"));

  return tags.length === 0 ? rest : { ...rest, tags: [...tags] };
}

/** The path of the story file with this project key and number, in the folder of its Stage. */
export function storyPath(paths: ProjectPaths, projectKey: string, number: number, stageKey: string): string {
  return join(storyStageDir(paths, stageKey), `${formatStoryId(projectKey, number)}.md`);
}

/** The path of the story file with a new ID, in the same folder. */
export function renamedStoryPath(path: string, id: string): string {
  return join(dirname(path), `${id}.md`);
}

/** Reads and parses one story file at `path`. Throws when the file name is not a story file name. */
export async function readStoryFile(path: string): Promise<StoryFile> {
  const fileName = basename(path);
  const parsed = parseStoryFileName(fileName);

  if (!parsed) {
    throw new Error(`Not a story file name: ${fileName}`);
  }

  const doc = parseMarkdown(await readFile(path, "utf8"), path);

  return { id: fileName.slice(0, -3), ...parsed, path, doc };
}

/** A Markdown file → its parsed name; an empty list when the name is not a story file name. */
function toStoryFileName(entry: StoryEntry): StoryFileName[] {
  const parsed = parseStoryFileName(entry.fileName);

  return parsed ? [{ id: entry.fileName.slice(0, -3), ...parsed, ...entry }] : [];
}

/**
 * The names of the story files named like `<KEY>-<n>.md`, directly in `stories/` and in each Stage folder. No file
 * is read.
 */
export async function listStoryFileNames(paths: ProjectPaths): Promise<StoryFileName[]> {
  return (await listStoryEntries(paths)).flatMap(toStoryFileName);
}

/** Whether a story file with this ID is in `stories/` or in one of its Stage folders. */
export async function hasStoryFile(paths: ProjectPaths, id: string): Promise<boolean> {
  return (await listStoryFileNames(paths)).some((name) => name.id === id);
}

/**
 * Every story file named like `<KEY>-<n>.md`, directly in `stories/` and in each Stage folder, by number. Other files
 * are left for `doctor` to report.
 */
export async function readStoryFiles(paths: ProjectPaths): Promise<StoryFile[]> {
  const names = await listStoryFileNames(paths);
  const files = await Promise.all(names.map((name) => readStoryFile(name.path)));

  return files.toSorted((a, b) => a.number - b.number);
}

/** The time of the last change of a story in milliseconds. A story with no valid `updatedAt` gives negative infinity. */
function storyUpdatedTime(file: StoryFile): number {
  const value = storyTimeOf(file.doc.data, "updatedAt");

  return value === null ? Number.NEGATIVE_INFINITY : Date.parse(value);
}

/** Compares the `updatedAt` times of two stories: the most recent first. Two missing times are equal. */
function compareUpdated(a: StoryFile, b: StoryFile): number {
  const first = storyUpdatedTime(a);
  const second = storyUpdatedTime(b);

  return first === second ? 0 : Math.sign(second - first);
}

/**
 * `files` in their order in a stage: by `updatedAt`, the most recent first, then by number. A story with no valid
 * `updatedAt` comes after the stories with one. The `position` key of the frontmatter has no effect.
 */
export function sortStoryFiles(files: readonly StoryFile[]): StoryFile[] {
  return files.toSorted((a, b) => compareUpdated(a, b) || a.number - b.number);
}

/**
 * Frontmatter in a stable order: title, stage, position, uid, dependsOn, tags, the times, the custom fields as configured,
 * then anything else.
 */
export function orderStoryData(config: ProjectConfig, data: Record<string, unknown>): Record<string, unknown> {
  const leading = [...LEADING_KEYS, ...config.customFields.map((field) => field.key)].filter((key) => key in data);
  const keys = new Set([...leading, ...Object.keys(data)]);

  return Object.fromEntries([...keys].map((key) => [key, data[key]]));
}

/**
 * Writes a story file, with the frontmatter in a stable order. With `updatedAt`, the file gets this time as the time
 * of its last change. Without it, the saved time stays.
 */
export async function writeStoryFile(
  config: ProjectConfig,
  path: string,
  doc: MarkdownDocument,
  updatedAt?: Date,
): Promise<void> {
  const data = updatedAt === undefined ? doc.data : withUpdatedAt(doc.data, updatedAt);

  await writeFileAtomic(path, serializeMarkdown({ data: orderStoryData(config, data), body: doc.body }));
}

/**
 * Writes a story file in the folder of its Stage, and gives the path of the written file. When the Stage folder
 * changes, it writes the new file first and then removes the old file, so that a failure does not lose the story.
 */
export async function saveStoryFile(
  paths: ProjectPaths,
  config: ProjectConfig,
  path: string,
  doc: MarkdownDocument,
  updatedAt?: Date,
): Promise<string> {
  const target = await storyWritePath(paths, config, path, doc.data);

  await writeStoryFile(config, target, doc, updatedAt);
  await removeMovedStoryFile(paths, path, target);

  return target;
}

/** Writes the story when `change` changes it, with `now` as its `updatedAt`. Gives 1 for a write and 0 for no change. */
async function rewriteStory(
  paths: ProjectPaths,
  config: ProjectConfig,
  file: StoryFile,
  change: StoryDataChange,
  now: Date,
): Promise<number> {
  const data = { ...file.doc.data };
  const result = change(data, file);

  if (result === false) {
    return 0;
  }

  await saveStoryFile(paths, config, file.path, { ...file.doc, data: result === true ? data : result }, now);

  return 1;
}

/**
 * Applies `change` to the frontmatter of every story and rewrites the ones it changed. Used when a
 * stage or custom field changes, so a story that is otherwise invalid is still updated. Each rewritten story gets
 * `now` as its `updatedAt`, and moves to the folder of its Stage.
 */
export async function rewriteStories(
  paths: ProjectPaths,
  config: ProjectConfig,
  change: StoryDataChange,
  now: Date,
): Promise<number> {
  const files = await readStoryFiles(paths);

  const counts = await mapInOrder(files, (file) => rewriteStory(paths, config, file, change, now));

  return counts.reduce((sum, count) => sum + count, 0);
}
