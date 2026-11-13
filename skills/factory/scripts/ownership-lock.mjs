// Shared local ownership protocol for native and external factory state locks.
import { randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

export async function processIdentity(pid) {
  if (process.platform !== "linux") return undefined;
  try {
    const [boot, stat] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"), readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    return ticks ? `${boot.trim()}:${ticks}` : undefined;
  } catch { return undefined; }
}

export function validOwner(owner) {
  return owner?.version === 1 && typeof owner.token === "string" && owner.token.length > 0 &&
    Number.isSafeInteger(owner.pid) && owner.pid > 0 && typeof owner.hostname === "string" &&
    typeof owner.startedAt === "string" && Number.isFinite(Date.parse(owner.startedAt)) &&
    (owner.processIdentity === undefined || typeof owner.processIdentity === "string");
}

export async function newOwner() {
  return { version: 1, token: randomUUID(), pid: process.pid, hostname: hostname(),
    startedAt: new Date().toISOString(), processIdentity: await processIdentity(process.pid) };
}

/** Only definite death permits replacement. Age and heartbeat never prove death. */
export async function probeOwner(owner) {
  if (!validOwner(owner) || owner.hostname !== hostname()) return "uncertain";
  try { process.kill(owner.pid, 0); }
  catch (error) { return error.code === "ESRCH" ? "dead" : "uncertain"; }
  const identity = await processIdentity(owner.pid);
  if (!identity || !owner.processIdentity) return "uncertain";
  return identity === owner.processIdentity ? "alive" : "dead";
}

export async function readOwner(path) {
  try {
    const owner = JSON.parse(await readFile(path, "utf8"));
    if (!validOwner(owner)) throw new Error(`Invalid owner at ${path}`);
    return owner;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** The guard is never removed by age. A guard crash fails closed. */
export async function withLifecycleGuard(path, action, waitMs = 2000) {
  const deadline = Date.now() + waitMs;
  let guard;
  for (;;) {
    try { guard = await open(path, "wx", 0o600); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`Ownership guard is busy: ${path}. Stop all factory processes before offline repair.`);
      await sleep(10);
    }
  }
  try { return await action(); }
  finally { await guard.close(); await unlink(path); }
}

export async function acquireOwner(path, guard, owner, probe = probeOwner, waitMs = 2000) {
  if (!validOwner(owner)) throw new Error("Invalid new owner");
  return withLifecycleGuard(guard, async () => {
    const previous = await readOwner(path);
    if (previous) {
      if (await probe(previous) !== "dead") return { acquired: false, owner: previous };
      await unlink(path);
    }
    const file = await open(path, "wx", 0o600);
    try { await file.writeFile(`${JSON.stringify(owner)}\n`); await file.sync(); }
    finally { await file.close(); }
    return { acquired: true, owner };
  }, waitMs);
}

export async function releaseOwner(path, guard, token, waitMs = 2000) {
  return withLifecycleGuard(guard, async () => {
    const owner = await readOwner(path);
    if (!owner || owner.token !== token) return false;
    await unlink(path);
    return true;
  }, waitMs);
}
