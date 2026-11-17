// The executor that runs each worker in the host agent of a worker host. It does not load Pi or start a process.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { attachmentDir } from "../attachment-files/attachment-files.js";
import { ConflictError } from "../errors/errors.js";
import type { WorkerEvents, WorkerLaunch } from "../factory-manager/worker-executor.js";
import { mapInOrder } from "../in-order/in-order.js";
import { writeCopyBase } from "../outbox-apply/host-files.js";
import { Store, withEntry, withoutEntry } from "../store/store.js";
import { buildThreadCopy, type CopyAttachment, type ThreadCopy } from "../thread-copy/thread-copy.js";
import { adoptedRunState } from "./remote-adopt.js";
import {
  type CallTarget,
  cacheMissing,
  cachePut,
  isTransportError,
  newCommandId,
  prepare,
  runPaths,
  serve,
  submit,
} from "./remote-calls.js";
import { closeIdleLink, ensureLink } from "./remote-channel.js";
import { enqueueCommand, hooksOf, targetOf } from "./remote-commands.js";
import { reconnectHost } from "./remote-reconnect.js";
import { failRun, newRemoteRun, takeReceipt, waitForAbort } from "./remote-run.js";
import { shutdownRemote, stopRemote } from "./remote-stop.js";
import { syncHosts } from "./remote-sync.js";
import type { RemoteEnv, RemoteExecutor, RemoteExecutorInput, RemoteRun, RemoteState } from "./remote-types.js";

export type { HostConnection, RemoteExecutor, RemoteExecutorInput } from "./remote-types.js";

/** Makes the executor that runs each worker of a worker host in the host agent of that host. */
export function createRemoteExecutor(input: RemoteExecutorInput): RemoteExecutor {
  const state = new Store<RemoteState>({
    runs: new Map(),
    links: new Map(),
    queueChain: Promise.resolve(),
    reconnects: new Map(),
  });
  const env: RemoteEnv = { input, state };

  return {
    launch: (launch, events) => launchRemote(env, launch, events),
    stop: (threadId) => stopRemote(env, threadId, "stop"),
    cancel: (threadId) => stopRemote(env, threadId, "cancel"),
    steer: () => Promise.reject(new ConflictError("A worker on a worker host cannot get a steering message")),
    syncHosts: () => syncHosts(env),
    reconnect: (host) => reconnectHost(env, host),
    shutdown: (timeoutMs) => shutdownRemote(env, timeoutMs),
    adopt: (launch, events) => adoptRemote(env, launch, events),
  };
}

/** Runs one remote worker. Resolves when the run ended and its outbox is applied, or when the wait ends. */
async function launchRemote(env: RemoteEnv, launch: WorkerLaunch, events: WorkerEvents): Promise<void> {
  const host = launch.thread.host;

  if (!host) {
    await events.failed({ error: new ConflictError("The Thread has no worker host"), sessionOpened: false });
    return;
  }

  const run = newRemoteRun(launch.thread, host, events);

  env.state.update((state) => ({ runs: withEntry(state.runs, run.threadId, run) }));

  try {
    await startRemote(env, run, launch);
    await waitForAbort(run.done.signal);
  } catch (error) {
    await failRun(run, { error, sessionOpened: false });
  } finally {
    env.state.update((state) => ({ runs: withoutEntry(state.runs, run.threadId) }));
    closeIdleLink(env, host);
  }
}

/**
 * Follows a run that a previous daemon started. It sends no command: the reconnect of the host gives the run its
 * command id and its last state. Resolves when the run ended and its outbox is applied, or when the wait ends.
 */
async function adoptRemote(env: RemoteEnv, launch: WorkerLaunch, events: WorkerEvents): Promise<void> {
  const host = launch.thread.host;

  if (!host) {
    await events.failed({ error: new ConflictError("The Thread has no worker host"), sessionOpened: false });
    return;
  }

  const run = newRemoteRun(launch.thread, host, events);

  try {
    const start = await adoptedRunState(env, host, launch.thread);

    run.store.update(() => start);
    env.state.update((state) => ({ runs: withEntry(state.runs, run.threadId, run) }));
    void reconnectHost(env, host);
    await waitForAbort(run.done.signal);
  } catch (error) {
    await failRun(run, { error, sessionOpened: false });
  } finally {
    env.state.update((state) => ({ runs: withoutEntry(state.runs, run.threadId) }));
    closeIdleLink(env, host);
  }
}

/** Sends the copy, the attachments and the message to the host, then starts the run in the host agent. */
async function startRemote(env: RemoteEnv, run: RemoteRun, launch: WorkerLaunch): Promise<void> {
  const target = await targetOf(env, run.host);
  const model = env.input.model(launch);

  if (!model) {
    throw new ConflictError("The worker has no model");
  }

  const copy = await buildThreadCopy({ storyId: launch.story.id }, env.input.ctx);

  await uploadAttachments(env, target, copy.attachments);

  const paths = await runPaths(target, run.threadId, launch.story.id);
  const location = { root: paths.copy, shim: paths.shim, lock: paths.lock, checks: false };
  const message = await run.events.message(paths.worktree, model, location);

  await prepare(target, {
    threadId: run.threadId,
    thread: launch.thread,
    storyId: launch.story.id,
    clone: target.connection.clone,
    model,
    message,
    copy,
  });
  await writeBase(env, run, copy);
  await serve(target, env.input.maxWorkers(run.host));
  await ensureLink(env, run.host, target.connection, hooksOf(env));
  await submitLaunch(env, target, run, launch);
}

async function writeBase(env: RemoteEnv, run: RemoteRun, copy: ThreadCopy): Promise<void> {
  await writeCopyBase(env.input.paths, run.host, run.threadId, copy);
}

/** Uploads only the attachment files that the cache of the host does not have. */
async function uploadAttachments(
  env: RemoteEnv,
  target: CallTarget,
  attachments: readonly CopyAttachment[],
): Promise<void> {
  const ids = [...new Set(attachments.map((attachment) => attachment.id))];
  const missing = new Set(await cacheMissing(target, ids));
  const uploads = ids.flatMap((id) => {
    const attachment = attachments.find((candidate) => candidate.id === id);

    return attachment && missing.has(id) ? [attachment] : [];
  });

  await mapInOrder(uploads, (attachment) => uploadAttachment(env, target, attachment));
}

async function uploadAttachment(env: RemoteEnv, target: CallTarget, attachment: CopyAttachment): Promise<void> {
  const dir = await attachmentDir(env.input.paths, attachment.storyId);

  await cachePut(target, attachment.id, await readFile(join(dir, attachment.file)));
}

/**
 * Submits the `launch` command, or `resume` for a Thread with more than one run. One launch submits one command. When
 * the submit fails in the transport, the host can have the command or not. The same command, with the same id, goes
 * in the queue of the host, and the run waits for the reconnect.
 */
async function submitLaunch(env: RemoteEnv, target: CallTarget, run: RemoteRun, launch: WorkerLaunch): Promise<void> {
  if (run.store.current.stopRequested) {
    throw new ConflictError(`The worker was stopped before the launch on host ${run.host}`);
  }

  const commandId = newCommandId();
  const kind = launch.thread.runs.length > 1 ? "resume" : "launch";

  run.store.update(() => ({ commandId }));

  try {
    const receipt = await submit(target, kind, run.threadId, commandId);

    if (receipt) {
      takeReceipt(run, receipt);
    }
  } catch (error) {
    if (!isTransportError(error)) {
      throw error;
    }

    run.store.update(() => ({ launchQueued: true }));
    await enqueueCommand(env, run.host, { type: kind, threadId: run.threadId, id: commandId });
  }
}
