// A short cache of the liveness probe, for the read-only status path only.
import { Store } from "../store/store.js";
import { type Owner, type OwnerProbe, probeOwner, processExists } from "./ownership-lock.js";

/** An `alive` result is kept for this time at most, so that a reused PID shows as stopped in under 10 s. */
const ALIVE_CACHE_MS = 5000;

/** The last owner that a full probe found alive. */
interface AliveEntry {
  readonly key: string;
  readonly at: number;
}

/** One entry is sufficient: the status path probes the owner of one Project at a time. */
const aliveCache = new Store<{ alive?: AliveEntry }>({});

/** Gives the key of the identity of the owner process, or `undefined` when the owner has no identity. */
function ownerKey(owner: Owner): string | undefined {
  return owner.processIdentity === undefined ? undefined : `${owner.hostname}|${owner.pid}|${owner.processIdentity}`;
}

function recentlyAlive(key: string | undefined, now: number): boolean {
  const { alive } = aliveCache.current;

  return key !== undefined && alive?.key === key && now - alive.at < ALIVE_CACHE_MS;
}

function remember(key: string | undefined, liveness: Awaited<ReturnType<OwnerProbe>>, now: number): void {
  if (key === undefined || liveness !== "alive") {
    aliveCache.update(() => ({ alive: undefined }));

    return;
  }

  aliveCache.update(() => ({ alive: { key, at: now } }));
}

/**
 * Probes the owner like `probeOwner`, but does not read `/proc/<pid>/stat` again for the same owner process
 * within 5 s of an `alive` result. It still sends signal 0 each time, so a process that exits gives `dead` at
 * once. Use it only to show the status. The ownership takeover and the recovery use `probeOwner`.
 */
export const probeOwnerCached: OwnerProbe = async (owner) => {
  const key = ownerKey(owner);
  const now = Date.now();

  if (recentlyAlive(key, now) && processExists(owner.pid) === true) {
    return "alive";
  }

  const liveness = await probeOwner(owner);

  remember(key, liveness, now);

  return liveness;
};
