import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Attachment } from "../attachment-files/attachment-files.js";
import { ConflictError } from "../errors/errors.js";
import type { MarkdownDocument } from "../markdown/markdown.js";
import { dependsOnOf, tagsOf } from "../story-files/story-files.js";

/** One changed value of a Story. A list value (`tags`, `dependsOn`) is the complete list. */
export interface FieldChange {
  /** `title`, `description`, `stage`, `fields.<key>`, `tags` or `dependsOn`. */
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

/** The changes of one Story write. */
export interface StoryWrite {
  readonly storyId: string;
  /** The `uid` of the Story. A Story without a `uid`, or an entry of an older build, has none. */
  readonly storyUid?: string;
  readonly changes: readonly FieldChange[];
}

/** A new attachment of a Story, with the bytes of its file. */
export interface AttachmentAddWrite {
  readonly storyId: string;
  /** The `uid` of the Story. A Story without a `uid`, or an entry of an older build, has none. */
  readonly storyUid?: string;
  readonly attachment: Attachment;
  readonly bytes: Uint8Array;
}

/** A removed attachment of a Story, with the lowercase hex SHA-256 of the removed file. */
export interface AttachmentRemoveWrite {
  readonly storyId: string;
  /** The `uid` of the Story. A Story without a `uid`, or an entry of an older build, has none. */
  readonly storyUid?: string;
  readonly id: string;
  readonly sha256: string;
}

/** The body of an `attachment.add` entry. The file is in `blobs/<sha256>.png` of the outbox folder. */
interface AttachmentAddBody {
  readonly storyId: string;
  /** The `uid` of the Story. A Story without a `uid`, or an entry of an older build, has none. */
  readonly storyUid?: string;
  readonly type: "attachment.add";
  readonly attachment: Attachment;
  readonly sha256: string;
}

/** The body of an `attachment.remove` entry. */
interface AttachmentRemoveBody extends AttachmentRemoveWrite {
  readonly type: "attachment.remove";
}

/** The part of an entry that tells the write. A field entry has no `type`. */
export type EntryBody = StoryWrite | AttachmentAddBody | AttachmentRemoveBody;

/** The values that the outbox adds to each entry. */
interface EntryMeta {
  /** The order of the entry in the outbox folder. It starts at 1 and increases by 1 for each entry. */
  readonly seq: number;
  /** A unique ID for each entry. */
  readonly opId: string;
  /** The Thread of the worker that made the write. */
  readonly threadId: string;
}

/** One line of `outbox.jsonl`. */
export type OutboxEntry = EntryMeta & EntryBody;

/** Records each canonical Story write of a remote worker, so that the main machine can apply it later. */
export interface WriteRecorder {
  readonly record: (write: StoryWrite) => Promise<void>;
  readonly recordAttachmentAdd: (write: AttachmentAddWrite) => Promise<void>;
  readonly recordAttachmentRemove: (write: AttachmentRemoveWrite) => Promise<void>;
}

/** The part of a `ServiceContext` that the outbox uses. */
interface RecorderContext {
  readonly recorder?: WriteRecorder;
}

/** The recorded values of a Story document, by path. Derived values such as `updatedAt` are not in the list. */
function recordedValues(fieldKeys: readonly string[], doc: MarkdownDocument): [string, unknown][] {
  const { data } = doc;

  return [
    ["title", data.title ?? null],
    ["description", doc.body],
    ["stage", data.stage ?? null],
    ...fieldKeys.map((key): [string, unknown] => [`fields.${key}`, data[key] ?? null]),
    ["tags", tagsOf(data)],
    ["dependsOn", dependsOnOf(data)],
  ];
}

/** The changes from `before` to `after`, one for each recorded path with a different value. */
export function storyChanges(
  fieldKeys: readonly string[],
  before: MarkdownDocument,
  after: MarkdownDocument,
): FieldChange[] {
  const old = new Map(recordedValues(fieldKeys, before));

  return recordedValues(fieldKeys, after)
    .filter(([path, value]) => !isDeepStrictEqual(old.get(path), value))
    .map(([path, value]) => ({ path, before: old.get(path), after: value }));
}

/** Records the write when the context has a recorder and the write changes a recorded value. */
export async function recordStoryWrite(ctx: RecorderContext, write: StoryWrite): Promise<void> {
  if (!ctx.recorder || write.changes.length === 0) {
    return;
  }

  await ctx.recorder.record(write);
}

/** The lowercase hex SHA-256 of the bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Records a new attachment when the context has a recorder. */
export async function recordAttachmentAdd(ctx: RecorderContext, write: AttachmentAddWrite): Promise<void> {
  if (!ctx.recorder) {
    return;
  }

  await ctx.recorder.recordAttachmentAdd(write);
}

/** Records a removed attachment when the context has a recorder. */
export async function recordAttachmentRemove(ctx: RecorderContext, write: AttachmentRemoveWrite): Promise<void> {
  if (!ctx.recorder) {
    return;
  }

  await ctx.recorder.recordAttachmentRemove(write);
}

/**
 * Throws a `ConflictError` when the context has a recorder. A remote worker can change only the fields and the Stage
 * of a Story, so each other write must stop before it changes a file. `action` tells the write, for example
 * `create a Story`.
 */
export function refuseRemoteWrite(ctx: RecorderContext, action: string): void {
  if (!ctx.recorder) {
    return;
  }

  throw new ConflictError(`A remote worker cannot ${action}`, {
    hint: "A remote worker can only change the fields of a Story and move it to a different Stage.",
    details: { remote: true },
  });
}
