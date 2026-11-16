import { execFile } from "node:child_process";
import { type FileHandle, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type Attachment,
  attachmentDir,
  MAX_ATTACHMENT_BYTES,
  noSymlink,
  type PendingImage,
  prepareImages,
  readAttachments,
  validateAttachmentId,
  withAttachments,
  writeAttachments,
} from "../attachment-files/attachment-files.js";
import { attachmentFileName } from "../attachment-files/attachment-type.js";
import { type ClipboardImageType, clipboardFailure, readClipboard } from "../clipboard/clipboard.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { pathExists, writeFileAtomic } from "../files/files.js";
import { recordAttachmentAdd, recordAttachmentRemove, sha256Hex } from "../outbox/outbox.js";
import { getStory, storyUidField, touchStory } from "../story/story.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

export type { Attachment, PendingImage } from "../attachment-files/attachment-files.js";
export { MAX_ATTACHMENT_BYTES };

interface AddAttachmentInput {
  story: string;
  file?: string;
  fromClipboard?: boolean;
  image?: PendingImage;
  /** The id of the new attachment. Without an id, the service makes a new id. */
  id?: string;
}

const CLIPBOARD_EXTENSIONS: Readonly<Record<ClipboardImageType, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/** Gives the file name of a clipboard image, from the UTC date and minute and the image type. */
export function clipboardName(now: Date, type: ClipboardImageType = "image/png"): string {
  const iso = now.toISOString();

  return `image-${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 16).replace(":", "")}${CLIPBOARD_EXTENSIONS[type]}`;
}

async function directory(story: string, ctx: ServiceContext): Promise<string> {
  return attachmentDir(await findProject(ctx), (await getStory({ id: story }, ctx)).id);
}

/** The last attachment of the Story, after the Story gets the time of the change. */
async function addedAttachment(dir: string, story: string, ctx: ServiceContext) {
  const records = await readAttachments(dir);

  await touchStory({ id: story }, ctx);

  return records[records.length - 1] as Attachment;
}

/** Lists the attachments of a Story. */
export async function listAttachments(input: { story: string }, ctx: ServiceContext = {}) {
  return readAttachments(await directory(input.story, ctx));
}

/** Reads into `bytes` from `length` until the buffer is full or the file ends. Gives the new length. */
async function readUntilFull(handle: FileHandle, bytes: Buffer, length: number): Promise<number> {
  if (length >= bytes.length) {
    return length;
  }

  const result = await handle.read(bytes, length, bytes.length - length, null);

  if (!result.bytesRead) {
    return length;
  }

  return readUntilFull(handle, bytes, length + result.bytesRead);
}

/** Reads a file of any type. A file that is larger than 10 MiB fails. */
async function readAttachmentFile(file: string, ctx: ServiceContext = {}): Promise<PendingImage> {
  const handle = await open(resolve(ctx.cwd ?? process.cwd(), file), "r").catch(() => {
    throw new NotFoundError(`Cannot read file: ${file}`);
  });

  try {
    if ((await handle.stat()).size > MAX_ATTACHMENT_BYTES) {
      throw new ValidationError("Attachment exceeds 10 MiB");
    }

    // Read at most one byte past the limit, even if the source changes after stat.
    const bytes = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1);
    const length = await readUntilFull(handle, bytes, 0);

    return prepareImages([{ name: file, bytes: bytes.subarray(0, length) }])[0] as PendingImage;
  } finally {
    await handle.close();
  }
}

/** Reads a file that the user copied. A path that is not a regular file fails before the read. */
async function readClipboardFile(path: string, ctx: ServiceContext): Promise<PendingImage> {
  const stats = await stat(path).catch(() => {
    throw new NotFoundError(`Cannot read file: ${path}`);
  });

  if (!stats.isFile()) {
    throw new ValidationError("The clipboard file is not a regular file");
  }

  return readAttachmentFile(path, ctx);
}

/** Gives the attachment on the clipboard: a copied file with its name, or an image with a name from the time. */
export async function readClipboardAttachment(ctx: ServiceContext = {}, story?: string): Promise<PendingImage> {
  const result = await readClipboard();

  if ("reason" in result) {
    throw clipboardFailure(result.reason, story);
  }

  if (result.kind === "file") {
    return readClipboardFile(result.path, ctx);
  }

  return { name: clipboardName(ctx.now?.() ?? new Date(), result.type), bytes: result.bytes };
}

/** Gives the file of the one source that the input names. */
async function sourceImage(input: AddAttachmentInput, ctx: ServiceContext): Promise<PendingImage> {
  if (input.file !== undefined) {
    return readAttachmentFile(input.file, ctx);
  }

  if (input.fromClipboard) {
    return readClipboardAttachment(ctx, input.story);
  }

  return input.image as PendingImage;
}

