// The attachment source of the CLI of a remote worker. It gives a file from the cache of the host agent, or it asks
// the main machine for the file through a fetch request and the `host attach` channel.

import { setTimeout as sleep } from "node:timers/promises";
import { hasCachedAttachment, readCachedAttachment } from "../attachment-cache/attachment-cache.js";
import type { AttachmentFetch, RemoteAttachmentSource } from "../attachment-cache/attachment-source.js";
import { validateAttachmentId } from "../attachment-files/attachment-files.js";
import { ConflictError } from "../errors/errors.js";
import type { OwnerProbe } from "../factory-ownership/ownership-lock.js";
import { type HostAgentPaths, validateStoryId } from "./host-agent-paths.js";
import { channelLive } from "./host-channel-mark.js";
import { readFetchFailure, removeFetchRequest, writeFetchRequest } from "./host-fetch.js";

/** The default time that a read waits for the file of the main machine. */
export const DEFAULT_ATTACHMENT_FETCH_MS = 30_000;

/** The default time between two checks of the cache and of the failure answer. */
export const DEFAULT_ATTACHMENT_FETCH_POLL_MS = 250;

export interface HostAttachmentSourceOptions {
  readonly paths: HostAgentPaths;
  /** Tells whether the process of the channel mark is alive. Tests give a fake. */
  readonly probe?: OwnerProbe;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly now?: () => Date;
}

/** One read that waits for the file. */
interface Wait {
  readonly options: HostAttachmentSourceOptions;
  readonly request: AttachmentFetch;
  readonly deadline: number;
}

const NOT_AVAILABLE = "The attachment is not available on this host.";

function offline(request: AttachmentFetch, reason: string): ConflictError {
  return new ConflictError(
    `The worker host is offline: ${reason}. Attachment ${request.id} of ${request.storyId} is not in the copy. ${NOT_AVAILABLE}`,
    { details: { storyId: request.storyId, id: request.id } },
  );
}

function refused(request: AttachmentFetch, message: string): ConflictError {
  return new ConflictError(
    `The main machine cannot send attachment ${request.id} of ${request.storyId}: ${message} ${NOT_AVAILABLE}`,
    { details: { storyId: request.storyId, id: request.id } },
  );
}

function cacheEntry(options: HostAttachmentSourceOptions, id: string) {
  return { dir: options.paths.attachments, id };
}

/** Waits until the cache has the file. A failure answer, a channel that is not live or the time limit throws. */
async function waitForFile(wait: Wait): Promise<void> {
  const { options, request } = wait;

  if (await hasCachedAttachment(cacheEntry(options, request.id))) {
    return;
  }

  const failure = await readFetchFailure(options.paths, request.id);

  if (failure !== undefined) {
    throw refused(request, failure);
  }

  if (!(await channelLive(options.paths, options.probe))) {
    throw offline(request, "the channel to the main machine closed");
  }

  if (Date.now() >= wait.deadline) {
    const limit = options.timeoutMs ?? DEFAULT_ATTACHMENT_FETCH_MS;

    throw offline(request, `the main machine did not send the file in ${limit} ms`);
  }

  await sleep(options.pollMs ?? DEFAULT_ATTACHMENT_FETCH_POLL_MS);

  return waitForFile(wait);
}

/** Asks the main machine for the file, and waits for it. The request and its answer go at the end of the wait. */
async function requestFile(options: HostAttachmentSourceOptions, request: AttachmentFetch): Promise<void> {
  const now = options.now?.() ?? new Date();
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_ATTACHMENT_FETCH_MS);

  await writeFetchRequest(options.paths, { ...request, now });

  try {
    await waitForFile({ options, request, deadline });
  } finally {
    await removeFetchRequest(options.paths, request.id);
  }
}

/** Gives the bytes from the cache. Without them, it asks the main machine when the channel is live. */
async function fetchAttachment(options: HostAttachmentSourceOptions, request: AttachmentFetch): Promise<Uint8Array> {
  validateAttachmentId(request.id);
  validateStoryId(request.storyId);

  const entry = cacheEntry(options, request.id);

  if (await hasCachedAttachment(entry)) {
    return readCachedAttachment(entry);
  }

  if (!(await channelLive(options.paths, options.probe))) {
    throw offline(request, "it has no live channel to the main machine");
  }

  await requestFile(options, request);

  return readCachedAttachment(entry);
}

/** Makes the attachment source of the workers of the host agent in `paths`. */
export function hostAttachmentSource(options: HostAttachmentSourceOptions): RemoteAttachmentSource {
  return { fetch: (request) => fetchAttachment(options, request) };
}
