import { join } from "node:path";
import { stopOrphanChecks } from "../check-queue/check-orphans.js";
import {
  type CheckJob,
  type CheckQueue,
  type CheckQueueDeps,
  createCheckQueue,
  stopCheckQueue,
} from "../check-queue/check-queue.js";
import { realCheckDeps } from "../check-queue/proc-readers.js";
import { type CheckLimits, checkLimits } from "../factory-settings/check-settings.js";
import type { FactorySettings } from "../factory-settings/factory-settings.js";
import { Store, withEntry } from "../store/store.js";
import { type ProjectPaths, projectPaths } from "../workspace/workspace.js";
import { ensurePrivateDir, type HostAgentPaths } from "./host-agent-paths.js";

/** Gets each change of a check job of one Thread. */
export type CheckReceiver = (job: CheckJob) => void;

/** The state that the runs of the agent share with the queue. */
interface HostChecksState {
  /** The limits of the settings of the run that started last. */
  readonly limits?: CheckLimits;
  /** The receiver of the run of each Thread. The next run of a Thread replaces it. */
  readonly receivers: ReadonlyMap<string, CheckReceiver>;
}

/** The check queue of one host agent, and the state that its runs share. */
export interface HostChecks {
  readonly queue: CheckQueue;
  readonly store: Store<HostChecksState>;
}

/**
 * Gives the Project paths of the check queue. The records and the logs go to `<agent>/runtime/checks/`, not below
 * the clone and not below a copy.
 */
export function hostCheckPaths(paths: HostAgentPaths): ProjectPaths {
  return { ...projectPaths(paths.dir), dir: paths.dir, runtimeDir: paths.runtime };
}

function receive(store: Store<HostChecksState>, job: CheckJob): void {
  store.current.receivers.get(job.threadId)?.(job);
}

/**
 * Stops the check processes of a dead agent, then opens the check queue of this agent. Call it after the agent took
 * its claim, with the owner token of the agent.
 */
export async function openHostChecks(
  paths: HostAgentPaths,
  ownerToken: string,
  deps: CheckQueueDeps = realCheckDeps(),
): Promise<HostChecks> {
  const checkPaths = hostCheckPaths(paths);
  const store = new Store<HostChecksState>({ receivers: new Map() });

  await ensurePrivateDir(join(paths.runtime, "checks"));
  await stopOrphanChecks(checkPaths, ownerToken, deps);

  const queue = await createCheckQueue({
    paths: checkPaths,
    ownerToken,
    deps,
    limits: () => store.current.limits,
    onChange: (job) => receive(store, job),
  });

  return { queue, store };
}

/** Uses the limits of the settings of a run that starts, and sends the job changes of its Thread to `receiver`. */
export function bindHostRun(
  checks: HostChecks,
  run: { readonly threadId: string; readonly settings: FactorySettings; readonly receiver: CheckReceiver },
): void {
  checks.store.update(({ receivers }) => ({
    limits: checkLimits(run.settings.checks),
    receivers: withEntry(receivers, run.threadId, run.receiver),
  }));
}

/** Cancels the queued jobs and stops each running process group. Call it before the agent releases its claim. */
export function closeHostChecks(checks: HostChecks): Promise<void> {
  return stopCheckQueue(checks.queue);
}
