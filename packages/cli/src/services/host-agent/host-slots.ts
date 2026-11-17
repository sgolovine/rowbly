import { readdir, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { type Owner, type OwnerProbe, probeOwner } from "../factory-ownership/ownership-lock.js";
import { withFileLock } from "../file-lock/file-lock.js";
import { writeFileAtomic } from "../files/files.js";
import { HostNoFreeSlotError } from "../host-transport/host-errors.js";
import { mapInOrder } from "../in-order/in-order.js";
import { ensurePrivateDir, type SlotPaths, slotPaths, validateProjectId } from "./host-agent-paths.js";

/** The content of one slot file. */
interface SlotRecord {
  readonly version: 1;
  readonly projectId: string;
  readonly threadId: string;
  readonly owner: Owner;
}

/** The used and the maximum slots of the host. */
export interface SlotUsage {
  readonly used: number;
  readonly max: number;
}

/** The options of a slot call. Tests give a temporary home folder and a fake probe. */
export interface SlotOptions {
  readonly home?: string;
  readonly probe?: OwnerProbe;
}

/** The identity of one slot: the Project and the Thread. */
export interface SlotKey {
  readonly projectId: string;
  readonly threadId: string;
}

function slotFile(paths: SlotPaths, key: SlotKey): string {
  return join(paths.dir, `${validateProjectId(key.projectId)}--${key.threadId}.json`);
}

/** Throws a ValidationError when the limit is not a whole number of 1 or more. */
function checkLimit(maxWorkers: unknown): number {
  if (typeof maxWorkers !== "number" || !Number.isSafeInteger(maxWorkers) || maxWorkers < 1) {
    throw new ValidationError("The worker limit must be a whole number of 1 or more", { details: { maxWorkers } });
  }

  return maxWorkers;
}

/** Writes the machine limit to `slots/limit.json`. The last value wins. */
export async function writeSlotLimit(maxWorkers: number, home: string = homedir()): Promise<void> {
  const paths = slotPaths(home);
  const limit = checkLimit(maxWorkers);

  await ensurePrivateDir(paths.dir);
  await writeFileAtomic(paths.limit, `${JSON.stringify({ maxWorkers: limit })}\n`, { mode: 0o600, durable: true });
}

/** Reads the machine limit. A missing or bad file gives 0, so that no work starts without a limit. */
async function readLimitFile(paths: SlotPaths): Promise<number> {
  try {
    const value = JSON.parse(await readFile(paths.limit, "utf8")) as { maxWorkers?: unknown };

    return checkLimit(value.maxWorkers);
  } catch {
    return 0;
  }
}

/** Reads the machine limit. A missing or bad file gives 0, so that no work starts without a limit. */
export function readSlotLimit(home: string = homedir()): Promise<number> {
  return readLimitFile(slotPaths(home));
}

async function slotFiles(paths: SlotPaths): Promise<string[]> {
  const files = await readdir(paths.dir).catch(() => [] as string[]);

  return files.filter((file) => file.endsWith(".json") && file.includes("--"));
}

async function readSlot(path: string): Promise<SlotRecord | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SlotRecord;
  } catch {
    return undefined;
  }
}

/** Removes the slot when its owner is dead. A slot that cannot be read stays, because its owner is not known. */
async function keepLiveSlot(paths: SlotPaths, file: string, probe: OwnerProbe): Promise<boolean> {
  const path = join(paths.dir, file);
  const slot = await readSlot(path);

  if (!slot?.owner || (await probe(slot.owner)) !== "dead") {
    return true;
  }

  await unlink(path).catch(() => undefined);

  return false;
}

/** Removes the slots of dead owners, and gives the number of the other slots. The caller holds the slot lock. */
async function countLiveSlots(paths: SlotPaths, probe: OwnerProbe): Promise<number> {
  const kept = await mapInOrder(await slotFiles(paths), (file) => keepLiveSlot(paths, file, probe));

  return kept.filter(Boolean).length;
}

async function takeSlot(paths: SlotPaths, key: SlotKey, owner: Owner, probe: OwnerProbe): Promise<SlotUsage> {
  const path = slotFile(paths, key);
  const current = await readSlot(path);
  const used = await countLiveSlots(paths, probe);
  const max = await readLimitFile(paths);

  if (current?.owner?.token === owner.token) {
    return { used, max };
  }

  if (used >= max) {
    throw new HostNoFreeSlotError(`The worker host has no free slot: ${used} of ${max} slots are used.`, {
      details: { used, max },
    });
  }

  const record: SlotRecord = { version: 1, projectId: key.projectId, threadId: key.threadId, owner };

  await writeFileAtomic(path, `${JSON.stringify(record)}\n`, { mode: 0o600, durable: true });

  return { used: used + 1, max };
}

/**
 * Takes one machine slot for the Thread of the Project, under the slot lock. It first removes the slots of dead
 * owners. When the used slots reach the limit, it gives `HOST_NO_FREE_SLOT`.
 */
export async function acquireSlot(key: SlotKey, owner: Owner, options: SlotOptions = {}): Promise<SlotUsage> {
  const paths = slotPaths(options.home);

  await ensurePrivateDir(paths.dir);

  return withFileLock(paths.lock, () => takeSlot(paths, key, owner, options.probe ?? probeOwner), {
    label: "Host slot lock",
  });
}

async function removeSlot(paths: SlotPaths, key: SlotKey, token: string): Promise<boolean> {
  const path = slotFile(paths, key);
  const slot = await readSlot(path);

  if (slot?.owner?.token !== token) {
    return false;
  }

  await unlink(path);

  return true;
}

/** Releases the slot of the Thread when the owner still holds it. */
export async function releaseSlot(key: SlotKey, token: string, home?: string): Promise<boolean> {
  const paths = slotPaths(home);

  await ensurePrivateDir(paths.dir);

  return withFileLock(paths.lock, () => removeSlot(paths, key, token), { label: "Host slot lock" });
}

/** Gives the used and the maximum slots without the lock. The count includes the slots of dead owners. */
export async function slotUsage(home?: string): Promise<SlotUsage> {
  const paths = slotPaths(home);

  return { used: (await slotFiles(paths)).length, max: await readLimitFile(paths) };
}

/** Runs the action while it holds the slot lock. A `prepare` uses it, so that no slot starts during its write. */
export async function withSlotLock<T>(action: () => Promise<T>, home?: string): Promise<T> {
  const paths = slotPaths(home);

  await ensurePrivateDir(paths.dir);

  return withFileLock(paths.lock, action, { label: "Host slot lock" });
}

/** True when the Thread has a slot whose owner is not dead. The caller holds the slot lock. */
export async function threadHasLiveSlot(key: SlotKey, options: SlotOptions = {}): Promise<boolean> {
  const slot = await readSlot(slotFile(slotPaths(options.home), key));

  return !!slot?.owner && (await (options.probe ?? probeOwner)(slot.owner)) !== "dead";
}
