import { execFile } from "node:child_process";
import { type FileHandle, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
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
import { clipboardFailure, readClipboardImage } from "../clipboard/clipboard.js";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { getStory } from "../story/story.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

export type { Attachment, PendingImage } from "../attachment-files/attachment-files.js";
export { MAX_ATTACHMENT_BYTES };

interface AddAttachmentInput {
  story: string;
  file?: string;
  fromClipboard?: boolean;
  image?: PendingImage;
}

/** Gives the file name of a clipboard image, from the UTC date and minute. */
export function clipboardName(now: Date): string {
  const iso = now.toISOString();

  return `image-${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 16).replace(":", "")}.png`;
}

async function directory(story: string, ctx: ServiceContext): Promise<string> {
  return attachmentDir(await findProject(ctx), (await getStory({ id: story }, ctx)).id);
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

async function readPngFile(file: string, ctx: ServiceContext = {}): Promise<PendingImage> {
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

/** Gives the image of the one source that the input names. */
async function sourceImage(input: AddAttachmentInput, ctx: ServiceContext): Promise<PendingImage> {
  if (input.file !== undefined) {
    return readPngFile(input.file, ctx);
  }

  if (input.fromClipboard) {
    const result = await readClipboardImage();

    if ("reason" in result) {
      throw clipboardFailure(result.reason, input.story);
    }

    return { name: clipboardName(ctx.now?.() ?? new Date()), bytes: result.bytes };
  }

  return input.image as PendingImage;
}

/** Adds one PNG to a Story from a file, the clipboard or an image in memory. */
export async function addAttachment(input: AddAttachmentInput, ctx: ServiceContext = {}) {
  const sources =
    Number(input.file !== undefined) + Number(input.fromClipboard === true) + Number(input.image !== undefined);

  if (sources !== 1) {
    throw new ValidationError("Supply exactly one PNG file or --from-clipboard");
  }

  const dir = await directory(input.story, ctx);
  const image = await sourceImage(input, ctx);

  return withAttachments(dir, prepareImages([image]), ctx.now?.() ?? new Date(), async () => {
    const records = await readAttachments(dir);

    return records[records.length - 1];
  });
}

async function selected(story: string, id: string, ctx: ServiceContext) {
  validateAttachmentId(id);

  const dir = await directory(story, ctx);
  const records = await readAttachments(dir);
  const record = records.find((a) => a.id === id);

  if (!record) {
    throw new NotFoundError(`Attachment ${id} not found on ${story}`);
  }

  const path = join(dir, `${id}.png`);

  await noSymlink(path);

  return { dir, records, record, path };
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

/** Opens an attachment in the default image application of the platform. */
export async function openAttachment(input: { story: string; id: string }, ctx: ServiceContext = {}) {
  const { path } = await selected(input.story, input.id, ctx);

  try {
    await readFile(path);

    const { command, args } = openCommand(path);

    await promisify(execFile)(command, args, { timeout: 10000, maxBuffer: 65536 });
  } catch {
    throw new ValidationError("Cannot open attachment", { hint: `Open the PNG at ${path} with an image application.` });
  }

  return { opened: input.id };
}

/** Removes an attachment. A failure restores the PNG and the index. */
export async function removeAttachment(input: { story: string; id: string }, ctx: ServiceContext = {}) {
  const { dir, records, path } = await selected(input.story, input.id, ctx);
  const temporary = `${path}.removed`;

  await rename(path, temporary);

  try {
    await writeAttachments(
      dir,
      records.filter((a) => a.id !== input.id),
    );
    await rm(temporary);
  } catch (err) {
    await rename(temporary, path);
    await writeAttachments(dir, records);
    throw err;
  }

  return { removed: input.id };
}
