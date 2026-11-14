// The local ownership protocol of the factory daemon lock and the factory state lock.
import { randomUUID } from "node:crypto";
import { type FileHandle, open, readFile, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

export interface Owner {
  version: 1;
  token: string;
  pid: number;
  hostname: string;
  startedAt: string;
  processIdentity?: string;
}

export type OwnerProbe = (owner: Owner) => Promise<"alive" | "dead" | "uncertain">;

function errorCode(error: unknown): unknown {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}

/** Gives the boot ID and the start time of a process on Linux. Other platforms give nothing. */
async function processIdentity(pid: number): Promise<string | undefined> {
  if (process.platform !== "linux") {
    return undefined;
  }

  try {
    const [boot, stat] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];

    return ticks ? `${boot.trim()}:${ticks}` : undefined;
  } catch {
    return undefined;
  }
}

function validOwner(owner: unknown): owner is Owner {
  if (!owner || typeof owner !== "object") {
    return false;
  }

  const record = owner as Record<string, unknown>;

  return (
    record.version === 1 &&
    typeof record.token === "string" &&
    record.token.length > 0 &&
    Number.isSafeInteger(record.pid) &&
    (record.pid as number) > 0 &&
    typeof record.hostname === "string" &&
    typeof record.startedAt === "string" &&
    Number.isFinite(Date.parse(record.startedAt)) &&
    (record.processIdentity === undefined || typeof record.processIdentity === "string")
  );
}

export async function newOwner(): Promise<Owner> {
  return {
    version: 1,
    token: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    processIdentity: await processIdentity(process.pid),
  };
}

/** Tells if a process with the ID exists. A permission error is not proof of death. */
function processExists(pid: number): boolean | undefined {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return errorCode(error) === "ESRCH" ? false : undefined;
  }
}

/** Only definite death permits replacement. Age and heartbeat never prove death. */
export const probeOwner: OwnerProbe = async (owner) => {
  if (!validOwner(owner) || owner.hostname !== hostname()) {
    return "uncertain";
  }

  const exists = processExists(owner.pid);

  if (exists !== true) {
    return exists === false ? "dead" : "uncertain";
  }

  const identity = await processIdentity(owner.pid);

  if (!identity || !owner.processIdentity) {
    return "uncertain";
  }

  return identity === owner.processIdentity ? "alive" : "dead";
};

export async function readOwner(path: string): Promise<Owner | undefined> {
  try {
    const owner: unknown = JSON.parse(await readFile(path, "utf8"));

    if (!validOwner(owner)) {
      throw new Error(`Invalid owner at ${path}`);
    }

    return owner;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

/** Creates the guard file. It waits while another process holds the guard, until the deadline. */
async function openGuard(path: string, deadline: number): Promise<FileHandle> {
  try {
    return await open(path, "wx", 0o600);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      throw error;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Ownership guard is busy: ${path}. Stop all factory processes before offline repair.`);
    }

    await sleep(10);

    return openGuard(path, deadline);
  }
}

/** The guard is never removed by age. A guard crash fails closed. */
export async function withLifecycleGuard<T>(path: string, action: () => Promise<T>, waitMs = 2000): Promise<T> {
  const guard = await openGuard(path, Date.now() + waitMs);

  try {
    return await action();
  } finally {
    await guard.close();
    await unlink(path);
  }
}

async function writeOwner(path: string, owner: Owner): Promise<void> {
  const file = await open(path, "wx", 0o600);

  try {
    await file.writeFile(`${JSON.stringify(owner)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
}

/** Replaces a dead owner, or gives the owner that holds the lock. The caller holds the guard. */
async function takeOwner(path: string, owner: Owner, probe: OwnerProbe) {
  const previous = await readOwner(path);

  if (previous) {
    if ((await probe(previous)) !== "dead") {
      return { acquired: false, owner: previous };
    }

    await unlink(path);
  }

  await writeOwner(path, owner);

  return { acquired: true, owner };
}

export async function acquireOwner(
  path: string,
  guard: string,
  owner: Owner,
  probe: OwnerProbe = probeOwner,
  waitMs = 2000,
): Promise<{ acquired: boolean; owner: Owner }> {
  if (!validOwner(owner)) {
    throw new Error("Invalid new owner");
  }

  return withLifecycleGuard(guard, () => takeOwner(path, owner, probe), waitMs);
}

async function removeOwner(path: string, token: string): Promise<boolean> {
  const owner = await readOwner(path);

  if (!owner || owner.token !== token) {
    return false;
  }

  await unlink(path);

  return true;
}

export async function releaseOwner(path: string, guard: string, token: string, waitMs = 2000): Promise<boolean> {
  return withLifecycleGuard(guard, () => removeOwner(path, token), waitMs);
}
