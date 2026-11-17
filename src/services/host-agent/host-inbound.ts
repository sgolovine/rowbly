// The host side of the inbound updates: `rowbly host inbound` applies the updates of one Thread to its copy, in `seq`
// order, and records the last applied `seq`. The answer is the acknowledgement for the main machine.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateAttachmentId } from "../attachment-files/attachment-files.js";
import { ValidationError } from "../errors/errors.js";
import { withFileLock } from "../file-lock/file-lock.js";
import { writeFileAtomic } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { applyInboundUpdate } from "../inbound/inbound-apply.js";
import { INBOUND_TYPES, type InboundBody, type InboundUpdate } from "../inbound/inbound-types.js";
import { Store } from "../store/store.js";
import { type HostAgentPaths, threadPaths, validateStoryId, validateThreadId } from "./host-agent-paths.js";
import { readLaunchData, validateCopyPath } from "./host-agent-prepare.js";

/** The input of `host inbound`, from the main machine. */
export interface HostInboundInput {
  readonly threadId: string;
  readonly updates: readonly InboundUpdate[];
}

/** The answer of `host inbound`: the last applied `seq` of the Thread. */
export interface HostInboundResult {
  readonly threadId: string;
  readonly appliedSeq: number;
}

/** The file of the last applied `seq` in the folder of the Thread. */
const APPLIED_FILE = "inbound-applied.json";

type Fields = Record<string, unknown>;

function invalid(message: string, details: Fields = {}): ValidationError {
  return new ValidationError(message, { details });
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw invalid(`An inbound update needs a text ${name}`);
  }

  return value;
}

function validChanges(value: unknown): void {
  const valid =
    Array.isArray(value) &&
    value.every((change) => typeof change === "object" && change !== null && typeof change.path === "string");

  if (!valid) {
    throw invalid("A story.update needs a list of changes with a path");
  }
}

/** Checks the fields of the update for its type. Each path and id is checked before it becomes a file path. */
function checkBody(update: Fields): void {
  const type = update.type as InboundBody["type"];

  if (type.startsWith("story.") || type.startsWith("attachment.")) {
    validateStoryId(update.storyId);
  }

  if (type === "story.update") {
    validChanges(update.changes);
  }

  if (type === "story.create" || type === "file.put") {
    text(update.content, "content");
  }

  if (type === "story.create" || type === "file.put" || type === "file.delete") {
    validateCopyPath(update.path);
  }

  if (type === "attachment.add") {
    validateAttachmentId(text((update.attachment as Fields | undefined)?.id, "attachment id"));
  }

  if (type === "attachment.remove") {
    validateAttachmentId(text(update.id, "attachment id"));
  }
}

/** Checks one update: a positive `seq`, a known type and the fields of the type. */
function validUpdate(value: unknown): InboundUpdate {
  const update = (value ?? {}) as Fields;

  if (!Number.isSafeInteger(update.seq) || (update.seq as number) < 1) {
    throw invalid("Each inbound update needs a positive integer seq", { seq: update.seq });
  }

  if (!INBOUND_TYPES.includes(update.type as InboundBody["type"])) {
    throw invalid("Unknown inbound update type", { type: update.type });
  }

  checkBody(update);

  return update as unknown as InboundUpdate;
}

/** Checks the full input before the apply changes a file. */
export function parseInboundInput(value: unknown): HostInboundInput {
  const input = (value ?? {}) as Partial<HostInboundInput>;
  const threadId = validateThreadId(input.threadId);

  if (!Array.isArray(input.updates)) {
    throw invalid('The input must be { "threadId": "<id>", "updates": [...] }');
  }

  return { threadId, updates: input.updates.map(validUpdate) };
}

function appliedFile(paths: HostAgentPaths, threadId: string): string {
  return join(threadPaths(paths, threadId).dir, APPLIED_FILE);
}

/** Gives the last applied `seq` of the Thread. A missing or bad file gives 0. */
export async function readInboundApplied(paths: HostAgentPaths, threadId: string): Promise<number> {
  try {
    const seq = (JSON.parse(await readFile(appliedFile(paths, threadId), "utf8")) as { seq?: unknown }).seq;

    return typeof seq === "number" && Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return 0;
    }

    throw error;
  }
}

async function writeInboundApplied(paths: HostAgentPaths, threadId: string, seq: number): Promise<void> {
  await writeFileAtomic(appliedFile(paths, threadId), `${JSON.stringify({ seq })}\n`, { mode: 0o600, durable: true });
}

/** Applies one update after the last applied `seq`, then records its `seq` on the disk. */
async function applyOne(
  paths: HostAgentPaths,
  threadId: string,
  applied: Store<{ seq: number }>,
  update: InboundUpdate,
): Promise<void> {
  if (update.seq <= applied.current.seq) {
    return;
  }

  const target = { root: threadPaths(paths, threadId).copy, cache: paths.attachments };

  await applyInboundUpdate(target, update);
  await writeInboundApplied(paths, threadId, update.seq);
  applied.update(() => ({ seq: update.seq }));
}

/** Applies the updates in `seq` order. The caller holds the Thread write lock. */
async function applyLocked(paths: HostAgentPaths, input: HostInboundInput): Promise<number> {
  const applied = new Store({ seq: await readInboundApplied(paths, input.threadId) });
  const ordered = input.updates.toSorted((a, b) => a.seq - b.seq);

  await mapInOrder(ordered, (update) => applyOne(paths, input.threadId, applied, update));

  return applied.current.seq;
}

/**
 * Applies the inbound updates of one Thread to its copy, in `seq` order. An update with a `seq` equal to or less than
 * the last applied `seq` is skipped. It holds the `flock` file of the worker command prefix, so that a worker write
 * and an update do not run at the same time. A Thread that is not prepared gives a NotFoundError.
 */
export async function applyHostInbound(paths: HostAgentPaths, value: unknown): Promise<HostInboundResult> {
  const input = parseInboundInput(value);

  await readLaunchData(paths, input.threadId);

  const appliedSeq = await withFileLock(threadPaths(paths, input.threadId).lock, () => applyLocked(paths, input), {
    label: "Thread write lock",
  });

  return { threadId: input.threadId, appliedSeq };
}
