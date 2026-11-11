import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectConfig } from "../config/config.js";
import { listMarkdownFiles, writeFileAtomic } from "../files/files.js";
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

const STORY_FILE_NAME = /^([A-Z][A-Z0-9]*)-(\d+)\.md$/;
export function formatStoryId(projectKey: string, number: number): string {
  return `${projectKey}-${String(number).padStart(2, "0")}`;
}

export function parseStoryFileName(name: string): { projectKey: string; number: number } | undefined {
  const match = STORY_FILE_NAME.exec(name);
  return match ? { projectKey: match[1] as string, number: Number(match[2]) } : undefined;
}

export function storyPath(paths: ProjectPaths, projectKey: string, number: number): string {
  return join(paths.storiesDir, `${formatStoryId(projectKey, number)}.md`);
}

export async function readStoryFile(paths: ProjectPaths, fileName: string): Promise<StoryFile> {
  const parsed = parseStoryFileName(fileName);
  if (!parsed) throw new Error(`Not a story file name: ${fileName}`);
  const path = join(paths.storiesDir, fileName);
  const doc = parseMarkdown(await readFile(path, "utf8"), path);
  return { id: fileName.slice(0, -3), ...parsed, path, doc };
}

/** Every story file named like `<KEY>-<n>.md`, by number. Other files are left for `doctor` to report. */
export async function readStoryFiles(paths: ProjectPaths): Promise<StoryFile[]> {
  const names = (await listMarkdownFiles(paths.storiesDir)).filter((name) => parseStoryFileName(name));
  const files = await Promise.all(names.map((name) => readStoryFile(paths, name)));
  return files.sort((a, b) => a.number - b.number);
}

/**
 * `files` in their order in a stage: by the `position` in the frontmatter, then by number. A story with no
 * valid `position` (for example, a new one) comes after the stories with one. The sort is stable.
 */
export function sortStoryFiles(files: readonly StoryFile[]): StoryFile[] {
  const position = (file: StoryFile) => {
    const value = file.doc.data.position;
    return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };
  return [...files].sort((a, b) => position(a) - position(b) || a.number - b.number);
}

/** Frontmatter in a stable order: title, stage, position, the custom fields as configured, then anything else. */
export function orderStoryData(config: ProjectConfig, data: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of ["title", "stage", "position", ...config.customFields.map((field) => field.key)]) {
    if (key in data) ordered[key] = data[key];
  }
  for (const [key, value] of Object.entries(data)) {
    if (!(key in ordered)) ordered[key] = value;
  }
  return ordered;
}

export async function writeStoryFile(config: ProjectConfig, path: string, doc: MarkdownDocument): Promise<void> {
  await writeFileAtomic(path, serializeMarkdown({ data: orderStoryData(config, doc.data), body: doc.body }));
}

/**
 * Applies `change` to the frontmatter of every story and rewrites the ones it changed. Used when a
 * stage or custom field changes, so a story that is otherwise invalid is still updated.
 */
export async function rewriteStories(
  paths: ProjectPaths,
  config: ProjectConfig,
  change: (data: Record<string, unknown>, file: StoryFile) => boolean,
): Promise<number> {
  let count = 0;
  for (const file of await readStoryFiles(paths)) {
    if (!change(file.doc.data, file)) continue;
    await writeStoryFile(config, file.path, file.doc);
    count++;
  }
  return count;
}
