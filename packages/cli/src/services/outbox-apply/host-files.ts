// The private files of the main machine for one worker host, in `runtime/hosts/<host>/`.

import { chmod, mkdir, readFile } from "node:fs/promises";
import { ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { validateHostId } from "../host/host-rules.js";
import { sha256Hex } from "../outbox/outbox.js";
import { checkRuntimeDir, type RuntimeDir, runtimeChild } from "../runtime-files/runtime-files.js";
import type { ThreadCopy } from "../thread-copy/thread-copy.js";
import type { ProjectPaths } from "../workspace/workspace.js";

const APPLIED_FILE = "outbox-applied.json";
const CONFLICTS_DIR = "conflicts";
const THREADS_DIR = "threads";
const BASE_FILE = "base.json";

/** Creates a private folder with mode 0700. */
export async function makePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

/** Checks the folder `runtime/hosts/<host>/` of the host. It does not create it. */
export async function hostDir(paths: ProjectPaths, host: string): Promise<RuntimeDir> {
  validateHostId(host);

  return checkRuntimeDir(paths, `hosts/${host}`);
}

/** Checks and creates `runtime/hosts/<host>/` with mode 0700. */
export async function preparedHostDir(paths: ProjectPaths, host: string): Promise<RuntimeDir> {
  const dir = await hostDir(paths, host);

  await makePrivateDir(await checkRuntimeDir(paths, "hosts").then((hosts) => hosts.path));
  await makePrivateDir(dir.path);

  return dir;
}

/** Gives the `seq` of the applied record, or 0 when the file is missing or has no valid `seq`. */
function parseApplied(text: string): number {
  try {
    const seq = (JSON.parse(text) as { seq?: unknown }).seq;

    return typeof seq === "number" && Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
  } catch {
    return 0;
  }
}

/** Gives the last applied `seq` of the host, from `outbox-applied.json`. A missing file gives 0. */
export async function readAppliedSeq(paths: ProjectPaths, host: string): Promise<number> {
  const file = await runtimeChild(await hostDir(paths, host), APPLIED_FILE);

  try {
    return parseApplied(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }

    throw error;
  }
}

/** Writes the last applied `seq` of the host to the disk before it returns. */
export async function writeAppliedSeq(paths: ProjectPaths, host: string, seq: number): Promise<void> {
  const file = await runtimeChild(await preparedHostDir(paths, host), APPLIED_FILE);

  await writeFileAtomic(file, `${JSON.stringify({ seq })}\n`, { durable: true, mode: 0o600 });
}

/** Keeps the file of a conflict in `runtime/hosts/<host>/conflicts/<sha256>.png` for recovery. Gives the path. */
export async function keepConflictPng(paths: ProjectPaths, host: string, bytes: Uint8Array): Promise<string> {
  const dir = await preparedHostDir(paths, host);
  const conflicts = await runtimeChild(dir, CONFLICTS_DIR);

  await makePrivateDir(conflicts);

  const file = await runtimeChild(dir, `${CONFLICTS_DIR}/${sha256Hex(bytes)}.png`);

  await writeFileAtomic(file, bytes, { durable: true, mode: 0o600 });

  return file;
}

/** The content of `runtime/hosts/<host>/threads/<thread-id>/base.json`: the copy that the main machine sent last. */
export interface CopyBase extends ThreadCopy {
  readonly version: 1;
  readonly threadId: string;
  readonly host: string;
  readonly sentAt: string;
}

function validateBaseThreadId(threadId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) {
    throw new ValidationError("Invalid Thread ID", { details: { threadId } });
  }
}

/** Gives the path of a file in `runtime/hosts/<host>/threads/<thread-id>/`. It does not create a folder. */
export async function hostThreadFile(
  paths: ProjectPaths,
  host: string,
  threadId: string,
  name: string,
): Promise<string> {
  validateBaseThreadId(threadId);

  return runtimeChild(await hostDir(paths, host), `${THREADS_DIR}/${threadId}/${name}`);
}

/**
 * Gives the path of a file in `runtime/hosts/<host>/threads/<thread-id>/`, after it creates the folders with mode
 * 0700.
 */
export async function preparedHostThreadFile(
  paths: ProjectPaths,
  host: string,
  threadId: string,
  name: string,
): Promise<string> {
  validateBaseThreadId(threadId);

  const dir = await preparedHostDir(paths, host);

  await makePrivateDir(await runtimeChild(dir, THREADS_DIR));
  await makePrivateDir(await runtimeChild(dir, `${THREADS_DIR}/${threadId}`));

  return runtimeChild(dir, `${THREADS_DIR}/${threadId}/${name}`);
}

/**
 * Writes the copy that went to the host for the Thread to `runtime/hosts/<host>/threads/<thread-id>/base.json`, with
 * mode 0600. The folders get mode 0700. A later send replaces the file. Gives the path.
 */
export async function writeCopyBase(
  paths: ProjectPaths,
  host: string,
  threadId: string,
  copy: ThreadCopy,
): Promise<string> {
  const file = await preparedHostThreadFile(paths, host, threadId, BASE_FILE);
  const base: CopyBase = {
    version: 1,
    threadId,
    host,
    sentAt: new Date().toISOString(),
    files: copy.files,
    attachments: copy.attachments,
  };

  await writeFileAtomic(file, `${JSON.stringify(base)}\n`, { durable: true, mode: 0o600 });

  return file;
}

function parseBase(text: string, threadId: string): CopyBase | undefined {
  try {
    const value = JSON.parse(text) as Partial<CopyBase> | null;

    return value?.version === 1 &&
      value.threadId === threadId &&
      Array.isArray(value.files) &&
      Array.isArray(value.attachments)
      ? (value as CopyBase)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the base of the Thread. A missing or bad file gives `undefined`. */
export async function readCopyBase(paths: ProjectPaths, host: string, threadId: string): Promise<CopyBase | undefined> {
  const file = await hostThreadFile(paths, host, threadId, BASE_FILE);

  try {
    return parseBase(await readFile(file, "utf8"), threadId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}
