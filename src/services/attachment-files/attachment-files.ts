import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { Store } from "../store/store.js";
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

/** The files that a save wrote so far, for the rollback. */
interface SaveProgress {
  readonly written: readonly string[];
  readonly published: boolean;
}

interface AttachmentMove {
  readonly from: string;
  readonly to: string;
}

/** The folder moves that completed so far, for the rollback. */
interface MoveProgress {
  readonly completed: readonly AttachmentMove[];
}

const ID = /^a[0-9a-f-]{36}$/;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function validatePng(bytes: Uint8Array): void {
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("Attachment exceeds 10 MiB");
  }

  if (!PNG_SIGNATURE.every((v, i) => bytes[i] === v)) {
    throw new ValidationError("Attachment must be a PNG image");
  }
}

/** Throws a ValidationError when `id` is not an attachment ID. */
export function validateAttachmentId(id: string): void {
  if (!ID.test(id)) {
    throw new ValidationError("Invalid attachment ID");
  }
}

/** A name is one path segment without control characters. */
function isSafeName(name: string): boolean {
  return (
    !!name &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    ![...name].some((c) => c.charCodeAt(0) < 32)
  );
}

function isCreatedAt(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isAttachment(a: unknown): a is Attachment {
  if (!a || typeof a !== "object") {
    return false;
  }

  const record = a as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    ID.test(record.id) &&
    typeof record.name === "string" &&
    isSafeName(record.name) &&
    record.type === "image/png" &&
    Number.isInteger(record.size) &&
    (record.size as number) >= 8 &&
    (record.size as number) <= MAX_ATTACHMENT_BYTES &&
    isCreatedAt(record.createdAt)
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("Malformed attachment metadata");
  }
}

function parseAttachments(text: string): Attachment[] {
  const value = parseJson(text);

  if (!Array.isArray(value)) {
    throw new ValidationError("Attachment metadata must be a list");
  }

  if (!value.every(isAttachment) || new Set(value.map((a) => a.id)).size !== value.length) {
    throw new ValidationError("Malformed attachment metadata", {
      hint: "Run `rowbly doctor` to check attachment files.",
    });
  }

  return value;
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

/** Throws a ValidationError when `path` is a symlink. An absent path is accepted. */
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

/** Reads the manifest of an attachment folder. An absent manifest gives no attachments. */
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

/** Validates the records, then replaces the manifest through a temporary file and an atomic rename. */
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

function prepareImage({ name, bytes }: PendingImage): PendingImage {
  const copy = new Uint8Array(bytes);

  validatePng(copy);

  const clean = basename(name.replaceAll("\\", "/"));

  if (!clean || clean === "." || clean === ".." || [...clean].some((c) => c.charCodeAt(0) < 32)) {
    throw new ValidationError("Invalid attachment name");
  }

  return { name: clean, bytes: copy };
}

/** Copy and validate all draft bytes before the first write. */
export function prepareImages(images: readonly PendingImage[], totalLimit = false): PendingImage[] {
  const result = images.map(prepareImage);

  if (totalLimit && result.reduce((n, image) => n + image.bytes.length, 0) > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("Pending images exceed 10 MiB in total");
  }

  return result;
}

/** Writes one image to a new file. The progress records the file as soon as it exists. */
async function writeImage(
  dir: string,
  image: PendingImage,
  record: Attachment | undefined,
  progress: Store<SaveProgress>,
): Promise<void> {
  const path = join(dir, `${record?.id}.png`);
  const handle = await open(path, "wx");

  progress.update((state) => ({ written: [...state.written, path] }));

  try {
    await handle.writeFile(image.bytes);
  } finally {
    await handle.close();
  }
}

/** Writes each image to a new file, one at a time. */
async function writeImages(
  dir: string,
  images: readonly PendingImage[],
  records: readonly Attachment[],
  progress: Store<SaveProgress>,
): Promise<void> {
  await mapInOrder(images, (image, i) => writeImage(dir, image, records[i], progress));
}

async function rollBackSave(
  dir: string,
  progress: SaveProgress,
  hadManifest: boolean,
  previous: Attachment[],
): Promise<void> {
  if (progress.published) {
    if (hadManifest) {
      await writeAttachments(dir, previous);
    } else {
      await rm(join(dir, "manifest.json"), { force: true });
    }
  }

  await mapInOrder(progress.written, (path) => rm(path, { force: true }));
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
  const progress = new Store<SaveProgress>({ written: [], published: false });

  try {
    await mkdir(dir, { recursive: true });
    await writeImages(dir, images, records, progress);
    await writeAttachments(dir, [...previous, ...records]);
    progress.update(() => ({ published: true }));

    return await save();
  } catch (err) {
    await rollBackSave(dir, progress.current, hadManifest, previous);
    throw err;
  }
}

/** Moves one attachment folder. A Story without attachments moves nothing. Gives whether it moved. */
async function moveAttachmentDir(paths: ProjectPaths, move: AttachmentMove): Promise<boolean> {
  const from = await attachmentDir(paths, move.from);
  const to = await attachmentDir(paths, move.to);

  if (!(await pathExists(from))) {
    return false;
  }

  if (await pathExists(to)) {
    throw new ValidationError(`Attachment directory already exists: ${move.to}`);
  }

  await rename(from, to);

  return true;
}

/** Moves one folder and records the move, so that a later failure can move it back. */
async function moveAndRecord(paths: ProjectPaths, move: AttachmentMove, progress: Store<MoveProgress>): Promise<void> {
  if (await moveAttachmentDir(paths, move)) {
    progress.update((state) => ({ completed: [...state.completed, move] }));
  }
}

/** Moves a completed folder back to its first name. */
async function moveBack(paths: ProjectPaths, move: AttachmentMove): Promise<void> {
  await rename(await attachmentDir(paths, move.to), await attachmentDir(paths, move.from));
}

/** Moves the attachment folders of renamed Stories. A failure moves the completed folders back. */
export async function moveAttachmentDirs(paths: ProjectPaths, moves: { from: string; to: string }[]): Promise<void> {
  const progress = new Store<MoveProgress>({ completed: [] });

  try {
    await mapInOrder(moves, (move) => moveAndRecord(paths, move, progress));
  } catch (err) {
    await mapInOrder(progress.current.completed.toReversed(), (move) => moveBack(paths, move));
    throw err;
  }
}

/** Lists the Story IDs that have an attachment folder. */
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
