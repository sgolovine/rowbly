// The outbox sync of the worker hosts with active remote runs, and the end of the runs that wait for it.

import type { HostRunState } from "../host-agent/host-run-state.js";
import { mapInOrder } from "../in-order/in-order.js";
import { abandonedOf, abandonedSyncHosts, flushOutcomes, hasAbandonedWork, keepOutcome } from "./remote-abandoned.js";
import { hostRuns } from "./remote-channel.js";
import { hooksOf } from "./remote-commands.js";
import { updateRuns } from "./remote-inbound.js";
import { endSyncedRuns, waitsForSync } from "./remote-run.js";
import type { RemoteEnv, RemoteRun } from "./remote-types.js";
import { hasEnded } from "./run-frames.js";

/** True when the outbox of the host can be applied now. A run before its session waits for its session first. */
function canSync(runs: readonly RemoteRun[]): boolean {
  return runs.some(waitsForSync) || runs.every((run) => run.store.current.sessionOpened);
}

/** The runs of the host that did not send their last event. */
export function openRuns(env: RemoteEnv, host: string): RemoteRun[] {
  return hostRuns(env, host).filter((run) => !run.store.current.closed);
}

/** True when the sync of the host can run now: for its open runs, else for its abandoned Threads. */
async function shouldSync(env: RemoteEnv, host: string, runs: readonly RemoteRun[]): Promise<boolean> {
  return runs.length > 0 ? canSync(runs) : hasAbandonedWork(env, host);
}

/**
 * Applies the outbox of one host, then makes and sends the inbound updates of the runs that did not end, ends the runs
 * that waited for the sync and writes the remote outcome of each abandoned Thread whose end arrived. Gives the problem
 * of a failure.
 */
export async function syncHost(env: RemoteEnv, host: string): Promise<[string, string | undefined]> {
  const runs = openRuns(env, host);

  if (!(await shouldSync(env, host, runs))) {
    return [host, undefined];
  }

  const waiting = runs.filter(waitsForSync);

  try {
    await env.input.sync(host);
  } catch (error) {
    return [host, problemText(error)];
  }

  // The outbox goes first: a change of the worker that is on the main machine now gives an update with no effect.
  const problem = await updateRuns(
    env,
    host,
    runs.filter((run) => !waitsForSync(run)),
  );

  await endSyncedRuns(waiting, hooksOf(env));
  await flushOutcomes(env, host);

  return [host, problem];
}

/**
 * Applies the outbox of each host with an active remote run or with abandoned work. Gives the problem of each host
 * whose sync failed.
 */
export async function syncHosts(env: RemoteEnv): Promise<ReadonlyMap<string, string>> {
  const runHosts = [...env.state.current.runs.values()].map((run) => run.host);
  const hosts = [...new Set([...runHosts, ...(await abandonedSyncHosts(env))])];
  const results = await mapInOrder(hosts, (host) => syncHost(env, host));

  return new Map(results.filter((result): result is [string, string] => result[1] !== undefined));
}

/** Gives the message of an error. */
export function problemText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Keeps the last frame of an abandoned Thread, then applies the outbox of its host and writes the outcome. */
async function takeAbandonedEnd(env: RemoteEnv, host: string, frame: HostRunState): Promise<void> {
  if (!(await abandonedOf(env, host)).includes(frame.threadId)) {
    return;
  }

  keepOutcome(env, host, frame);
  await syncHost(env, host);
}

/** Takes a run frame of a Thread without an active run. Only the last frame of an abandoned Thread does something. */
export function takeOtherRun(env: RemoteEnv, host: string, frame: HostRunState): void {
  if (!hasEnded(frame)) {
    return;
  }

  void takeAbandonedEnd(env, host, frame).catch(() => undefined);
}
