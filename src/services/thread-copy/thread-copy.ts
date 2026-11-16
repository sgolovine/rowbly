import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { attachmentDir, readAttachments } from "../attachment-files/attachment-files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { getStory } from "../story/story.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

/** The name of the Project folder in a copy. */
const ROWBLY_DIR = ".rowbly";

/** One tracked file of the copy. `path` is relative to the copy root and starts with `.rowbly/`. */
export interface CopyFile {
  readonly path: string;
  readonly content: string;
}

/** One PNG attachment that the copy needs. The host takes the bytes from its cache. */
export interface CopyAttachment {
  readonly storyId: string;
  readonly id: string;
}

/** The copy of the tracked `.rowbly/` files that goes to a worker host with a launch. */
export interface ThreadCopy {
  readonly files: readonly CopyFile[];
  readonly attachments: readonly CopyAttachment[];
}

/** True for a path, relative to `.rowbly/`, that the copy does not contain: private runtime files and PNG files. */
export function excludedFromCopy(relativePath: string): boolean {
  const top = relativePath.split("/")[0] ?? "";

  const lower = relativePath.toLowerCase();

  return top.startsWith("state.json") || top === "runtime" || lower.endsWith(".png") || lower.endsWith(".tmp");
}

/** Gives the paths of the regular files below the folder, relative to `.rowbly/`. Symlinks are skipped. */
async function walk(dir: string, prefix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await mapInOrder(entries, (entry) => walkEntry(dir, prefix, entry));

  return nested.flat();
}

async function walkEntry(dir: string, prefix: string, entry: Dirent): Promise<string[]> {
  const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

  if (excludedFromCopy(path)) {
    return [];
  }

  if (entry.isDirectory()) {
    return walk(join(dir, entry.name), path);
  }

  return entry.isFile() ? [path] : [];
}

async function copyFile(paths: ProjectPaths, path: string): Promise<CopyFile> {
  return { path: `${ROWBLY_DIR}/${path}`, content: await readFile(join(paths.dir, path), "utf8") };
}

async function storyAttachments(paths: ProjectPaths, storyId: string): Promise<CopyAttachment[]> {
  const records = await readAttachments(await attachmentDir(paths, storyId));

  return records.map((record) => ({ storyId, id: record.id }));
}

/**
 * Reads the tracked `.rowbly/` files of the Project for a remote launch of the Story: Stories, Stages, config, prompts,
 * Specs and the attachment manifests. It skips `state.json*`, `runtime/` and the PNG files. It also gives the PNG
 * attachments of the Story and of its upstream Stories.
 */
export async function buildThreadCopy(
  input: { readonly storyId: string },
  ctx: ServiceContext = {},
): Promise<ThreadCopy> {
  const paths = await findProject(ctx);
  const story = await getStory({ id: input.storyId }, ctx);
  const files = await mapInOrder((await walk(paths.dir, "")).toSorted(), (path) => copyFile(paths, path));
  const attachments = await mapInOrder([story.id, ...story.dependsOn], (id) => storyAttachments(paths, id));

  return { files, attachments: attachments.flat() };
}
