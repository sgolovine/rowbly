import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectConfig } from "../config/config.js";
import { listMarkdownFiles, writeFileAtomic } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { type MarkdownDocument, parseMarkdown, serializeMarkdown } from "../markdown/markdown.js";
import type { ProjectPaths } from "../workspace/workspace.js";

/** A story file as it is on disk, before its contents are checked against the config. */
export interface StoryFile {
  /** From the file name: `ROW-01`. */
  id: string;
  projectKey: string;
  number: number;
  path: string;
  doc: MarkdownDocument;
}

/** A story file name in the Story folder, parsed without a read of the file. */
export interface StoryFileName {
  /** From the file name: `ROW-01`. */
  id: string;
  projectKey: string;
  number: number;
  /** `ROW-01.md`. */
  fileName: string;
}

/**
 * A change to the frontmatter of one story. Return the new frontmatter, or `false` for no change. `true` means
 * that the function changed `data`, which is a copy.
 */
export type StoryDataChange = (data: Record<string, unknown>, file: StoryFile) => Record<string, unknown> | boolean;

const STORY_FILE_NAME = /^([A-Z][A-Z0-9]*)-(\d+)\.md$/;

/** The keys that come first in the frontmatter, before the custom fields. */
const LEADING_KEYS = ["title", "stage", "position"];

/** `ROW` and `1` → `ROW-01`. */
export function formatStoryId(projectKey: string, number: number): string {
  return `${projectKey}-${String(number).padStart(2, "0")}`;
}

/** `ROW-01.md` → the project key and the number; `undefined` when the name is not a story file name. */
export function parseStoryFileName(name: string): { projectKey: string; number: number } | undefined {
  const match = STORY_FILE_NAME.exec(name);

  return match ? { projectKey: match[1] as string, number: Number(match[2]) } : undefined;
}

/** The path of the story file with this project key and number. */
export function storyPath(paths: ProjectPaths, projectKey: string, number: number): string {
  return join(paths.storiesDir, `${formatStoryId(projectKey, number)}.md`);
}

/** Reads and parses one story file. Throws when the name is not a story file name. */
export async function readStoryFile(paths: ProjectPaths, fileName: string): Promise<StoryFile> {
  const parsed = parseStoryFileName(fileName);

  if (!parsed) {
    throw new Error(`Not a story file name: ${fileName}`);
  }

  const path = join(paths.storiesDir, fileName);
  const doc = parseMarkdown(await readFile(path, "utf8"), path);

  return { id: fileName.slice(0, -3), ...parsed, path, doc };
}

/** `ROW-01.md` → its parsed name; an empty list when the name is not a story file name. */
function toStoryFileName(fileName: string): StoryFileName[] {
  const parsed = parseStoryFileName(fileName);

  return parsed ? [{ id: fileName.slice(0, -3), ...parsed, fileName }] : [];
}

/** The names of the story files named like `<KEY>-<n>.md`, from one listing of the folder. No file is read. */
export async function listStoryFileNames(paths: ProjectPaths): Promise<StoryFileName[]> {
  return (await listMarkdownFiles(paths.storiesDir)).flatMap(toStoryFileName);
}

/** Every story file named like `<KEY>-<n>.md`, by number. Other files are left for `doctor` to report. */
export async function readStoryFiles(paths: ProjectPaths): Promise<StoryFile[]> {
  const names = await listStoryFileNames(paths);
  const files = await Promise.all(names.map((name) => readStoryFile(paths, name.fileName)));

  return files.toSorted((a, b) => a.number - b.number);
}

/** The `position` of a story in its stage. A story with no valid `position` comes last. */
function storyPosition(file: StoryFile): number {
  const value = file.doc.data.position;

  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/**
 * `files` in their order in a stage: by the `position` in the frontmatter, then by number. A story with no
 * valid `position` (for example, a new one) comes after the stories with one. The sort is stable.
 */
export function sortStoryFiles(files: readonly StoryFile[]): StoryFile[] {
  return files.toSorted((a, b) => storyPosition(a) - storyPosition(b) || a.number - b.number);
}

/** Frontmatter in a stable order: title, stage, position, the custom fields as configured, then anything else. */
export function orderStoryData(config: ProjectConfig, data: Record<string, unknown>): Record<string, unknown> {
  const leading = [...LEADING_KEYS, ...config.customFields.map((field) => field.key)].filter((key) => key in data);
  const keys = new Set([...leading, ...Object.keys(data)]);

  return Object.fromEntries([...keys].map((key) => [key, data[key]]));
}

/** Writes a story file, with the frontmatter in a stable order. */
export async function writeStoryFile(config: ProjectConfig, path: string, doc: MarkdownDocument): Promise<void> {
  await writeFileAtomic(path, serializeMarkdown({ data: orderStoryData(config, doc.data), body: doc.body }));
}

/** Writes the story when `change` changes it. Gives 1 for a write and 0 for no change. */
async function rewriteStory(config: ProjectConfig, file: StoryFile, change: StoryDataChange): Promise<number> {
  const data = { ...file.doc.data };
  const result = change(data, file);

  if (result === false) {
    return 0;
  }

  await writeStoryFile(config, file.path, { ...file.doc, data: result === true ? data : result });

  return 1;
}

/**
 * Applies `change` to the frontmatter of every story and rewrites the ones it changed. Used when a
 * stage or custom field changes, so a story that is otherwise invalid is still updated.
 */
export async function rewriteStories(
  paths: ProjectPaths,
  config: ProjectConfig,
  change: StoryDataChange,
): Promise<number> {
  const files = await readStoryFiles(paths);

  const counts = await mapInOrder(files, (file) => rewriteStory(config, file, change));

  return counts.reduce((sum, count) => sum + count, 0);
}
