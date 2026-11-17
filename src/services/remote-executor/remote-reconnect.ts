// The reconnect of a worker host after its heartbeat succeeded again: the queued commands, the runs of the adopted
// Threads, a new `host attach` channel for the active runs, then the outbox sync. The run state stays across channels; only the channel is new.

import { withEntry, withoutEntry } from "../store/store.js";
import { askAdoptedRuns, needsRunState } from "./remote-adopt.js";
import { ensureLink, linkOpen } from "./remote-channel.js";
import { hooksOf, queuedCommands, sendQueued, targetOf } from "./remote-commands.js";
import { waitsForSync } from "./remote-run.js";
import { openRuns, problemText, syncHost } from "./remote-sync.js";
import type { RemoteEnv } from "./remote-types.js";

/**
 * True when the host has work for a reconnect: queued commands, a run without a channel, an adopted run without a
 * command id, or a run after its end.
 */
async function needsReconnect(env: RemoteEnv, host: string): Promise<boolean> {
  const runs = openRuns(env, host);

  if (runs.some(waitsForSync) || runs.some(needsRunState) || (runs.length > 0 && !linkOpen(env, host))) {
    return true;
  }

  return (await queuedCommands(env, host)).length > 0;
}

/** Opens the channel again when the host still has an active run without a channel. */
async function reopenLink(env: RemoteEnv, host: string): Promise<void> {
  if (openRuns(env, host).length === 0 || linkOpen(env, host)) {
    return;
  }

  await ensureLink(env, host, (await targetOf(env, host)).connection, hooksOf(env));
}

async function runReconnect(env: RemoteEnv, host: string): Promise<string | undefined> {
  try {
    if (!(await needsReconnect(env, host))) {
      return undefined;
    }

    const target = await targetOf(env, host);

    // The stop and cancel commands go first, so that the host gets them before it sends the run states again.
    await sendQueued(env, target, host);
    await askAdoptedRuns(env, target, host);
    await reopenLink(env, host);

    return (await syncHost(env, host))[1];
  } catch (error) {
    return problemText(error);
  }
}

/** Does the reconnect steps of the host one time. A second call while the reconnect runs gets the same task. */
export function reconnectHost(env: RemoteEnv, host: string): Promise<string | undefined> {
  const current = env.state.current.reconnects.get(host);

  if (current) {
    return current;
  }

  const task = runReconnect(env, host).finally(() =>
    env.state.update((state) => ({ reconnects: withoutEntry(state.reconnects, host) })),
  );

  env.state.update((state) => ({ reconnects: withEntry(state.reconnects, host, task) }));

  return task;
}
