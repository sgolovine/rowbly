// The `attachment-request` frames of a worker host. The main machine reads the requested attachment file from the
// canonical files, and uploads it to the cache of the host. It sends an `attachment-failed` frame when it cannot.
// It takes no lock, because it only reads canonical files.

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  attachmentDir,
  MAX_ATTACHMENT_BYTES,
  noSymlink,
  readAttachments,
  validateAttachmentBytes,
  validateAttachmentId,
} from "../attachment-files/attachment-files.js";
import { attachmentFileName, isAttachmentFileName } from "../attachment-files/attachment-type.js";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { withMember, withoutMember } from "../store/store.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import { cachePut } from "./remote-calls.js";
import type { HostLink, RemoteEnv } from "./remote-types.js";

/** One request of the host. */
interface AttachmentRequest {
  readonly storyId: string;
  readonly id: string;
}

/** Gives the canonical file of the attachment, after the checks of the ids, the manifest and the file name. */
async function attachmentFile(paths: ProjectPaths, request: AttachmentRequest): Promise<string> {
  validateAttachmentId(request.id);

  const dir = await attachmentDir(paths, request.storyId);
  const record = (await readAttachments(dir)).find((candidate) => candidate.id === request.id);

  if (!record) {
    throw new NotFoundError(`Attachment ${request.id} not found on ${request.storyId}`);
  }

  const file = attachmentFileName(record);

  if (!isAttachmentFileName(request.id, file)) {
    throw new ValidationError(`The file name of attachment ${request.id} is not valid`);
  }

  const path = join(dir, file);

  await noSymlink(path);

  return path;
}

/** Reads the bytes of the file. A missing file gives NOT_FOUND. A file larger than 10 MiB gives VALIDATION. */
async function readRequested(paths: ProjectPaths, request: AttachmentRequest): Promise<Buffer> {
  const path = await attachmentFile(paths, request);
  const info = await stat(path).catch(() => undefined);

  if (!info?.isFile()) {
    throw new NotFoundError(`The file of attachment ${request.id} is missing on ${request.storyId}`);
  }

  if (info.size > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("Attachment exceeds 10 MiB");
  }

  const bytes = await readFile(path);

  validateAttachmentBytes(bytes);

  return bytes;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Sends the failure answer on the channel. A channel that closed gets nothing. */
async function sendFailure(link: HostLink, id: string, error: unknown): Promise<void> {
  const channel = await link.opened.catch(() => undefined);

  channel?.send({ type: "attachment-failed", id, message: errorMessage(error) });
}

/** Uploads the file of the request with `host cache-put`, or sends the failure answer. */
async function serveRequest(env: RemoteEnv, link: HostLink, request: AttachmentRequest): Promise<void> {
  try {
    const bytes = await readRequested(env.input.paths, request);

    await cachePut({ connection: link.connection, projectId: env.input.projectId }, request.id, bytes);
  } catch (error) {
    await sendFailure(link, request.id, error);
  }
}

/** Gives the request of a frame. A frame without a string id cannot get an answer, so it gives `undefined`. */
function frameRequest(value: unknown): AttachmentRequest | undefined {
  const frame = (value ?? {}) as { storyId?: unknown; id?: unknown };

  if (typeof frame.id !== "string") {
    return undefined;
  }

  return { id: frame.id, storyId: typeof frame.storyId === "string" ? frame.storyId : "" };
}

/**
 * Takes an `attachment-request` frame of the host of the link. One request id gets at most one upload at a time. A
 * request for an id with an upload in progress is ignored.
 */
export function takeAttachmentRequest(env: RemoteEnv, link: HostLink, frame: unknown): Promise<void> {
  const request = frameRequest(frame);

  if (!request || link.fetching.current.ids.has(request.id)) {
    return Promise.resolve();
  }

  link.fetching.update((state) => ({ ids: withMember(state.ids, request.id) }));

  return serveRequest(env, link, request).finally(() =>
    link.fetching.update((state) => ({ ids: withoutMember(state.ids, request.id) })),
  );
}
