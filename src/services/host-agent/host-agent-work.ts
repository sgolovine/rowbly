import { ConflictError } from "../errors/errors.js";
import type { Owner, OwnerProbe } from "../factory-ownership/ownership-lock.js";
import { HostWorkerUnavailableError } from "../host-transport/host-errors.js";
import { type Store, withEntry, withoutEntry } from "../store/store.js";
import type { ActiveWork } from "./host-agent-claim.js";
import type { HostCommand } from "./host-agent-control.js";
import type { HostAgentPaths } from "./host-agent-paths.js";
import type { HostChecks } from "./host-checks.js";
import { acquireSlot, releaseSlot, type SlotKey } from "./host-slots.js";

/** The data of one accepted `launch` or `resume` that goes to the worker runner. */
export interface HostLaunchRequest {
  readonly kind: "launch" | "resume";
  readonly projectId: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly payload: Record<string, unknown>;
  /** The check queue of the agent. Without it, the worker gets no `run_check` tool and no check gate. */
  readonly checks?: HostChecks;
}

/** The work of one launch. `ended` resolves when the work ends, also after a failure. */
export interface HostWork {
  readonly ended: Promise<void>;
  /** Asks the work to stop. `ended` resolves when it stopped. */
  readonly stop: () => Promise<void>;
  /** Asks the work to stop because the Thread is cancelled. Without it, a cancel stops the work. */
  readonly cancel?: () => Promise<void>;
}

/** Starts the work of a launch or a resume. `host-runner.ts` loads Pi. Tests use a fake runner. */
export interface HostWorkRunner {
  readonly start: (request: HostLaunchRequest) => Promise<HostWork>;
}

/** One work that the agent runs. */
export interface RunningWork {
  readonly record: ActiveWork;
  readonly work: HostWork;
}

/** The state of the agent that the command scan and the work watchers share. */
export interface AgentState {
  readonly active: ReadonlyMap<string, RunningWork>;
  /** True after a `stop` command or a stop signal. The agent starts no new work. */
  readonly stopping: boolean;
  /** True after the agent asked each work to stop, because of a stop signal. */
  readonly stopRequested: boolean;
  /** The last time that the agent had work, a pending command or an outbox entry. */
  readonly busyAt: number;
}

/** The fixed environment of one host agent. */
export interface HostAgent {
  readonly paths: HostAgentPaths;
  readonly home: string | undefined;
  readonly self: Owner;
  readonly runner: HostWorkRunner | undefined;
  readonly probe: OwnerProbe | undefined;
  readonly checks: HostChecks | undefined;
  readonly store: Store<AgentState>;
}

function slotKey(agent: HostAgent, threadId: string): SlotKey {
  return { projectId: agent.paths.projectId, threadId };
}

/** Releases the slot of the work and removes the work from the state. */
async function finishWork(agent: HostAgent, threadId: string): Promise<void> {
  await releaseSlot(slotKey(agent, threadId), agent.self.token, agent.home).catch(() => false);
  agent.store.update((state) => ({ active: withoutEntry(state.active, threadId) }));
}

/** Waits for the end of the work, then releases its slot. */
async function watchWork(agent: HostAgent, threadId: string, work: HostWork): Promise<void> {
  await work.ended.catch(() => undefined);
  await finishWork(agent, threadId);
}

function startWork(agent: HostAgent, command: HostCommand, threadId: string): Promise<HostWork> {
  if (!agent.runner) {
    throw new HostWorkerUnavailableError("This worker host cannot run workers yet.", { details: { threadId } });
  }

  return agent.runner.start({
    kind: command.type === "resume" ? "resume" : "launch",
    projectId: agent.paths.projectId,
    threadId,
    requestId: command.id,
    payload: command.payload ?? {},
    ...(agent.checks ? { checks: agent.checks } : {}),
  });
}

/** Refuses a launch while the agent stops, and a second launch for a Thread that has work. */
function checkLaunch(agent: HostAgent, threadId: string): void {
  const { stopping, active } = agent.store.current;

  if (stopping) {
    throw new ConflictError("The host agent is stopping and starts no new work");
  }

  if (active.has(threadId)) {
    throw new ConflictError(`Thread ${threadId} already has work on this host`);
  }
}

/** Takes a machine slot and starts the work. A failure releases the slot again. */
async function launch(agent: HostAgent, command: HostCommand): Promise<void> {
  const threadId = command.threadId as string;
  const key = slotKey(agent, threadId);

  checkLaunch(agent, threadId);
  await acquireSlot(key, agent.self, { home: agent.home, probe: agent.probe });

  try {
    const work = await startWork(agent, command, threadId);
    const record: ActiveWork = { threadId, requestId: command.id, startedAt: new Date().toISOString() };

    agent.store.update((state) => ({ active: withEntry(state.active, threadId, { record, work }) }));
    void watchWork(agent, threadId, work);
  } catch (error) {
    await releaseSlot(key, agent.self.token, agent.home);

    throw error;
  }
}

/** Stops or cancels the work of the Thread. A Thread without work gives no effect. */
async function stopThread(agent: HostAgent, threadId: string, cancel: boolean): Promise<void> {
  const running = agent.store.current.active.get(threadId);

  if (!running) {
    return;
  }

  await (cancel && running.work.cancel ? running.work.cancel() : running.work.stop());
}

/** Runs one command. A `stop` makes the agent start no new work and stop when its work ends. */
export async function executeCommand(agent: HostAgent, command: HostCommand): Promise<void> {
  if (command.type === "stop") {
    agent.store.update(() => ({ stopping: true }));

    return;
  }

  if (command.type === "stop-thread" || command.type === "cancel-thread") {
    await stopThread(agent, command.threadId as string, command.type === "cancel-thread");

    return;
  }

  await launch(agent, command);
}

/** Asks each work to stop, one time. */
export function stopAllWork(agent: HostAgent): void {
  if (agent.store.current.stopRequested) {
    return;
  }

  const { active } = agent.store.update(() => ({ stopping: true, stopRequested: true }));

  for (const running of active.values()) {
    void running.work.stop().catch(() => undefined);
  }
}
