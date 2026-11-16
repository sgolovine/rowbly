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
import {
  type CallTarget,
  cacheMissing,
  cachePut,
  newCommandId,
  prepare,
  runPaths,
  serve,
  submit,
} from "./remote-calls.js";
import { closeIdleLink, ensureLink, hostRuns, linkOpen } from "./remote-channel.js";
import {
  endSyncedRuns,
  endWait,
  failRun,
  newRemoteRun,
  type RunHooks,
  takeReceipt,
  waitForAbort,
  waitsForSync,
} from "./remote-run.js";
import type { RemoteEnv, RemoteExecutor, RemoteExecutorInput, RemoteRun, RemoteState } from "./remote-types.js";

export type { HostConnection, RemoteExecutor, RemoteExecutorInput } from "./remote-types.js";

/** Makes the executor that runs each worker of a worker host in the host agent of that host. */
export function createRemoteExecutor(input: RemoteExecutorInput): RemoteExecutor {
  const env: RemoteEnv = { input, state: new Store<RemoteState>({ runs: new Map(), links: new Map() }) };

  return {
    launch: (launch, events) => launchRemote(env, launch, events),
    stop: (threadId) => stopRemote(env, threadId, "stop"),
    cancel: (threadId) => stopRemote(env, threadId, "cancel"),
    steer: () => Promise.reject(new ConflictError("A worker on a worker host cannot get a steering message")),
    syncHosts: () => syncHosts(env),
  };
}

function hooksOf(env: RemoteEnv): RunHooks {
  return { sync: env.input.sync, stopHost: (run) => stopOnHost(env, run, "stop-thread") };
}

async function targetOf(env: RemoteEnv, host: string): Promise<CallTarget> {
  return { connection: await env.input.connect(host), projectId: env.input.projectId };
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
  await submitLaunch(target, run, launch);
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

/** Submits the `launch` command, or `resume` for a Thread with more than one run. One launch submits one command. */
async function submitLaunch(target: CallTarget, run: RemoteRun, launch: WorkerLaunch): Promise<void> {
  if (run.store.current.stopRequested) {
    throw new ConflictError(`The worker was stopped before the launch on host ${run.host}`);
  }

  const commandId = newCommandId();
  const kind = launch.thread.runs.length > 1 ? "resume" : "launch";

  run.store.update(() => ({ commandId }));

  const receipt = await submit(target, kind, run.threadId, commandId);

  if (receipt) {
    takeReceipt(run, receipt);
  }
}

/** Submits `stop-thread` or `cancel-thread` for the run. */
async function stopOnHost(env: RemoteEnv, run: RemoteRun, type: "stop-thread" | "cancel-thread"): Promise<void> {
  await submit(await targetOf(env, run.host), type, run.threadId);
}

/**
 * Stops a remote run. With an open channel, the host stops the run and sends its end. Without a channel, the wait of
 * the launch ends without an event, so that the Thread keeps its last status.
 */
async function stopRemote(env: RemoteEnv, threadId: string, kind: "stop" | "cancel"): Promise<void> {
  const run = env.state.current.runs.get(threadId);

  if (!run || run.store.current.closed) {
    return;
  }

  run.store.update((state) => ({ stopRequested: state.stopRequested ?? kind }));

  if (!run.store.current.commandId) {
    return;
  }

  if (!linkOpen(env, run.host)) {
    endWait(run);
    return;
  }

  await stopOnHost(env, run, kind === "stop" ? "stop-thread" : "cancel-thread").catch(() => endWait(run));
}

/** True when the outbox of the host can be applied now. A run before its session waits for its session first. */
function canSync(runs: readonly RemoteRun[]): boolean {
  return runs.some(waitsForSync) || runs.every((run) => run.store.current.sessionOpened);
}

/** Applies the outbox of one host, then ends the runs that waited for the sync. Gives the problem of a failure. */
async function syncHost(env: RemoteEnv, host: string): Promise<[string, string | undefined]> {
  const runs = hostRuns(env, host).filter((run) => !run.store.current.closed);

  if (runs.length === 0 || !canSync(runs)) {
    return [host, undefined];
  }

  const waiting = runs.filter(waitsForSync);

  try {
    await env.input.sync(host);
  } catch (error) {
    return [host, error instanceof Error ? error.message : String(error)];
  }

  await endSyncedRuns(waiting);

  return [host, undefined];
}

async function syncHosts(env: RemoteEnv): Promise<ReadonlyMap<string, string>> {
  const hosts = [...new Set([...env.state.current.runs.values()].map((run) => run.host))];
  const results = await mapInOrder(hosts, (host) => syncHost(env, host));

  return new Map(results.filter((result): result is [string, string] => result[1] !== undefined));
}
