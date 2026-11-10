import { execFile } from "node:child_process";
import { open, readFile, rename, rm } from "node:fs/promises";
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
} from "../attachmentFiles/attachmentFiles.js";
import { clipboardFailure, readClipboardImage } from "../clipboard/clipboard.js";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { getStory } from "../story/story.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

export type { Attachment, PendingImage } from "../attachmentFiles/attachmentFiles.js";
export { MAX_ATTACHMENT_BYTES };
export function clipboardName(now: Date): string {
  const iso = now.toISOString();
  return `image-${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 16).replace(":", "")}.png`;
}
async function directory(story: string, ctx: ServiceContext): Promise<string> {
  return attachmentDir(await findProject(ctx), (await getStory({ id: story }, ctx)).id);
}
export async function listAttachments(input: { story: string }, ctx: ServiceContext = {}) {
  return readAttachments(await directory(input.story, ctx));
}
async function readPngFile(file: string, ctx: ServiceContext = {}): Promise<PendingImage> {
  const handle = await open(resolve(ctx.cwd ?? process.cwd(), file), "r").catch(() => {
    throw new NotFoundError(`Cannot read file: ${file}`);
  });
  try {
    if ((await handle.stat()).size > MAX_ATTACHMENT_BYTES) throw new ValidationError("Attachment exceeds 10 MiB");
    // Read at most one byte past the limit, even if the source changes after stat.
    const bytes = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    return prepareImages([{ name: file, bytes: bytes.subarray(0, length) }])[0] as PendingImage;
  } finally {
    await handle.close();
  }
}
export async function addAttachment(
  input: { story: string; file?: string; fromClipboard?: boolean; image?: PendingImage },
  ctx: ServiceContext = {},
) {
  const sources =
    Number(input.file !== undefined) + Number(input.fromClipboard === true) + Number(input.image !== undefined);
  if (sources !== 1) throw new ValidationError("Supply exactly one PNG file or --from-clipboard");
  const dir = await directory(input.story, ctx);
  let image = input.image;
  if (input.file !== undefined) image = await readPngFile(input.file, ctx);
  if (input.fromClipboard) {
    const result = await readClipboardImage();
    if ("reason" in result) throw clipboardFailure(result.reason, input.story);
    image = { name: clipboardName(ctx.now?.() ?? new Date()), bytes: result.bytes };
  }
  return withAttachments(dir, prepareImages([image as PendingImage]), ctx.now?.() ?? new Date(), async () => {
    const records = await readAttachments(dir);
    return records[records.length - 1];
  });
}
async function selected(story: string, id: string, ctx: ServiceContext) {
  validateAttachmentId(id);
  const dir = await directory(story, ctx);
  const records = await readAttachments(dir);
  const record = records.find((a) => a.id === id);
  if (!record) throw new NotFoundError(`Attachment ${id} not found on ${story}`);
  const path = join(dir, `${id}.png`);
  await noSymlink(path);
  return { dir, records, record, path };
}
export async function openAttachment(input: { story: string; id: string }, ctx: ServiceContext = {}) {
  const { path } = await selected(input.story, input.id, ctx);
  try {
    await readFile(path);
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
    const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", path] : [path];
    await promisify(execFile)(command, args, { timeout: 10000, maxBuffer: 65536 });
  } catch {
    throw new ValidationError("Cannot open attachment", { hint: `Open the PNG at ${path} with an image application.` });
  }
  return { opened: input.id };
}
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
