import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";
import type { ProjectPaths } from "../workspace/workspace.js";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export interface Attachment {
  id: string;
  name: string;
  type: "image/png";
  size: number;
  createdAt: string;
}
export interface PendingImage {
  name: string;
  bytes: Uint8Array;
}
const ID = /^a[0-9a-f-]{36}$/;
function validatePng(bytes: Uint8Array): void {
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("Attachment exceeds 10 MiB");
  }
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) {
    throw new ValidationError("Attachment must be a PNG image");
  }
}
export function validateAttachmentId(id: string): void {
  if (!ID.test(id)) {
    throw new ValidationError("Invalid attachment ID");
  }
}
function parseAttachments(text: string): Attachment[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ValidationError("Malformed attachment metadata");
  }
  if (!Array.isArray(value)) {
    throw new ValidationError("Attachment metadata must be a list");
  }
  const ids = new Set<string>();
  for (const a of value) {
    if (
      !a ||
      typeof a !== "object" ||
      typeof a.id !== "string" ||
      !ID.test(a.id) ||
      ids.has(a.id) ||
      typeof a.name !== "string" ||
      !a.name ||
      a.name === "." ||
      a.name === ".." ||
      a.name.includes("/") ||
      a.name.includes("\\") ||
      [...a.name].some((c) => c.charCodeAt(0) < 32) ||
      a.type !== "image/png" ||
      !Number.isInteger(a.size) ||
      a.size < 8 ||
      a.size > MAX_ATTACHMENT_BYTES ||
      typeof a.createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a.createdAt) ||
      !Number.isFinite(Date.parse(a.createdAt))
    ) {
      throw new ValidationError("Malformed attachment metadata", {
        hint: "Run `rowbly doctor` to check attachment files.",
      });
    }
    ids.add(a.id);
  }
  return value as Attachment[];
}
/** Refuse symlinks at every attachment path, including missing final paths. */
export async function attachmentDir(paths: ProjectPaths, storyId: string): Promise<string> {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(storyId)) {
    throw new ValidationError("Invalid attachment Story ID");
  }
  const root = join(paths.dir, "attachments");
  await Promise.all([root, join(root, storyId)].map(noSymlink));
  return join(root, storyId);
}
export async function noSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new ValidationError(`Attachment path is a symlink: ${path}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}
export async function readAttachments(dir: string): Promise<Attachment[]> {
  const path = join(dir, "manifest.json");
  await noSymlink(path);
  try {
    return parseAttachments(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
export async function writeAttachments(dir: string, records: Attachment[]): Promise<void> {
  const text = JSON.stringify(records, null, 2);
  parseAttachments(text);
  await noSymlink(join(dir, "manifest.json"));
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(`${text}\n`, "utf8");
    } finally {
      await handle.close();
    }
    await rename(temporary, join(dir, "manifest.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}
/** Copy and validate all draft bytes before the first write. */
export function prepareImages(images: readonly PendingImage[], totalLimit = false): PendingImage[] {
  const result = images.map(({ name, bytes }) => {
    const copy = new Uint8Array(bytes);
    validatePng(copy);
    const clean = basename(name.replaceAll("\\", "/"));
    if (!clean || clean === "." || clean === ".." || [...clean].some((c) => c.charCodeAt(0) < 32)) {
      throw new ValidationError("Invalid attachment name");
    }
    return { name: clean, bytes: copy };
  });
  if (totalLimit && result.reduce((n, image) => n + image.bytes.length, 0) > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("Pending images exceed 10 MiB in total");
  }
  return result;
}
/** Publish the manifest last. Roll back bytes and metadata if the Story save fails. */
export async function withAttachments<T>(
  dir: string,
  images: readonly PendingImage[],
  now: Date,
  save: () => Promise<T>,
): Promise<T> {
  if (!images.length) {
    return save();
  }
  const previous = await readAttachments(dir);
  const hadManifest = await pathExists(join(dir, "manifest.json"));
  const records = images.map(
    (image): Attachment => ({
      id: `a${randomUUID()}`,
      name: image.name,
      type: "image/png",
      size: image.bytes.length,
      createdAt: now.toISOString(),
    }),
  );
  const written: string[] = [];
  let published = false;
  try {
    await mkdir(dir, { recursive: true });
    for (const [i, image] of images.entries()) {
      const path = join(dir, `${records[i]?.id}.png`);
      const handle = await open(path, "wx");
      written.push(path);
      try {
        await handle.writeFile(image.bytes);
      } finally {
        await handle.close();
      }
    }
    await writeAttachments(dir, [...previous, ...records]);
    published = true;
    return await save();
  } catch (err) {
    if (published) {
      if (hadManifest) {
        await writeAttachments(dir, previous);
      } else {
        await rm(join(dir, "manifest.json"), { force: true });
      }
    }
    for (const path of written) {
      await rm(path, { force: true });
    }
    throw err;
  }
}
export async function moveAttachmentDirs(paths: ProjectPaths, moves: { from: string; to: string }[]): Promise<void> {
  const completed: { from: string; to: string }[] = [];
  try {
    for (const move of moves) {
      const from = await attachmentDir(paths, move.from);
      const to = await attachmentDir(paths, move.to);
      if (!(await pathExists(from))) {
        continue;
      }
      if (await pathExists(to)) {
        throw new ValidationError(`Attachment directory already exists: ${move.to}`);
      }
      await rename(from, to);
      completed.push(move);
    }
  } catch (err) {
    for (const move of completed.reverse()) {
      await rename(await attachmentDir(paths, move.to), await attachmentDir(paths, move.from));
    }
    throw err;
  }
}
export async function attachmentOwners(paths: ProjectPaths): Promise<string[]> {
  const root = join(paths.dir, "attachments");
  await noSymlink(root);
  try {
    return await readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
