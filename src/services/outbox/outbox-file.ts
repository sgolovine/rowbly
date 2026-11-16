import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileLock } from "../file-lock/file-lock.js";
import { writeFileAtomic } from "../files/files.js";
import type { OutboxEntry, StoryWrite, WriteRecorder } from "./outbox.js";

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
async function appendLocked(target: OutboxTarget, write: StoryWrite): Promise<OutboxEntry> {
  const paths = outboxPaths(target.dir);
  const seq = (await lastSeq(target.dir)) + 1;
  const entry: OutboxEntry = {
    seq,
    opId: randomUUID(),
    threadId: target.threadId,
    storyId: write.storyId,
    changes: write.changes,
  };

  await appendDurable(paths.entriesFile, `${JSON.stringify(entry)}\n`);
  // The durable write also syncs the folder, so that a new `outbox.jsonl` survives a crash.
  await writeFileAtomic(paths.seqFile, `${seq}\n`, { durable: true });

  return entry;
}

/**
 * Appends one entry to `outbox.jsonl` under an exclusive lock on `outbox.lock`, and gives the entry. The entry is
 * on the disk before the function returns. Parallel writers to the same folder get different `seq` numbers.
 */
export async function appendOutboxEntry(target: OutboxTarget, write: StoryWrite): Promise<OutboxEntry> {
  await mkdir(target.dir, { recursive: true });

  return withFileLock(outboxPaths(target.dir).lockFile, () => appendLocked(target, write), {
    label: "Outbox lock",
  });
}

/** A recorder that appends each Story write to the outbox folder of the target. */
export function fileRecorder(target: OutboxTarget): WriteRecorder {
  return { record: async (write) => void (await appendOutboxEntry(target, write)) };
}
