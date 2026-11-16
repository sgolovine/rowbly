import { missingCachedAttachments, putCachedAttachment } from "../attachment-cache/attachment-cache.js";
import { validateAttachmentId } from "../attachment-files/attachment-files.js";
import { ValidationError } from "../errors/errors.js";
import { ensurePrivateDir, type HostAgentPaths } from "./host-agent-paths.js";

/** The answer of `host cache-missing`. */
export interface CacheMissingAnswer {
  readonly missing: readonly string[];
}

/** The answer of `host cache-put`. `added` is false when the cache already had the attachment file. */
export interface CachePutAnswer {
  readonly id: string;
  readonly added: boolean;
}

/** The largest number of ids in one `cache-missing` request. */
const CACHE_IDS_LIMIT = 10_000;

function requestIds(input: unknown): readonly string[] {
  const ids = (input as { ids?: unknown } | null)?.ids;

  if (!Array.isArray(ids) || ids.length > CACHE_IDS_LIMIT || !ids.every((id) => typeof id === "string")) {
    throw new ValidationError(`The input must be { "ids": [<attachment id>, …] } with at most ${CACHE_IDS_LIMIT} ids`);
  }

  return ids;
}

/** Gives the attachment ids of the request that are not in the attachment cache of the Project. A bad id gives VALIDATION. */
export async function hostCacheMissing(paths: HostAgentPaths, input: unknown): Promise<CacheMissingAnswer> {
  const ids = requestIds(input);

  return { missing: await missingCachedAttachments({ dir: paths.attachments, ids }) };
}

/**
 * Puts the bytes of an attachment file of any type in the cache of the Project. A bad id or bytes larger than 10 MiB
 * give VALIDATION.
 */
export async function hostCachePut(paths: HostAgentPaths, id: string, bytes: Uint8Array): Promise<CachePutAnswer> {
  validateAttachmentId(id);
  await ensurePrivateDir(paths.attachments);

  return { id, added: await putCachedAttachment({ dir: paths.attachments, id, bytes }) };
}
