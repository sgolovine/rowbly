// The outbox sync of the worker hosts with active remote runs, and the end of the runs that wait for it.

import { mapInOrder } from "../in-order/in-order.js";
import { hostRuns } from "./remote-channel.js";
import { hooksOf } from "./remote-commands.js";
import { updateRuns } from "./remote-inbound.js";
import { endSyncedRuns, waitsForSync } from "./remote-run.js";
import type { RemoteEnv, RemoteRun } from "./remote-types.js";

/** True when the outbox of the host can be applied now. A run before its session waits for its session first. */
function canSync(runs: readonly RemoteRun[]): boolean {
  return runs.some(waitsForSync) || runs.every((run) => run.store.current.sessionOpened);
}

/** The runs of the host that did not send their last event. */
export function openRuns(env: RemoteEnv, host: string): RemoteRun[] {
  return hostRuns(env, host).filter((run) => !run.store.current.closed);
}

/**
 * Applies the outbox of one host, then makes and sends the inbound updates of the runs that did not end, and ends the
 * runs that waited for the sync. Gives the problem of a failure.
 */
export async function syncHost(env: RemoteEnv, host: string): Promise<[string, string | undefined]> {
  const runs = openRuns(env, host);

  if (runs.length === 0 || !canSync(runs)) {
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

  return [host, problem];
}

/** Applies the outbox of each host with an active remote run. Gives the problem of each host whose sync failed. */
export async function syncHosts(env: RemoteEnv): Promise<ReadonlyMap<string, string>> {
  const hosts = [...new Set([...env.state.current.runs.values()].map((run) => run.host))];
  const results = await mapInOrder(hosts, (host) => syncHost(env, host));

  return new Map(results.filter((result): result is [string, string] => result[1] !== undefined));
}

/** Gives the message of an error. */
export function problemText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
