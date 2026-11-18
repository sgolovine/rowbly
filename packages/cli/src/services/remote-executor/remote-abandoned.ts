// The abandoned remote Threads of the executor: the abandon on a cancel that cannot reach the host, the last run
// frame that waits for the outbox sync, and the write of the remote outcome after the sync.

import type { HostRunState } from "../host-agent/host-run-state.js";
import { mapInOrder } from "../in-order/in-order.js";
import { withEntry, withoutEntry } from "../store/store.js";
import type { AbandonReason } from "../thread/thread.js";
import { closeIdleLink, linkOpen } from "./remote-channel.js";
import type { AbandonedThread, RemoteEnv, RemoteRun } from "./remote-types.js";

/** Gives the abandoned Threads without a remote outcome. A failed read gives no Threads. */
async function abandonedThreads(env: RemoteEnv): Promise<readonly AbandonedThread[]> {
  if (!env.input.abandoned) {
    return [];
  }

  return env.input.abandoned().catch(() => []);
}

/** Gives the ids of the abandoned Threads of the host that wait for their remote outcome. */
export async function abandonedOf(env: RemoteEnv, host: string): Promise<string[]> {
  return (await abandonedThreads(env)).filter((thread) => thread.host === host).map((thread) => thread.threadId);
}

/** True when the host has a last run frame of an abandoned Thread that waits for the outbox sync. */
export function hasPendingOutcome(env: RemoteEnv, host: string): boolean {
  return [...env.state.current.outcomes.values()].some((pending) => pending.host === host);
}

/** True when the host has an abandoned Thread without a remote outcome, or a frame that waits for the sync. */
export async function hasAbandonedWork(env: RemoteEnv, host: string): Promise<boolean> {
  return hasPendingOutcome(env, host) || (await abandonedOf(env, host)).length > 0;
}

/**
 * Gives the hosts whose outbox the scan sync applies for the abandoned Threads: each host with a frame that waits for
 * the sync, and each host with an abandoned Thread and an open channel. A host without a channel waits for the
 * reconnect.
 */
export async function abandonedSyncHosts(env: RemoteEnv): Promise<string[]> {
  const pending = [...env.state.current.outcomes.values()].map((entry) => entry.host);
  const open = (await abandonedThreads(env)).map((thread) => thread.host).filter((host) => linkOpen(env, host));

  return [...new Set([...pending, ...open])];
}

/** Keeps the last run frame of an abandoned Thread until the outbox of its host is applied. */
export function keepOutcome(env: RemoteEnv, host: string, frame: HostRunState): void {
  env.state.update((state) => ({ outcomes: withEntry(state.outcomes, frame.threadId, { host, frame }) }));
}

/** Writes one remote outcome. A failure keeps the frame for the next sync. */
async function writeOutcome(env: RemoteEnv, threadId: string, frame: HostRunState): Promise<void> {
  try {
    await env.input.outcome?.(threadId, frame);
  } catch {
    return;
  }

  env.state.update((state) => ({ outcomes: withoutEntry(state.outcomes, threadId) }));
}

/**
 * Writes the remote outcome of each abandoned Thread of the host whose last frame waited for the sync. The caller
 * applied the outbox. Then it closes the channel when the host has no other work.
 */
export async function flushOutcomes(env: RemoteEnv, host: string): Promise<void> {
  const pending = [...env.state.current.outcomes].filter(([, entry]) => entry.host === host);

  await mapInOrder(pending, ([threadId, entry]) => writeOutcome(env, threadId, entry.frame));

  if (pending.length > 0 && !(await hasAbandonedWork(env, host))) {
    closeIdleLink(env, host);
  }
}

/**
 * Records that the cancel or the release of the run did not reach its host. The Thread becomes abandoned with the
 * reason. A failure is ignored.
 */
export async function abandonRun(env: RemoteEnv, run: RemoteRun, reason: AbandonReason): Promise<void> {
  await env.input.abandon?.(run.threadId, run.host, reason).catch(() => undefined);
}
