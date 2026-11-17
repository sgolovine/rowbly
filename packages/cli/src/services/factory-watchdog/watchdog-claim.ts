import {
  acquireOwner,
  type Owner,
  type OwnerProbe,
  probeOwner,
  readOwner,
  releaseOwner,
} from "../factory-ownership/factory-ownership.js";
import { prepareRuntime, runtimePath } from "../runtime-files/runtime-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import { readWatchdogState, type WatchdogState, watchdogActive } from "./watchdog-state.js";

/** The paths of the exclusive watchdog claim and of its guard. */
async function claimPaths(paths: ProjectPaths): Promise<{ lock: string; guard: string }> {
  return { lock: await runtimePath(paths, "watchdog.lock"), guard: await runtimePath(paths, "watchdog.guard") };
}

/**
 * Takes the exclusive watchdog claim in `.rowbly/runtime/watchdog.lock`. It replaces only a dead holder.
 * Only the holder of the claim writes `watchdog.json` and starts a daemon.
 */
export async function acquireWatchdogClaim(
  paths: ProjectPaths,
  self: Owner,
  probe: OwnerProbe = probeOwner,
): Promise<{ acquired: boolean; owner: Owner }> {
  await prepareRuntime(paths);

  const files = await claimPaths(paths);

  return acquireOwner(files.lock, files.guard, self, probe);
}

/** Releases the watchdog claim when it still holds the token. */
export async function releaseWatchdogClaim(paths: ProjectPaths, token: string): Promise<boolean> {
  const files = await claimPaths(paths);

  return releaseOwner(files.lock, files.guard, token);
}

/** Reads the holder of the watchdog claim, if there is one. */
export async function readWatchdogClaim(paths: ProjectPaths): Promise<Owner | undefined> {
  return readOwner((await claimPaths(paths)).lock);
}

/** A watchdog process that can still start a daemon. */
export interface LiveWatchdog {
  readonly process: Owner;
  readonly liveness: "alive" | "uncertain";
}

/** Reads the watchdog claim and the watchdog state. Tests inject a reader to change the files between the reads. */
interface WatchdogReader {
  readonly claim: (paths: ProjectPaths) => Promise<Owner | undefined>;
  readonly state: (paths: ProjectPaths) => Promise<WatchdogState | undefined>;
}

const fileReader: WatchdogReader = { claim: readWatchdogClaim, state: readWatchdogState };

/** Gives the process when it is alive or uncertain. */
async function liveProcess(process: Owner, probe: OwnerProbe): Promise<LiveWatchdog | undefined> {
  const liveness = await probe(process);

  return liveness === "dead" ? undefined : { process, liveness };
}

/**
 * Gives the watchdog that can still start a daemon: an active watchdog in the state file, or a claim holder that
 * did not write its last phase. A claim holder that wrote its last phase is about to exit and is not live.
 *
 * The function reads the claim one time and then the state one time, and decides from this one snapshot. The claim
 * holder writes the state only after it takes the claim. Thus a state that changes between the two reads shows the
 * new holder as active, and the function never misses a live holder.
 */
export async function liveWatchdog(
  paths: ProjectPaths,
  probe: OwnerProbe = probeOwner,
  reader: WatchdogReader = fileReader,
): Promise<LiveWatchdog | undefined> {
  const claim = await reader.claim(paths);
  const state = await reader.state(paths);

  if (state && watchdogActive(state)) {
    const active = await liveProcess(state.process, probe);

    if (active) {
      return active;
    }
  }

  if (!claim || (state?.process.token === claim.token && !watchdogActive(state))) {
    return undefined;
  }

  return liveProcess(claim, probe);
}

/** Gives the holder of the watchdog claim while it is alive or uncertain, also when it is about to exit. */
export async function claimHeld(paths: ProjectPaths, probe: OwnerProbe = probeOwner): Promise<Owner | undefined> {
  const claim = await readWatchdogClaim(paths);

  return claim && (await probe(claim)) !== "dead" ? claim : undefined;
}
