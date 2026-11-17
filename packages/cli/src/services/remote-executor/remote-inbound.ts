// The inbound updates of the remote runs: the diff of the base of each run and the canonical files, the durable queue
// of each Thread, and the send of the waiting updates to the host. The answer of the host is the acknowledgement.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { attachmentDir } from "../attachment-files/attachment-files.js";
import { readConfig } from "../config/config.js";
import { NotFoundError } from "../errors/errors.js";
import { mapInOrder } from "../in-order/in-order.js";
import { inboundDiff } from "../inbound/inbound-diff.js";
import type { AttachmentAddBody, InboundUpdate } from "../inbound/inbound-types.js";
import { isTransportFailure } from "../outbox-apply/apply-state.js";
import { readCopyBase, writeCopyBase } from "../outbox-apply/host-files.js";
import { projectWrite } from "../project-write/project-write.js";
import { buildThreadCopy, type ThreadCopy } from "../thread-copy/thread-copy.js";
import { acknowledgeInbound, clearInbound, queueInboundUpdates, readInboundQueue } from "./inbound-queue.js";
import { type CallTarget, cacheMissing, cachePut, inbound, isNotPrepared } from "./remote-calls.js";
import { targetOf, withQueueLock } from "./remote-commands.js";
import type { RemoteEnv, RemoteRun } from "./remote-types.js";

/** Runs the read of the canonical files under the Project write lock, in the order of the manager when it gives one. */
function readLocked<T>(env: RemoteEnv, read: () => Promise<T>): Promise<T> {
  const locked = env.input.readLocked;

  return locked ? locked(read) : projectWrite(env.input.paths.root, read);
}

/** True when the run has a base on the disk: its launch or resume command was made after the prepare. */
export function hasBase(run: RemoteRun): boolean {
  return run.storyId !== undefined && run.store.current.commandId !== undefined && !run.store.current.closed;
}

/** Gives the canonical copy of the Story of the Thread. A Story that does not exist now gives `undefined`. */
async function currentCopy(env: RemoteEnv, storyId: string): Promise<ThreadCopy | undefined> {
  try {
    return await buildThreadCopy({ storyId }, env.input.ctx);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return undefined;
    }

    throw error;
  }
}

function sameCopy(base: ThreadCopy, current: ThreadCopy): boolean {
  return isDeepStrictEqual(base.files, current.files) && isDeepStrictEqual(base.attachments, current.attachments);
}

/**
 * Compares the canonical files with the base of the run. The updates go in the queue of the Thread first, then the
 * base gets the current values. A crash between the two writes makes the same updates again, and they have no effect.
 */
async function diffLocked(env: RemoteEnv, run: RemoteRun, storyId: string): Promise<void> {
  const { paths } = env.input;
  const base = await readCopyBase(paths, run.host, run.threadId);
  const current = await currentCopy(env, storyId);

  if (!(base && current) || sameCopy(base, current)) {
    return;
  }

  const config = await readConfig(paths);
  const fieldKeys = config.customFields.map((field) => field.key);
  const bodies = inboundDiff({ base, current, fieldKeys });

  await withQueueLock(env, () => queueInboundUpdates(paths, run.host, run.threadId, bodies));
  await writeCopyBase(paths, run.host, run.threadId, current);
}

/** Makes the inbound updates of the run from the diff of its base and the canonical files. */
export async function diffRun(env: RemoteEnv, run: RemoteRun): Promise<void> {
  const { storyId } = run;

  if (!(storyId && hasBase(run))) {
    return;
  }

  await readLocked(env, () => diffLocked(env, run, storyId));
}

/** Reads the canonical file of the attachment. A file that is not there now gives `undefined`. */
async function attachmentBytes(env: RemoteEnv, update: AttachmentAddBody & { file: string }) {
  const dir = await attachmentDir(env.input.paths, update.storyId);

  try {
    return await readFile(join(dir, update.file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function uploadOne(env: RemoteEnv, target: CallTarget, update: AttachmentAddBody & { file: string }) {
  const bytes = await attachmentBytes(env, update);

  if (bytes) {
    await cachePut(target, update.attachment.id, bytes);
  }
}

/** Uploads the file of each new attachment with a `file` that the cache of the host does not have. */
async function uploadFiles(env: RemoteEnv, target: CallTarget, updates: readonly InboundUpdate[]): Promise<void> {
  const adds = updates.filter(
    (update): update is InboundUpdate & AttachmentAddBody & { file: string } =>
      update.type === "attachment.add" && typeof update.file === "string",
  );
  const missing = new Set(await cacheMissing(target, [...new Set(adds.map((update) => update.attachment.id))]));
  const uploads = adds.filter((update) => missing.has(update.attachment.id));
  const unique = [...new Map(uploads.map((update) => [update.attachment.id, update])).values()];

  await mapInOrder(unique, (update) => uploadOne(env, target, update));
}

/**
 * Sends the waiting updates of the Thread to the host. The host gives its last applied `seq`, and the updates with
 * that `seq` or less leave the queue. A Thread that is not prepared on the host loses its waiting updates. Each other
 * failure throws, and the updates stay in the queue.
 */
export async function sendInbound(env: RemoteEnv, host: string, threadId: string): Promise<void> {
  const { paths } = env.input;
  const queue = await withQueueLock(env, () => readInboundQueue(paths, host, threadId));

  if (queue.updates.length === 0) {
    return;
  }

  const target = await targetOf(env, host);

  try {
    await uploadFiles(env, target, queue.updates);

    const seq = await inbound(target, threadId, queue.updates);

    await withQueueLock(env, () => acknowledgeInbound(paths, host, threadId, seq));
  } catch (error) {
    if (!isNotPrepared(error)) {
      throw error;
    }

    await withQueueLock(env, () => clearInbound(paths, host, threadId));
  }
}

/** True when a Thread of the runs has waiting updates. */
export async function hasWaitingInbound(env: RemoteEnv, host: string, runs: readonly RemoteRun[]): Promise<boolean> {
  const queues = await mapInOrder(runs, (run) =>
    withQueueLock(env, () => readInboundQueue(env.input.paths, host, run.threadId)),
  );

  return queues.some((queue) => queue.updates.length > 0);
}

/** Sends the waiting updates of each run, in order. A failure stops the later sends and throws. */
export async function sendInboundAll(env: RemoteEnv, host: string, runs: readonly RemoteRun[]): Promise<void> {
  await mapInOrder(runs, (run) => sendInbound(env, host, run.threadId));
}

/**
 * Makes and sends the inbound updates of each run. A failure of the transport keeps the updates in the queue and
 * gives no problem: the heartbeat and the reconnect send them later. Each other failure gives its problem.
 */
export async function updateRuns(
  env: RemoteEnv,
  host: string,
  runs: readonly RemoteRun[],
): Promise<string | undefined> {
  try {
    await mapInOrder(runs, (run) => diffRun(env, run));
    await sendInboundAll(env, host, runs.filter(hasBase));

    return undefined;
  } catch (error) {
    return isTransportFailure(error) ? undefined : problemOf(error);
  }
}

function problemOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Removes the waiting updates of the Thread, for a new prepare or the end of a run. A failure is ignored. */
export async function dropInbound(env: RemoteEnv, host: string, threadId: string): Promise<void> {
  try {
    await withQueueLock(env, () => clearInbound(env.input.paths, host, threadId));
  } catch {
    // The queue stays. A later prepare or end removes it.
  }
}
