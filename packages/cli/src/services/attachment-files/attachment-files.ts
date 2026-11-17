import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { Store } from "../store/store.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import { attachmentFileName, attachmentType, isMimeType } from "./attachment-type.js";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface Attachment {
  id: string;
  name: string;
  /** The MIME type, for example `image/png` or `application/octet-stream`. */
  type: string;
  size: number;
  createdAt: string;
  /** The `uid` of the Story when the record was made. An old record, or a record of a Story without a `uid`, has none. */
  storyUid?: string;
}

/** The options of `withAttachments`. */
interface SaveOptions {
  /** The id of each image, in the same order. An image without an id gets a new id. */
  readonly ids?: readonly (string | undefined)[];
  /** The `uid` of the Story. Each new record gets it. */
  readonly storyUid?: string;
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

/** Throws a ValidationError when the bytes are larger than 10 MiB. An attachment can have any file type. */
export function validateAttachmentBytes(bytes: Uint8Array): void {
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("Attachment exceeds 10 MiB");
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
    isMimeType(record.type) &&
    Number.isInteger(record.size) &&
    (record.size as number) >= 0 &&
    (record.size as number) <= MAX_ATTACHMENT_BYTES &&
    isCreatedAt(record.createdAt) &&
    (record.storyUid === undefined || typeof record.storyUid === "string")
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

  validateAttachmentBytes(copy);

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
  record: Attachment,
  progress: Store<SaveProgress>,
): Promise<void> {
  const path = join(dir, attachmentFileName(record));
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
  await mapInOrder(images, (image, i) => writeImage(dir, image, records[i] as Attachment, progress));
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

/** Throws when a given id is not an attachment ID, is in the manifest already, or is given two times. */
function checkGivenIds(ids: readonly (string | undefined)[], previous: readonly Attachment[]): void {
  const given = ids.filter((id): id is string => id !== undefined);

  given.forEach(validateAttachmentId);

  const taken = new Set(previous.map((record) => record.id));
  const duplicate = given.find((id, index) => taken.has(id) || given.indexOf(id) !== index);

  if (duplicate !== undefined) {
    throw new ConflictError(`Attachment ${duplicate} already exists`);
  }
}

/** The new records of the images, made at `now`. */
function newRecords(images: readonly PendingImage[], now: Date, options: SaveOptions): Attachment[] {
  const { ids = [], storyUid } = options;

  return images.map(
    (image, index): Attachment => ({
      id: ids[index] ?? `a${randomUUID()}`,
      name: image.name,
      type: attachmentType(image.name, image.bytes),
      size: image.bytes.length,
      createdAt: now.toISOString(),
      ...(storyUid === undefined ? {} : { storyUid }),
    }),
  );
}

/**
 * Publish the manifest last. Roll back bytes and metadata if the Story save fails. See `SaveOptions` for the ids
 * and the Story `uid` of the new records.
 */
export async function withAttachments<T>(
  dir: string,
  images: readonly PendingImage[],
  now: Date,
  save: () => Promise<T>,
  options: SaveOptions = {},
): Promise<T> {
  if (!images.length) {
    return save();
  }

  const previous = await readAttachments(dir);

  checkGivenIds((options.ids ?? []).slice(0, images.length), previous);

  const hadManifest = await pathExists(join(dir, "manifest.json"));
  const records = newRecords(images, now, options);
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
