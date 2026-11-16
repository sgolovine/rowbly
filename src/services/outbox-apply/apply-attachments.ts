// The apply of the `attachment.add` and `attachment.remove` entries.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { addAttachment, listAttachments, removeAttachment } from "../attachment/attachment.js";
import { attachmentDir, MAX_ATTACHMENT_BYTES } from "../attachment-files/attachment-files.js";
import { attachmentFileName } from "../attachment-files/attachment-type.js";
import { type OutboxEntry, sha256Hex } from "../outbox/outbox.js";
import { type ApplyEnv, findStory, isTransportFailure, type OutboxConflict, rowblyProblem } from "./apply-state.js";
import { keepConflictPng } from "./host-files.js";

/** An `attachment.add` entry. */
type AddEntry = Extract<OutboxEntry, { type: "attachment.add" }>;

/** An `attachment.remove` entry. */
type RemoveEntry = Extract<OutboxEntry, { type: "attachment.remove" }>;

/** The file of the entry, or the reason why the main machine cannot get it. */
type FetchedPng =
  | { readonly bytes: Uint8Array; readonly problem?: string }
  | { readonly bytes?: undefined; readonly problem: string };

/** Gives the problem of the bytes: a different hash, or more than 10 MiB. An attachment can have any file type. */
function pngProblem(bytes: Uint8Array, sha256: string): string | undefined {
  if (sha256Hex(bytes) !== sha256) {
    return "The file does not have the sha256 of the entry";
  }

  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    return "The file is larger than 10 MiB";
  }

  return undefined;
}

/** Gets the file from the source. A connection failure stops the apply. A different failure is a problem. */
async function fetchPng(env: ApplyEnv, sha256: string): Promise<FetchedPng> {
  try {
    const bytes = await env.source.blob(sha256);

    return { bytes, problem: pngProblem(bytes, sha256) };
  } catch (error) {
    if (isTransportFailure(error)) {
      throw error;
    }

    return { problem: `Cannot get the file: ${rowblyProblem(error)}` };
  }
}

/** Gets the file when necessary, keeps it for recovery, and gives the conflict. */
async function addConflict(
  env: ApplyEnv,
  entry: AddEntry,
  reason: string,
  fetched?: FetchedPng,
): Promise<OutboxConflict[]> {
  const png = fetched ?? (await fetchPng(env, entry.sha256));
  const kept = png.bytes ? await keepConflictPng(env.paths, env.host, png.bytes) : undefined;
  const base = { host: env.host, seq: entry.seq, storyId: entry.storyId, attachmentId: entry.attachment.id };

  return [{ ...base, after: entry.sha256, reason, ...(kept ? { png: kept } : {}) }];
}

/** The sha256 of the file of the attachment with the id, or `undefined` when the Story does not have it. */
async function currentHash(env: ApplyEnv, storyId: string, id: string): Promise<string | undefined> {
  const records = await listAttachments({ story: storyId }, env.ctx);
  const record = records.find((entry) => entry.id === id);

  if (!record) {
    return undefined;
  }

  const dir = await attachmentDir(env.paths, storyId);

  return sha256Hex(await readFile(join(dir, attachmentFileName(record))));
}

/** Adds the attachment with the id and the name of the entry. A refused add is a conflict. */
async function addPng(env: ApplyEnv, entry: AddEntry, storyId: string, png: FetchedPng): Promise<OutboxConflict[]> {
  try {
    const image = { name: entry.attachment.name, bytes: png.bytes as Uint8Array };

    await addAttachment({ story: storyId, image, id: entry.attachment.id }, env.ctx);

    return [];
  } catch (error) {
    return addConflict(env, entry, rowblyProblem(error), png);
  }
}

/**
 * Applies one `attachment.add` entry. The same id with the same file is skipped. A missing Story, the same id with a
 * different file, or a bad file is a conflict, and the file stays in `runtime/hosts/<host>/conflicts/`.
 */
export async function applyAttachmentAdd(env: ApplyEnv, entry: AddEntry): Promise<OutboxConflict[]> {
  const found = await findStory(env, entry);

  if (!found.story) {
    return addConflict(env, entry, found.problem);
  }

  const current = await currentHash(env, found.story.id, entry.attachment.id);

  if (current === entry.sha256) {
    return [];
  }

  if (current) {
    return addConflict(env, entry, `The Story has attachment ${entry.attachment.id} with a different file`);
  }

  const png = await fetchPng(env, entry.sha256);

  if (png.problem) {
    return addConflict(env, entry, png.problem, png);
  }

  return addPng(env, entry, found.story.id, png);
}

/** Applies one `attachment.remove` entry. An attachment or a Story that is not there is skipped. */
export async function applyAttachmentRemove(env: ApplyEnv, entry: RemoveEntry): Promise<OutboxConflict[]> {
  const found = await findStory(env, entry);

  if (!found.story) {
    return [];
  }

  const records = await listAttachments({ story: found.story.id }, env.ctx);

  if (!records.some((record) => record.id === entry.id)) {
    return [];
  }

  try {
    await removeAttachment({ story: found.story.id, id: entry.id }, env.ctx);

    return [];
  } catch (error) {
    const reason = rowblyProblem(error);

    return [{ host: env.host, seq: entry.seq, storyId: entry.storyId, attachmentId: entry.id, reason }];
  }
}