/** Adds one file to a Story from a file path, the clipboard or bytes in memory. */
export async function addAttachment(input: AddAttachmentInput, ctx: ServiceContext = {}) {
  const sources =
    Number(input.file !== undefined) + Number(input.fromClipboard === true) + Number(input.image !== undefined);

  if (sources !== 1) {
    throw new ValidationError("Supply exactly one file or --from-clipboard");
  }

  const story = await getStory({ id: input.story }, ctx);
  const dir = await attachmentDir(await findProject(ctx), story.id);
  const images = prepareImages([await sourceImage(input, ctx)]);
  const attachment = await withAttachments(
    dir,
    images,
    ctx.now?.() ?? new Date(),
    () => addedAttachment(dir, input.story, ctx),
    { ids: [input.id], ...storyUidField(story) },
  );

  // The copy has the attachment now. The recorder writes the file, then the entry.
  await recordAttachmentAdd(ctx, {
    storyId: story.id,
    ...storyUidField(story),
    attachment,
    bytes: (images[0] as PendingImage).bytes,
  });

  return attachment;
}

async function selected(story: string, id: string, ctx: ServiceContext) {
  validateAttachmentId(id);

  const found = await getStory({ id: story }, ctx);
  const storyId = found.id;
  const dir = await attachmentDir(await findProject(ctx), storyId);
  const records = await readAttachments(dir);
  const record = records.find((a) => a.id === id);

  if (!record) {
    throw new NotFoundError(`Attachment ${id} not found on ${story}`);
  }

  const path = join(dir, attachmentFileName(record));

  await noSymlink(path);

  return { storyId, storyUid: storyUidField(found), dir, records, record, path };
}

/** The input of `getAttachment`. */
interface GetAttachmentInput {
  readonly story: string;
  readonly id: string;
}

/** Puts the bytes of a fetched file in the copy of a remote worker. Bytes of a different size are refused. */
async function writeFetchedFile(path: string, record: Attachment, bytes: Uint8Array): Promise<void> {
  if (bytes.length !== record.size) {
    throw new ConflictError(`The file of attachment ${record.id} has ${bytes.length} bytes, not ${record.size}`);
  }

  await writeFileAtomic(path, bytes);
}

/**
 * Gives the attachment record and the absolute path of its file. In the copy of a remote worker, a file that is not
 * in the copy comes from the attachment source of the host. Without a source, a missing file gives a NotFoundError.
 */
export async function getAttachment(input: GetAttachmentInput, ctx: ServiceContext = {}) {
  const { storyId, record, path } = await selected(input.story, input.id, ctx);

  if (await pathExists(path)) {
    return { ...record, path };
  }

  if (!ctx.remoteAttachments) {
    throw new NotFoundError(`The file of attachment ${input.id} is missing on ${storyId}`, {
      hint: "Run `rowbly doctor` to check attachment files.",
    });
  }

  await writeFetchedFile(path, record, await ctx.remoteAttachments.fetch({ storyId, id: record.id }));

  return { ...record, path };
}

/** Gives the command of the platform that opens a file in its default application. */
function openCommand(path: string): { command: string; args: string[] } {
  if (process.platform === "darwin") {
    return { command: "open", args: [path] };
  }

  if (process.platform === "win32") {
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", path] };
  }

  return { command: "xdg-open", args: [path] };
}

/** Opens an attachment in the default application of the platform for its file type. */
export async function openAttachment(input: { story: string; id: string }, ctx: ServiceContext = {}) {
  const { path } = await selected(input.story, input.id, ctx);

  try {
    await readFile(path);

    const { command, args } = openCommand(path);

    await promisify(execFile)(command, args, { timeout: 10000, maxBuffer: 65536 });
  } catch {
    throw new ValidationError("Cannot open attachment", { hint: `Open the file at ${path}.` });
  }

  return { opened: input.id };
}

/** Removes an attachment. A failure restores the file and the index. */
export async function removeAttachment(input: { story: string; id: string }, ctx: ServiceContext = {}) {
  const { storyId, storyUid, dir, records, path } = await selected(input.story, input.id, ctx);
  const temporary = `${path}.removed`;
  // Only a remote worker needs the hash, so a local remove does not read the file.
  const sha256 = ctx.recorder ? sha256Hex(await readFile(path)) : "";

  await rename(path, temporary);

  try {
    await writeAttachments(
      dir,
      records.filter((a) => a.id !== input.id),
    );
    await touchStory({ id: input.story }, ctx);
    await rm(temporary);
  } catch (err) {
    await rename(temporary, path);
    await writeAttachments(dir, records);
    throw err;
  }

  await recordAttachmentRemove(ctx, { storyId, ...storyUid, id: input.id, sha256 });

  return { removed: input.id };
}
