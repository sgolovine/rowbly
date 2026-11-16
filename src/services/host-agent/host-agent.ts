import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { CheckQueueDeps } from "../check-queue/check-types.js";
import { newOwner, type Owner, type OwnerProbe, probeOwner } from "../factory-ownership/ownership-lock.js";
import { outboxPaths } from "../outbox/outbox-file.js";
import { Store } from "../store/store.js";
import {
  acquireAgentClaim,
  type HostAgentPhase,
  type HostAgentState,
  liveAgent,
  releaseAgentClaim,
  writeAgentState,
} from "./host-agent-claim.js";
import { pendingCommandCount, processHostCommands } from "./host-agent-control.js";
import { type HostAgentPaths, hostAgentPaths } from "./host-agent-paths.js";
import {
  type AgentState,
  executeCommand,
  type HostAgent,
  type HostWorkRunner,
  stopAllWork,
} from "./host-agent-work.js";
import { closeHostChecks, type HostChecks, openHostChecks } from "./host-checks.js";

/** The default idle period: the agent stops after 60 seconds without work. */
export const DEFAULT_IDLE_MS = 60_000;

/** The default time between two scans of the commands. */
export const DEFAULT_POLL_MS = 250;

/** The longest wait for the claim of an agent that wrote `stopped` and is about to release the claim. */
const CLAIM_WAIT_MS = 5000;

export interface HostAgentOptions {
  readonly projectId: string;
  /** The home folder. The default is the home folder of the user. Tests give a temporary folder. */
  readonly home?: string;
  /** Starts the work of a launch. Without a runner, each launch is rejected with `HOST_WORKER_UNAVAILABLE`. */
  readonly runner?: HostWorkRunner;
  readonly idleMs?: number;
  readonly pollMs?: number;
  /** An abort stops the agent: it asks each work to stop and stops when the work ended. */
  readonly signal?: AbortSignal;
  readonly probe?: OwnerProbe;
  /** The parts of the check queue that touch the machine. Tests give fakes. The default uses `/proc` and `bash`. */
  readonly checkDeps?: CheckQueueDeps;
}

/** The result of `runHostAgent`. `already-running` means that a different live agent held the claim. */
export interface HostAgentResult {
  readonly outcome: "stopped" | "already-running";
  readonly owner: Owner;
}

/** The fixed environment of the loop. */
interface AgentLoop {
  readonly agent: HostAgent;
  readonly idleMs: number;
  readonly pollMs: number;
  readonly signal: AbortSignal;
  readonly startedAt: string;
  readonly written: Store<{ key: string }>;
}

export type { HostLaunchRequest, HostWork, HostWorkRunner } from "./host-agent-work.js";

/** True when `outbox.jsonl` has an entry. */
async function outboxHasEntries(paths: HostAgentPaths): Promise<boolean> {
  try {
    const text = await readFile(outboxPaths(paths.outbox).entriesFile, "utf8");

    return text.split("\n").some((line) => line.trim() !== "");
  } catch {
    return false;
  }
}

function agentState(loop: AgentLoop, phase: HostAgentPhase): Omit<HostAgentState, "updatedAt"> {
  const active = [...loop.agent.store.current.active.values()].map((running) => running.record);

  return { version: 1, owner: loop.agent.self, phase, startedAt: loop.startedAt, active };
}

/** Writes `agent.json` when its content changed. */
async function recordState(loop: AgentLoop, phase: HostAgentPhase): Promise<void> {
  const state = agentState(loop, phase);
  const key = JSON.stringify(state);

  if (key === loop.written.current.key) {
    return;
  }

  await writeAgentState(loop.agent.paths, { ...state, updatedAt: new Date().toISOString() });
  loop.written.update(() => ({ key }));
}

/** True when the agent has active work, a command without a settled receipt or an outbox entry. */
export async function hostAgentBusy(paths: HostAgentPaths, activeWork: number): Promise<boolean> {
  if (activeWork > 0) {
    return true;
  }

  return (await pendingCommandCount(paths)) > 0 || (await outboxHasEntries(paths));
}

/** Tells if the agent can stop now. Without a stop, it stops only after the idle period. */
async function readyToStop(loop: AgentLoop): Promise<boolean> {
  const { stopping, active } = loop.agent.store.current;

  if (stopping) {
    return active.size === 0;
  }

  if (await hostAgentBusy(loop.agent.paths, active.size)) {
    loop.agent.store.update(() => ({ busyAt: Date.now() }));

    return false;
  }

  return Date.now() - loop.agent.store.current.busyAt >= loop.idleMs;
}

