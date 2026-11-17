import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, realpath, rm } from "node:fs/promises";
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
 * Writes the attachment file to `blobs/<sha256>.png` and syncs it and the folder to the disk. The name stays `.png`
 * for all file types, for compatibility with the outbox of an earlier version. A blob that exists has the same bytes,
 * so the function keeps it. Gives the `sha256`.
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

/** The Story keys of an entry: the Story ID, and the Story `uid` when the write has one. */
function storyKeys(write: { readonly storyId: string; readonly storyUid?: string }) {
  return { storyId: write.storyId, ...(write.storyUid === undefined ? {} : { storyUid: write.storyUid }) };
}

/** Writes the file, then appends the entry. The caller holds the outbox lock. */
async function appendAttachmentLocked(target: OutboxTarget, write: AttachmentAddWrite): Promise<OutboxEntry> {
  const sha256 = await writeOutboxBlob(target.dir, write.bytes);

  return appendLocked(target, {
    ...storyKeys(write),
    type: "attachment.add",
    attachment: write.attachment,
    sha256,
  });
}

/**
 * Writes the file first, then the entry. Thus an entry never points to a missing file. The outbox lock covers both
 * writes, so that an acknowledgement cannot remove the file before the entry is there.
 */
async function appendAttachmentAdd(target: OutboxTarget, write: AttachmentAddWrite): Promise<OutboxEntry> {
  await mkdir(target.dir, { recursive: true });

  return withFileLock(outboxPaths(target.dir).lockFile, () => appendAttachmentLocked(target, write), {
    label: "Outbox lock",
  });
}

async function appendAttachmentRemove(target: OutboxTarget, write: AttachmentRemoveWrite): Promise<OutboxEntry> {
  return appendOutboxEntry(target, {
    ...storyKeys(write),
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

/** Throws a ValidationError when `value` is not the absolute path of an outbox folder. Gives the folder. */
export function checkOutboxDir(value: string | undefined): string {
  const dir = value?.trim();

  if (!dir) {
    throw new ValidationError("ROWBLY_OUTBOX is not set", {
      hint: "Set ROWBLY_OUTBOX to the outbox folder of the worker host.",
    });
  }

  if (!isAbsolute(dir)) {
    throw new ValidationError(`ROWBLY_OUTBOX must be an absolute path: ${dir}`);
  }

  return dir;
}

/** Throws a ValidationError when the input does not name a blob of an outbox folder. Gives the folder. */
function checkBlobInput(input: BlobInput): string {
  const dir = checkOutboxDir(input.dir);

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

/** Throws a ValidationError when `seq` is not a whole number of 0 or more. */
function checkSeq(seq: number): void {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new ValidationError("A seq must be a whole number of 0 or more");
  }
}

/** The lines of the text that are not empty. */
function nonEmptyLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

/** The entry of one line, or `undefined` when the line is not a complete entry. */
function parseLine(line: string): OutboxEntry | undefined {
  return lineSeq(line) > 0 ? (JSON.parse(line) as OutboxEntry) : undefined;
}

/**
 * Gives the complete entries with a `seq` greater than `afterSeq`, in `seq` order. A line that is not complete JSON,
 * for example after a crash during an append, is ignored.
 */
export async function readOutboxEntries(dir: string, afterSeq: number): Promise<OutboxEntry[]> {
  checkSeq(afterSeq);

  const lines = nonEmptyLines(await readText(outboxPaths(dir).entriesFile));

  return lines
    .map((line) => parseLine(line))
    .filter((entry): entry is OutboxEntry => entry !== undefined && entry.seq > afterSeq)
    .toSorted((a, b) => a.seq - b.seq);
}

/** The result of an acknowledgement. */
export interface AcknowledgeResult {
  /** The number of removed lines. */
  readonly removed: number;
  /** The `sha256` of each removed file. */
  readonly blobs: readonly string[];
}

/** The `sha256` of each file that an `attachment.add` line points to. */
function blobsInUse(lines: readonly string[]): Set<string> {
  const entries = lines.map((line) => parseLine(line));

  return new Set(
    entries.flatMap((entry) => (entry && "type" in entry && entry.type === "attachment.add" ? [entry.sha256] : [])),
  );
}

/** The names of the files in the folder. A missing folder has no files. */
async function fileNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

/** Removes each file of `blobs/` that no line points to. Gives the `sha256` of each removed file. */
async function removeUnusedBlobs(blobsDir: string, lines: readonly string[]): Promise<string[]> {
  await noSymlink(blobsDir);

  const inUse = blobsInUse(lines);
  const unused = (await fileNames(blobsDir))
    .map((name) => /^([0-9a-f]{64})\.png$/.exec(name)?.[1])
    .filter((sha256): sha256 is string => sha256 !== undefined && !inUse.has(sha256));

  await Promise.all(unused.map((sha256) => rm(join(blobsDir, `${sha256}.png`), { force: true })));

  return unused;
}

/** Removes the acknowledged lines and the files that no line points to. The caller holds the outbox lock. */
async function acknowledgeLocked(dir: string, seq: number): Promise<AcknowledgeResult> {
  const paths = outboxPaths(dir);
  const last = await lastSeq(dir);
  const lines = nonEmptyLines(await readText(paths.entriesFile));

  const kept = lines.filter((line) => lineSeq(line) > seq);

  // The `seq` file keeps the last `seq`, so that a new entry does not get the `seq` of a removed line.
  await writeFileAtomic(paths.seqFile, `${last}\n`, { durable: true });
  await writeFileAtomic(paths.entriesFile, kept.map((line) => `${line}\n`).join(""), { durable: true });

  const blobs = await removeUnusedBlobs(paths.blobsDir, kept);

  return { removed: lines.length - kept.length, blobs };
}

/**
 * Removes the lines with a `seq` equal to or less than `seq` under the outbox lock. A line that is not a complete
 * entry is also removed. Then removes each file of `blobs/` that no remaining `attachment.add` entry points to.
 */
export async function acknowledgeOutbox(dir: string, seq: number): Promise<AcknowledgeResult> {
  checkSeq(seq);
  await mkdir(dir, { recursive: true });

  return withFileLock(outboxPaths(dir).lockFile, () => acknowledgeLocked(dir, seq), { label: "Outbox lock" });
}
