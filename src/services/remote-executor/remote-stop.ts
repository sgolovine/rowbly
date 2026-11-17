// The stop and the cancel of remote runs: a submit when the host has a channel, else the durable queue of the host.

import { setTimeout as sleep } from "node:timers/promises";
import { mapInOrder } from "../in-order/in-order.js";
import { isTransportError } from "./remote-calls.js";
import { linkOpen } from "./remote-channel.js";
import { enqueueCommand, stopOnHost } from "./remote-commands.js";
import { endWait, waitForAbort } from "./remote-run.js";
import type { RemoteEnv, RemoteRun } from "./remote-types.js";

/** The default time that a factory stop waits for the runs of the connected hosts. */
const SHUTDOWN_TIMEOUT_MS = 60_000;

type StopType = "stop-thread" | "cancel-thread";

/**
 * Submits the stop to the host when the host has an open channel and the run has no queued launch. Gives false when
 * the stop did not go to the host. A refused stop ends the wait of the run.
 */
async function submitStop(env: RemoteEnv, run: RemoteRun, type: StopType): Promise<boolean> {
  if (!linkOpen(env, run.host) || run.store.current.launchQueued) {
    return false;
  }

  try {
    await stopOnHost(env, run, type);

    return true;
  } catch (error) {
    if (isTransportError(error)) {
      return false;
    }

    endWait(run);

    return true;
  }
}

/**
 * Puts the stop in the queue of the host. When the launch of the run was in the queue, the queue drops it and the
 * wait of the run ends, because the main machine cannot know if the run started.
 */
async function queueStop(env: RemoteEnv, run: RemoteRun, type: StopType): Promise<void> {
  const { launchQueued } = run.store.current;

  await enqueueCommand(env, run.host, { type, threadId: run.threadId });

  if (launchQueued) {
    run.store.update(() => ({ launchQueued: false }));
    endWait(run);
  }
}

/** Records the stop request, and gives true when the run has a command on the host that a stop can reach. */
function requestStop(run: RemoteRun, kind: "stop" | "cancel"): boolean {
  if (run.store.current.closed) {
    return false;
  }

  const { commandId, adopted } = run.store.update((state) => ({ stopRequested: state.stopRequested ?? kind }));

  // Without a command id, the launch command has not gone to the host. The launch steps stop before it. An adopted
  // run can have a run on the host before the host gives its command id.
  return !!commandId || !!adopted;
}

/**
 * Stops or cancels a remote run. With an open channel, the host stops the run and sends its end. Without a channel,
 * the command goes in the queue of the host. A stopped run waits for the reconnect; the wait of a cancelled run ends,
 * and the Thread keeps its last status.
 */
export async function stopRemote(env: RemoteEnv, threadId: string, kind: "stop" | "cancel"): Promise<void> {
  const run = env.state.current.runs.get(threadId);

  if (!run || !requestStop(run, kind)) {
    return;
  }

  const type = kind === "stop" ? "stop-thread" : "cancel-thread";

  if (await submitStop(env, run, type)) {
    return;
  }

  await queueStop(env, run, type);

  if (kind === "cancel") {
    endWait(run);
  }
}

/** Stops one run for a factory stop. A run that the stop cannot reach now gets a queued stop, and its wait ends. */
async function stopForShutdown(env: RemoteEnv, run: RemoteRun): Promise<void> {
  if (!requestStop(run, "stop") || (await submitStop(env, run, "stop-thread"))) {
    return;
  }

  await queueStop(env, run, "stop-thread").catch(() => undefined);
  endWait(run);
}

/** Resolves when each run ended, or after the time limit. */
async function waitForRuns(runs: readonly RemoteRun[], timeoutMs: number): Promise<void> {
  const timer = new AbortController();
  const limit = sleep(timeoutMs, undefined, { signal: timer.signal }).catch(() => undefined);

  await Promise.race([Promise.all(runs.map((run) => waitForAbort(run.done.signal))), limit]);
  timer.abort();
}

/**
 * Stops each active run for a factory stop. It waits for the end of the runs on the connected hosts, with a time
 * limit, so that their outbox is applied as usual. After the limit, the wait of each run ends.
 */
export async function shutdownRemote(env: RemoteEnv, timeoutMs = SHUTDOWN_TIMEOUT_MS): Promise<void> {
  const runs = [...env.state.current.runs.values()].filter((run) => !run.store.current.closed);

  await mapInOrder(runs, (run) => stopForShutdown(env, run));
  await waitForRuns(runs, timeoutMs);
  await mapInOrder(runs, async (run) => endWait(run));
}
