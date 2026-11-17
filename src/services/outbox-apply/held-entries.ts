// The held entries of an abandoned remote Thread, in `runtime/hosts/<host>/held/<threadId>/`. The main machine never
// applies them automatically. Change the files only under the Project write lock.

import { readFile, rm } from "node:fs/promises";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { type OutboxEntry, sha256Hex } from "../outbox/outbox.js";
import { runtimeChild } from "../runtime-files/runtime-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import { type AbandonedHold, type ApplyEnv, isTransportFailure } from "./apply-state.js";
import { hostDir, makePrivateDir, preparedHostDir } from "./host-files.js";
import { checkEntry } from "./outbox-shape.js";

const HELD_DIR = "held";
const ENTRIES_FILE = "entries.jsonl";
const BLOBS_DIR = "blobs";
const SHA256 = /^[0-9a-f]{64}$/;

/** One entry that the apply held. */
export interface HeldRef {
  readonly threadId: string;
  readonly seq: number;
}

/** Throws a ValidationError when the Thread ID is not safe as a folder name. */
function checkThreadId(threadId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) {
    throw new ValidationError("Invalid Thread ID", { details: { threadId } });
  }
}

/** Gives the path below `held/<threadId>/` of the host, or the folder itself. It does not create it. */
async function heldPath(paths: ProjectPaths, host: string, threadId: string, child = ""): Promise<string> {
  checkThreadId(threadId);

  return runtimeChild(await hostDir(paths, host), `${HELD_DIR}/${threadId}${child ? `/${child}` : ""}`);
}

/** Creates `held/<threadId>/` and the folders above it with mode 0700. */
async function prepareHeldDir(paths: ProjectPaths, host: string, threadId: string): Promise<void> {
  const dir = await preparedHostDir(paths, host);

  await makePrivateDir(await runtimeChild(dir, HELD_DIR));
  await makePrivateDir(await heldPath(paths, host, threadId));
}

/** Gives the entries of the file text. A line that is not an entry is ignored. */
function parseEntries(text: string): OutboxEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        const checked = checkEntry(JSON.parse(line));

        return checked.entry ? [checked.entry] : [];
      } catch {
        return [];
      }
    });
}

/** Reads the held entries of the Thread, in `seq` order. A missing file gives no entries. */
export async function readHeldEntries(paths: ProjectPaths, host: string, threadId: string): Promise<OutboxEntry[]> {
  try {
    const text = await readFile(await heldPath(paths, host, threadId, ENTRIES_FILE), "utf8");

    return parseEntries(text).toSorted((a, b) => a.seq - b.seq);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

/** Removes the held folder of the Thread. A missing folder is not an error. */
export async function removeHeld(paths: ProjectPaths, host: string, threadId: string): Promise<void> {
  await rm(await heldPath(paths, host, threadId), { recursive: true, force: true });
}

/** Writes the held entries of the Thread to the disk. An empty list removes the held folder. */
export async function writeHeldEntries(
  paths: ProjectPaths,
  host: string,
  threadId: string,
  entries: readonly OutboxEntry[],
): Promise<void> {
  if (entries.length === 0) {
    await removeHeld(paths, host, threadId);

    return;
  }

  await prepareHeldDir(paths, host, threadId);

  const text = entries.map((entry) => JSON.stringify(entry)).join("\n");

  await writeFileAtomic(await heldPath(paths, host, threadId, ENTRIES_FILE), `${text}\n`, {
    durable: true,
    mode: 0o600,
  });
}

/** Reads the kept file of a held `attachment.add` entry. A missing file gives a NotFoundError. */
export async function readHeldBlob(
  paths: ProjectPaths,
  host: string,
  threadId: string,
  sha256: string,
): Promise<Uint8Array> {
  if (!SHA256.test(sha256)) {
    throw new ValidationError("Invalid sha256");
  }

  try {
    return await readFile(await heldPath(paths, host, threadId, `${BLOBS_DIR}/${sha256}.png`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`The held file ${sha256}.png does not exist`);
    }

    throw error;
  }
}

/** Gets the file of the entry from the host. A connection failure throws. A bad file gives `undefined`. */
async function fetchHeldPng(env: ApplyEnv, sha256: string): Promise<Uint8Array | undefined> {
  try {
    const bytes = await env.source.blob(sha256);

    return sha256Hex(bytes) === sha256 ? bytes : undefined;
  } catch (error) {
    if (isTransportFailure(error)) {
      throw error;
    }

    return undefined;
  }
}

/** Keeps the file of a held `attachment.add` entry in `held/<threadId>/blobs/<sha256>.png`. */
async function keepHeldPng(env: ApplyEnv, threadId: string, entry: OutboxEntry): Promise<void> {
  if (!("type" in entry) || entry.type !== "attachment.add") {
    return;
  }

  const bytes = await fetchHeldPng(env, entry.sha256);

  if (!bytes) {
    return;
  }

  await prepareHeldDir(env.paths, env.host, threadId);
  await makePrivateDir(await heldPath(env.paths, env.host, threadId, BLOBS_DIR));
  await writeFileAtomic(await heldPath(env.paths, env.host, threadId, `${BLOBS_DIR}/${entry.sha256}.png`), bytes, {
    durable: true,
    mode: 0o600,
  });
}

/**
 * Holds one entry of an abandoned Thread: it keeps the file of an `attachment.add` entry and adds the entry to
 * `entries.jsonl`. An entry with the same `seq` goes in one time. A connection failure throws before the write.
 */
export async function holdEntry(env: ApplyEnv, entry: OutboxEntry): Promise<void> {
  const { threadId } = entry;

  await keepHeldPng(env, threadId, entry);

  const entries = await readHeldEntries(env.paths, env.host, threadId);

  if (entries.some((held) => held.seq === entry.seq)) {
    return;
  }

  await writeHeldEntries(env.paths, env.host, threadId, [...entries, entry]);
}

/** Gives the abandoned Thread that holds the entry, or `undefined` for an entry that the apply applies. */
export function holdingThread(
  abandoned: readonly AbandonedHold[] | undefined,
  value: unknown,
): OutboxEntry | undefined {
  const { entry } = checkEntry(value);

  if (!entry || !abandoned) {
    return undefined;
  }

  const hold = abandoned.find((candidate) => candidate.threadId === entry.threadId);

  return hold && entry.seq > hold.appliedSeq ? entry : undefined;
}
