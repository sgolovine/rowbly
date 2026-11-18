import { readFile } from "node:fs/promises";
import {
  acquireOwner,
  type Owner,
  type OwnerProbe,
  probeOwner,
  readOwner,
  releaseOwner,
} from "../factory-ownership/ownership-lock.js";
import { writeFileAtomic } from "../files/files.js";
import { type HostAgentPaths, prepareAgentDirs } from "./host-agent-paths.js";

/** The phase of a host agent. An agent writes `stopped` just before it releases its claim. */
export type HostAgentPhase = "running" | "stopping" | "stopped";

/** One accepted `launch` that has work on the host. */
export interface ActiveWork {
  readonly threadId: string;
  readonly requestId: string;
  readonly startedAt: string;
}

/** The content of `agent.json`. Only the holder of the claim writes it. */
export interface HostAgentState {
  readonly version: 1;
  readonly owner: Owner;
  readonly phase: HostAgentPhase;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly active: readonly ActiveWork[];
}

/** Takes the claim of the host agent of the Project. It replaces only a dead holder. */
export async function acquireAgentClaim(
  paths: HostAgentPaths,
  self: Owner,
  probe: OwnerProbe = probeOwner,
): Promise<{ acquired: boolean; owner: Owner }> {
  await prepareAgentDirs(paths);

  return acquireOwner(paths.lock, paths.guard, self, probe);
}

/** Releases the claim when it still holds the token. */
export function releaseAgentClaim(paths: HostAgentPaths, token: string): Promise<boolean> {
  return releaseOwner(paths.lock, paths.guard, token);
}

/** Reads the holder of the claim, if there is one. */
export function readAgentClaim(paths: HostAgentPaths): Promise<Owner | undefined> {
  return readOwner(paths.lock);
}

/** Reads `agent.json`. A missing or bad file gives `undefined`. */
export async function readAgentState(paths: HostAgentPaths): Promise<HostAgentState | undefined> {
  try {
    const state = JSON.parse(await readFile(paths.state, "utf8")) as HostAgentState;

    return state?.version === 1 && typeof state.owner?.token === "string" ? state : undefined;
  } catch {
    return undefined;
  }
}

/** Writes `agent.json` durably with mode 0600. */
export async function writeAgentState(paths: HostAgentPaths, state: HostAgentState): Promise<void> {
  await writeFileAtomic(paths.state, `${JSON.stringify(state)}\n`, { mode: 0o600, durable: true });
}

/**
 * Gives the holder of the claim while it is alive or uncertain. A holder that wrote the phase `stopped` is about to
 * release the claim, so it is not live. The claim is read before the state, so a new holder is never missed.
 */
export async function liveAgent(paths: HostAgentPaths, probe: OwnerProbe = probeOwner): Promise<Owner | undefined> {
  const claim = await readAgentClaim(paths).catch(() => undefined);
  const state = await readAgentState(paths);

  if (!claim || (state?.owner.token === claim.token && state.phase === "stopped")) {
    return undefined;
  }

  return (await probe(claim)) === "dead" ? undefined : claim;
}

/** Gives the live agent and its phase for the attach channel. */
export async function agentStatus(
  paths: HostAgentPaths,
  probe: OwnerProbe = probeOwner,
): Promise<{ agent: HostAgentPhase; owner: Owner | null }> {
  const owner = await liveAgent(paths, probe);

  if (!owner) {
    return { agent: "stopped", owner: null };
  }

  const state = await readAgentState(paths);
  const agent = state?.owner.token === owner.token ? state.phase : "running";

  return { agent, owner };
}
