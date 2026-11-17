// The reconnect of a worker host after its heartbeat succeeded again: the queued commands, a new `host attach`
// channel for the active runs and the abandoned Threads, then the outbox sync. The run state stays across channels; only the channel is new.

import { withEntry, withoutEntry } from "../store/store.js";
import { abandonedOf, hasPendingOutcome } from "./remote-abandoned.js";
import { ensureLink, linkOpen } from "./remote-channel.js";
import { hooksOf, queuedCommands, sendQueued, targetOf } from "./remote-commands.js";
import { waitsForSync } from "./remote-run.js";
import { openRuns, problemText, syncHost } from "./remote-sync.js";
import type { RemoteEnv } from "./remote-types.js";

/**
 * True when the host has work for a reconnect: queued commands, a run without a channel, a run after its end, an
 * abandoned Thread without a channel, or the end of an abandoned Thread that waits for the sync.
 */
async function needsReconnect(env: RemoteEnv, host: string): Promise<boolean> {
  const runs = openRuns(env, host);
  const open = linkOpen(env, host);

  if (runs.some(waitsForSync) || (runs.length > 0 && !open) || hasPendingOutcome(env, host)) {
    return true;
  }

  if (!open && (await abandonedOf(env, host)).length > 0) {
    return true;
  }

  return (await queuedCommands(env, host)).length > 0;
}

/** Opens the channel again when the host still has an active run or an abandoned Thread without a channel. */
async function reopenLink(env: RemoteEnv, host: string): Promise<void> {
  if (linkOpen(env, host)) {
    return;
  }

  if (openRuns(env, host).length === 0 && (await abandonedOf(env, host)).length === 0) {
    return;
  }

  await ensureLink(env, host, (await targetOf(env, host)).connection, hooksOf(env));
}

async function runReconnect(env: RemoteEnv, host: string): Promise<string | undefined> {
  try {
    if (!(await needsReconnect(env, host))) {
      return undefined;
    }

    // The stop and cancel commands go first, so that the host gets them before it sends the run states again.
    await sendQueued(env, await targetOf(env, host), host);
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