/** One pass: run the new commands, write the state, and tell if the agent can stop. */
async function agentPass(loop: AgentLoop): Promise<boolean> {
  const { agent } = loop;

  if (loop.signal.aborted) {
    stopAllWork(agent);
  } else {
    await processHostCommands(agent.paths, agent.self.token, (command) => executeCommand(agent, command));
  }

  const done = await readyToStop(loop);

  await recordState(loop, agent.store.current.stopping ? "stopping" : "running");

  return done;
}

/** Waits for the next pass. A stop signal ends the first wait early. */
async function pause(loop: AgentLoop): Promise<void> {
  const signal = loop.signal.aborted ? undefined : loop.signal;

  await sleep(loop.pollMs, undefined, { signal }).catch(() => undefined);
}

async function agentLoop(loop: AgentLoop): Promise<void> {
  while (!(await agentPass(loop))) {
    await pause(loop);
  }
}

/**
 * Takes the claim. A different live agent gives its owner at once. An agent that wrote `stopped` releases the claim
 * soon, so the wait continues until the deadline.
 */
async function takeClaim(
  paths: HostAgentPaths,
  self: Owner,
  probe: OwnerProbe,
  deadline: number,
): Promise<{ acquired: boolean; owner: Owner }> {
  const claim = await acquireAgentClaim(paths, self, probe);

  if (claim.acquired || Date.now() >= deadline || (await liveAgent(paths, probe)) !== undefined) {
    return claim;
  }

  await sleep(50);

  return takeClaim(paths, self, probe, deadline);
}

/**
 * Writes `agent.json` without active work, before the loop has a state, for example before the check queue opens.
 * Gives the key of the content, so that the loop does not write the same content again.
 */
async function recordPhase(
  paths: HostAgentPaths,
  self: Owner,
  startedAt: string,
  phase: HostAgentPhase,
): Promise<string> {
  const state: Omit<HostAgentState, "updatedAt"> = { version: 1, owner: self, phase, startedAt, active: [] };

  await writeAgentState(paths, { ...state, updatedAt: new Date().toISOString() });

  return JSON.stringify(state);
}

/** Opens the check queue. When the queue does not open, the agent writes `stopped` and gives the error. */
async function openChecks(
  options: HostAgentOptions,
  paths: HostAgentPaths,
  self: Owner,
  startedAt: string,
): Promise<HostChecks> {
  try {
    return await openHostChecks(paths, self.token, options.checkDeps);
  } catch (error) {
    await recordPhase(paths, self, startedAt, "stopped").catch(() => undefined);
    throw error;
  }
}

function newLoop(
  options: HostAgentOptions,
  paths: HostAgentPaths,
  self: Owner,
  checks: HostChecks,
  start: { readonly startedAt: string; readonly key: string },
): AgentLoop {
  const store = new Store<AgentState>({ active: new Map(), stopping: false, stopRequested: false, busyAt: Date.now() });
  const agent: HostAgent = {
    paths,
    home: options.home,
    self,
    runner: options.runner,
    probe: options.probe,
    checks,
    store,
  };

  return {
    agent,
    idleMs: options.idleMs ?? DEFAULT_IDLE_MS,
    pollMs: options.pollMs ?? DEFAULT_POLL_MS,
    signal: options.signal ?? new AbortController().signal,
    startedAt: start.startedAt,
    written: new Store({ key: start.key }),
  };
}

/** Runs the loop. When the loop ends, it stops the check queue, then writes `stopped`. */
async function serveAgent(loop: AgentLoop, checks: HostChecks): Promise<void> {
  try {
    await recordState(loop, "running");
    await agentLoop(loop);
  } finally {
    await closeHostChecks(checks);
  }

  await recordState(loop, "stopped");
}

/**
 * Runs the host agent of one Project until it stops. Only the holder of the claim continues. A second agent for the
 * same Project gives `already-running` and writes nothing. The agent releases the claim when it stops.
 */
export async function runHostAgent(options: HostAgentOptions): Promise<HostAgentResult> {
  const paths = hostAgentPaths(options.projectId, options.home);
  const self = await newOwner();
  const claim = await takeClaim(paths, self, options.probe ?? probeOwner, Date.now() + CLAIM_WAIT_MS);

  if (!claim.acquired) {
    return { outcome: "already-running", owner: claim.owner };
  }

  const startedAt = new Date().toISOString();

  try {
    // Write `running` immediately after the claim, so that a reader of the claim also finds `agent.json`.
    const key = await recordPhase(paths, self, startedAt, "running");
    const checks = await openChecks(options, paths, self, startedAt);

    await serveAgent(newLoop(options, paths, self, checks, { startedAt, key }), checks);
  } finally {
    await releaseAgentClaim(paths, self.token).catch(() => false);
  }

  return { outcome: "stopped", owner: self };
}
