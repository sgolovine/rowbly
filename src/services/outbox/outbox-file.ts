import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import { noSymlink } from "../attachment-files/attachment-files.js";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { withFileLock } from "../file-lock/file-lock.js";
import { pathExists, syncDirectory, writeFileAtomic } from "../files/files.js";
import {
  type AttachmentAddWrite,
  type AttachmentRemoveWrite,
  type EntryBody,
  type OutboxEntry,
  sha256Hex,
  type WriteRecorder,
} from "./outbox.js";

/** The outbox folder of a worker host and the Thread that writes to it. */
export interface OutboxTarget {
  /** The absolute path of the outbox folder. */
  readonly dir: string;
  readonly threadId: string;
}

/** The files of an outbox folder. */
export function outboxPaths(dir: string) {
  return {
    entriesFile: join(dir, "outbox.jsonl"),
    seqFile: join(dir, "seq"),
    lockFile: join(dir, "outbox.lock"),
    blobsDir: join(dir, "blobs"),
  };
}

/** The text of the file, or an empty text when the file does not exist. */
async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

/** The `seq` of one line, or 0 when the line is not a complete entry, for example after a crash in the append. */
function lineSeq(line: string): number {
  try {
    const seq = (JSON.parse(line) as { seq?: unknown }).seq;

    return typeof seq === "number" && Number.isSafeInteger(seq) ? seq : 0;
  } catch {
    return 0;
  }
}

/**
 * The last given `seq` of the folder. The `seq` file keeps it after the host removes acknowledged lines. The lines
 * also count, so that a crash after the append and before the `seq` write does not give a `seq` two times.
 */
async function lastSeq(dir: string): Promise<number> {
  const paths = outboxPaths(dir);
  const saved = Number.parseInt((await readText(paths.seqFile)).trim(), 10);
  const lines = (await readText(paths.entriesFile)).split("\n").filter((line) => line.trim() !== "");

  return Math.max(Number.isSafeInteger(saved) ? saved : 0, ...lines.map((line) => lineSeq(line)));
}

/** Appends one line to the file and syncs it to the disk. */
async function appendDurable(path: string, line: string): Promise<void> {
  const file = await open(path, "a");

  try {
    await file.appendFile(line, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

/** Appends the entry with the next `seq`. The caller holds the outbox lock. */
async function appendLocked(target: OutboxTarget, body: EntryBody): Promise<OutboxEntry> {
  const paths = outboxPaths(target.dir);
  const seq = (await lastSeq(target.dir)) + 1;
  const entry: OutboxEntry = { seq, opId: randomUUID(), threadId: target.threadId, ...body };

  await appendDurable(paths.entriesFile, `${JSON.stringify(entry)}\n`);
  // The durable write also syncs the folder, so that a new `outbox.jsonl` survives a crash.
  await writeFileAtomic(paths.seqFile, `${seq}\n`, { durable: true });

  return entry;
}

/**
 * Appends one entry to `outbox.jsonl` under an exclusive lock on `outbox.lock`, and gives the entry. The entry is
 * on the disk before the function returns. Parallel writers to the same folder get different `seq` numbers.
 */
export async function appendOutboxEntry(target: OutboxTarget, body: EntryBody): Promise<OutboxEntry> {
  await mkdir(target.dir, { recursive: true });

  return withFileLock(outboxPaths(target.dir).lockFile, () => appendLocked(target, body), {
    label: "Outbox lock",
  });
}

/**
 * Writes the PNG to `blobs/<sha256>.png` and syncs it and the folder to the disk. A blob that exists has the same
 * bytes, so the function keeps it. Gives the `sha256`.
 */
export async function writeOutboxBlob(dir: string, bytes: Uint8Array): Promise<string> {
  const { blobsDir } = outboxPaths(dir);
  const sha256 = sha256Hex(bytes);
  const path = join(blobsDir, `${sha256}.png`);

  await mkdir(blobsDir, { recursive: true });
  await Promise.all([blobsDir, path].map(noSymlink));

  if (await pathExists(path)) {
    // A different writer can have renamed the file without a sync of the folder yet.
    await syncDirectory(blobsDir);

    return sha256;
  }

  await writeFileAtomic(path, bytes, { durable: true });

  return sha256;
}

/** Writes the PNG first, then the entry. Thus an entry never points to a missing PNG. */
async function appendAttachmentAdd(target: OutboxTarget, write: AttachmentAddWrite): Promise<OutboxEntry> {
  const sha256 = await writeOutboxBlob(target.dir, write.bytes);

  return appendOutboxEntry(target, {
    storyId: write.storyId,
    type: "attachment.add",
    attachment: write.attachment,
    sha256,
  });
}

async function appendAttachmentRemove(target: OutboxTarget, write: AttachmentRemoveWrite): Promise<OutboxEntry> {
  return appendOutboxEntry(target, {
    storyId: write.storyId,
    type: "attachment.remove",
    id: write.id,
    sha256: write.sha256,
  });
}

/** A recorder that appends each Story write and each attachment write to the outbox folder of the target. */
export function fileRecorder(target: OutboxTarget): WriteRecorder {
  return {
    record: async (write) => void (await appendOutboxEntry(target, write)),
    recordAttachmentAdd: async (write) => void (await appendAttachmentAdd(target, write)),
    recordAttachmentRemove: async (write) => void (await appendAttachmentRemove(target, write)),
  };
}

/** The input of `readOutboxBlob`. `dir` is the outbox folder, from `ROWBLY_OUTBOX`. */
interface BlobInput {
  readonly dir: string | undefined;
  readonly sha256: string;
}

/** Throws a ValidationError when the input does not name a blob of an outbox folder. Gives the folder. */
function checkBlobInput(input: BlobInput): string {
  const dir = input.dir?.trim();

  if (!dir) {
    throw new ValidationError("ROWBLY_OUTBOX is not set", {
      hint: "Set ROWBLY_OUTBOX to the outbox folder of the worker host.",
    });
  }

  if (!isAbsolute(dir)) {
    throw new ValidationError(`ROWBLY_OUTBOX must be an absolute path: ${dir}`);
  }

  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new ValidationError("A blob hash must be 64 lowercase hex characters");
  }

  return dir;
}

/** Throws a NotFoundError when the blob is missing, and a ValidationError when it is not a regular file. */
async function checkBlobFile(path: string, sha256: string): Promise<void> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    throw error.code === "ENOENT" ? new NotFoundError(`Outbox blob ${sha256} not found`) : error;
  });

  if (!info.isFile()) {
    throw new ValidationError(`Outbox blob is not a regular file: ${sha256}`);
  }
}

/** Throws a ValidationError when the real path of the blob is not in the real `blobs` folder. */
async function checkInside(blobsDir: string, path: string): Promise<void> {
  const [folder, file] = await Promise.all([realpath(blobsDir), realpath(path)]);

  if (!file.startsWith(`${folder}${sep}`)) {
    throw new ValidationError("Outbox blob is outside the blobs folder");
  }
}

/** Gives the bytes of `blobs/<sha256>.png` of the outbox folder. Refuses a symlink and a path outside `blobs/`. */
export async function readOutboxBlob(input: BlobInput): Promise<Buffer> {
  const { blobsDir } = outboxPaths(checkBlobInput(input));
  const path = join(blobsDir, `${input.sha256}.png`);

  await noSymlink(blobsDir);
  await checkBlobFile(path, input.sha256);
  await checkInside(blobsDir, path);

  return readFile(path);
}
