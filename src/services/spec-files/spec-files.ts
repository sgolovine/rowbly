import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RowblyError } from "../errors/errors.js";
import { listMarkdownFiles, writeFileAtomic } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
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

/** The path of the spec file with this slug. */
export function specPath(paths: ProjectPaths, slug: string): string {
  return join(paths.specsDir, `${slug}.md`);
}

/** `row-1`, `ROW-01` or `1` → `ROW-01`; `undefined` when the value is not a story ID of the project. */
export function canonicalStoryId(projectKey: string, value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const match = /^(?:([A-Za-z][A-Za-z0-9]*)-)?(\d+)$/.exec(String(value).trim());

  if (!match || (match[1] !== undefined && match[1].toUpperCase() !== projectKey)) {
    return undefined;
  }

  return formatStoryId(projectKey, Number(match[2]));
}

/** The names of the spec files with a valid slug. Other files are left for `doctor` to report. */
async function listSpecFileNames(paths: ProjectPaths): Promise<string[]> {
  return (await listMarkdownFiles(paths.specsDir)).filter((name) => SPEC_SLUG_PATTERN.test(name.slice(0, -3)));
}

/** Reads and parses the spec file with this slug. */
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
  const keys = new Set([...SPEC_KEYS.filter((key) => key in data), ...Object.keys(data)]);

  return Object.fromEntries([...keys].map((key) => [key, data[key]]));
}

/** Writes a spec file, with the frontmatter in a stable order. */
export async function writeSpecFile(path: string, doc: MarkdownDocument): Promise<void> {
  await writeFileAtomic(path, serializeMarkdown({ data: orderSpecData(doc.data), body: doc.body }));
}

/** Reads a spec file. A spec that Rowbly cannot parse gives `undefined`, and stays for `doctor`. */
async function readLinkedSpec(paths: ProjectPaths, name: string): Promise<SpecFile | undefined> {
  try {
    return await readSpecFile(paths, name.slice(0, -3));
  } catch (error) {
    if (error instanceof RowblyError) {
      return undefined;
    }

    throw error;
  }
}

/** Writes the spec when `change` changes its links. Gives 1 for a write and 0 for no change. */
async function rewriteLinks(
  paths: ProjectPaths,
  name: string,
  change: (stories: string[]) => string[],
): Promise<number> {
  const file = await readLinkedSpec(paths, name);
  const stories = file?.doc.data.stories;

  if (!file || !Array.isArray(stories)) {
    return 0;
  }

  const next = change(stories.map(String));

  if (next.length === stories.length && next.every((id, i) => id === String(stories[i]))) {
    return 0;
  }

  await writeSpecFile(file.path, { ...file.doc, data: { ...file.doc.data, stories: next } });

  return 1;
}

/**
 * Applies `change` to the story links of every spec and rewrites the specs that it changed. Used when a
 * story is deleted or renamed, so that the links follow. A spec that cannot be read is left for `doctor`.
 */
export async function rewriteSpecLinks(paths: ProjectPaths, change: (stories: string[]) => string[]): Promise<number> {
  const names = await listSpecFileNames(paths);

  const counts = await mapInOrder(names, (name) => rewriteLinks(paths, name, change));

  return counts.reduce((sum, count) => sum + count, 0);
}
