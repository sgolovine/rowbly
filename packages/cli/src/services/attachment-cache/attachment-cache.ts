import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { noSymlink, validateAttachmentBytes, validateAttachmentId } from "../attachment-files/attachment-files.js";
import { NotFoundError } from "../errors/errors.js";
import { pathExists, syncDirectory } from "../files/files.js";

/**
 * One attachment file of the cache folder. `dir` is the cache folder. The caller selects it. The file name stays
 * `<id>.png` for all file types, for compatibility with the cache of an earlier version.
 */
interface CacheEntry {
  readonly dir: string;
  readonly id: string;
}

/** The path of the file of the id, after the checks of the id and of symlinks. */
async function cachePath(entry: CacheEntry): Promise<string> {
  validateAttachmentId(entry.id);

  const path = join(entry.dir, `${entry.id}.png`);

  await Promise.all([entry.dir, path].map(noSymlink));

  return path;
}

/** Writes the bytes to a new temporary file and syncs it to the disk. */
async function writeTemporary(path: string, bytes: Uint8Array): Promise<void> {
  const file = await open(path, "wx");

  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

/** Links the temporary file to its final name. A file that exists already stays, because a link does not replace. */
async function linkOnce(temporary: string, path: string): Promise<boolean> {
  try {
    await link(temporary, path);

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }

    throw error;
  }
}

/**
 * Puts the bytes of an attachment in the cache folder. The write is atomic. An id that is in the cache keeps its first
 * file, because the content of an attachment never changes. Gives whether the function wrote a new file.
 */
export async function putCachedAttachment(input: CacheEntry & { readonly bytes: Uint8Array }): Promise<boolean> {
  validateAttachmentBytes(input.bytes);

  const path = await cachePath(input);
  const temporary = join(input.dir, `.${randomUUID()}.tmp`);

  await mkdir(input.dir, { recursive: true });

  try {
    await writeTemporary(temporary, input.bytes);

    const added = await linkOnce(temporary, path);

    await syncDirectory(input.dir);

    return added;
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Gives the bytes of an attachment. A missing file gives a NotFoundError. */
export async function readCachedAttachment(input: CacheEntry): Promise<Buffer> {
  const path = await cachePath(input);

  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`Attachment ${input.id} is not in the cache`);
    }

    throw error;
  }
}

/** Tells whether the cache folder has the file of an attachment. */
export async function hasCachedAttachment(input: CacheEntry): Promise<boolean> {
  return pathExists(await cachePath(input));
}

/** Gives the ids of the list that the cache folder does not have, in the order of the list. */
export async function missingCachedAttachments(input: {
  readonly dir: string;
  readonly ids: readonly string[];
}): Promise<string[]> {
  input.ids.forEach(validateAttachmentId);

  const present = await Promise.all(input.ids.map((id) => hasCachedAttachment({ dir: input.dir, id })));

  return input.ids.filter((_id, index) => !present[index]);
}
