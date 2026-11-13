import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RowblyError } from "../errors/errors.js";
import { listMarkdownFiles, writeFileAtomic } from "../files/files.js";
import { type MarkdownDocument, parseMarkdown, serializeMarkdown } from "../markdown/markdown.js";
import { formatStoryId } from "../story-files/story-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";

/** A spec file as it is on disk, before its contents are checked. */
export interface SpecFile {
  /** From the file name: `login-page` in `specs/login-page.md`. */
  slug: string;
  path: string;
  doc: MarkdownDocument;
}

/** Lowercase letters and digits in groups, with one `-` between the groups: `login-page`. */
export const SPEC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The frontmatter keys of a spec file. */
export const SPEC_KEYS = ["title", "stories"];

/** `"Login Page v2"` → `"login-page-v2"`; `""` when the text has no letters or digits. */
export function toSpecSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function specPath(paths: ProjectPaths, slug: string): string {
  return join(paths.specsDir, `${slug}.md`);
}

/** `row-1`, `ROW-01` or `1` → `ROW-01`; `undefined` when the value is not a story ID of the project. */
export function canonicalStoryId(projectKey: string, value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const match = /^(?:([A-Za-z][A-Za-z0-9]*)-)?(\d+)$/.exec(String(value).trim());
  if (!match || (match[1] !== undefined && match[1].toUpperCase() !== projectKey)) return undefined;
  return formatStoryId(projectKey, Number(match[2]));
}

/** The names of the spec files with a valid slug. Other files are left for `doctor` to report. */
async function listSpecFileNames(paths: ProjectPaths): Promise<string[]> {
  return (await listMarkdownFiles(paths.specsDir)).filter((name) => SPEC_SLUG_PATTERN.test(name.slice(0, -3)));
}

export async function readSpecFile(paths: ProjectPaths, slug: string): Promise<SpecFile> {
  const path = specPath(paths, slug);
  return { slug, path, doc: parseMarkdown(await readFile(path, "utf8"), path) };
}

/** Every spec file with a valid slug, by slug. */
export async function readSpecFiles(paths: ProjectPaths): Promise<SpecFile[]> {
  return Promise.all((await listSpecFileNames(paths)).map((name) => readSpecFile(paths, name.slice(0, -3))));
}

/** Frontmatter in a stable order: title, stories, then anything else. */
function orderSpecData(data: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of SPEC_KEYS) if (key in data) ordered[key] = data[key];
  for (const [key, value] of Object.entries(data)) if (!(key in ordered)) ordered[key] = value;
  return ordered;
}

export async function writeSpecFile(path: string, doc: MarkdownDocument): Promise<void> {
  await writeFileAtomic(path, serializeMarkdown({ data: orderSpecData(doc.data), body: doc.body }));
}

/**
 * Applies `change` to the story links of every spec and rewrites the specs that it changed. Used when a
 * story is deleted or renamed, so that the links follow. A spec that cannot be read is left for `doctor`.
 */
export async function rewriteSpecLinks(paths: ProjectPaths, change: (stories: string[]) => string[]): Promise<number> {
  let count = 0;
  for (const name of await listSpecFileNames(paths)) {
    let file: SpecFile;
    try {
      file = await readSpecFile(paths, name.slice(0, -3));
    } catch (error) {
      if (error instanceof RowblyError) continue;
      throw error;
    }
    const stories = file.doc.data.stories;
    if (!Array.isArray(stories)) continue;
    const next = change(stories.map(String));
    if (next.length === stories.length && next.every((id, i) => id === String(stories[i]))) continue;
    file.doc.data.stories = next;
    await writeSpecFile(file.path, file.doc);
    count++;
  }
  return count;
}
