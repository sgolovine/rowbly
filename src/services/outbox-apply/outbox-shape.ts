// The shape check of one outbox entry that the main machine gets from a worker host.

import type { OutboxEntry } from "../outbox/outbox.js";

/** The result of the shape check: the entry, or the reason why the value is not an entry. */
export type CheckedEntry =
  | { readonly entry: OutboxEntry; readonly problem?: undefined }
  | { readonly entry?: undefined; readonly problem: string };

const SHA256 = /^[0-9a-f]{64}$/;

type Fields = Record<string, unknown>;

function isObject(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** The `seq` of the value, or 0 when the value has no valid `seq`. */
export function entrySeq(value: unknown): number {
  const seq = isObject(value) ? value.seq : undefined;

  return typeof seq === "number" && Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
}

/** The Story ID of the value, or `undefined` when the value has none. */
export function entryStoryId(value: unknown): string | undefined {
  return isObject(value) && isText(value.storyId) ? value.storyId : undefined;
}

function isChange(value: unknown): boolean {
  return isObject(value) && isText(value.path) && "before" in value && "after" in value;
}

/** The problem of a field entry, or `undefined` for a good entry. */
function fieldProblem(value: Fields): string | undefined {
  if (!Array.isArray(value.changes) || !value.changes.every(isChange)) {
    return "The entry has no valid list of changes";
  }

  return undefined;
}

/** The problem of an `attachment.add` entry, or `undefined` for a good entry. */
function addProblem(value: Fields): string | undefined {
  const attachment = isObject(value.attachment) ? value.attachment : {};

  if (!isText(attachment.id) || !isText(attachment.name)) {
    return "The entry has no valid attachment record";
  }

  return SHA256.test(String(value.sha256)) ? undefined : "The entry has no valid sha256";
}

/** The problem of an `attachment.remove` entry, or `undefined` for a good entry. */
function removeProblem(value: Fields): string | undefined {
  return isText(value.id) ? undefined : "The entry has no attachment id";
}

/** The problem of the body of the entry, by its type. */
function bodyProblem(value: Fields): string | undefined {
  if (value.type === undefined) {
    return fieldProblem(value);
  }

  if (value.type === "attachment.add") {
    return addProblem(value);
  }

  if (value.type === "attachment.remove") {
    return removeProblem(value);
  }

  return `Unknown entry type: ${String(value.type).slice(0, 50)}`;
}

/** Checks the shape of one entry. The services check the values when the apply writes them. */
export function checkEntry(value: unknown): CheckedEntry {
  if (!isObject(value) || entrySeq(value) === 0) {
    return { problem: "The entry has no valid seq" };
  }

  if (!entryStoryId(value)) {
    return { problem: "The entry has no Story ID" };
  }

  // An entry of an older build has no `storyUid`.
  if (value.storyUid !== undefined && typeof value.storyUid !== "string") {
    return { problem: "The entry has an invalid Story uid" };
  }

  const problem = bodyProblem(value);

  return problem ? { problem } : { entry: value as unknown as OutboxEntry };
}
