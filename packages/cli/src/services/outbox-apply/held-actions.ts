// The actions of `rowbly thread held`: list, apply and discard the held entries of an abandoned remote Thread. They
// do not need a running factory. The apply and the discard hold the Project write lock and never the state lock.

import { ValidationError } from "../errors/errors.js";
import { mapInOrder } from "../in-order/in-order.js";
import type { OutboxEntry } from "../outbox/outbox.js";
import { projectWrite } from "../project-write/project-write.js";
import { getThread, LOCAL_HOST, type ThreadRecord } from "../thread/thread.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import type { ApplyEnv, OutboxConflict } from "./apply-state.js";
import { readHeldBlob, readHeldEntries, removeHeld, writeHeldEntries } from "./held-entries.js";
import { entryConflicts } from "./outbox-apply.js";

/** One held entry, as the list shows it. */
export interface HeldEntryView {
  readonly seq: number;
  readonly storyId: string;
  readonly type: "fields" | "attachment.add" | "attachment.remove";
  /** The changed paths of a field entry. */
  readonly paths?: readonly string[];
  /** The attachment id of an attachment entry. */
  readonly attachmentId?: string;
}

export interface HeldList {
  readonly threadId: string;
  /** The worker host of the Thread, or `null` for a Thread of the main machine. */
  readonly host: string | null;
  readonly entries: readonly HeldEntryView[];
}

export interface HeldApplyResult {
  readonly threadId: string;
  readonly host: string | null;
  /** The `seq` of each entry that the apply applied and removed. */
  readonly applied: readonly number[];
  /** The conflicts. Each entry with a conflict stays held. */
  readonly conflicts: readonly OutboxConflict[];
}

export interface HeldDiscardResult {
  readonly threadId: string;
  readonly host: string | null;
  /** The number of held entries that the discard removed. */
  readonly discarded: number;
}

/** Gives the worker host of the Thread, or `undefined` for a Thread of the main machine. */
function remoteHost(thread: ThreadRecord): string | undefined {
  return thread.host && thread.host !== LOCAL_HOST ? thread.host : undefined;
}

/** Gives the view of one held entry. */
export function heldView(entry: OutboxEntry): HeldEntryView {
  const base = { seq: entry.seq, storyId: entry.storyId };

  if (!("type" in entry)) {
    return { ...base, type: "fields", paths: entry.changes.map((change) => change.path) };
  }

  return entry.type === "attachment.add"
    ? { ...base, type: entry.type, attachmentId: entry.attachment.id }
    : { ...base, type: entry.type, attachmentId: entry.id };
}

/** Lists the held entries of the Thread. A Thread without held entries gives an empty list. */
export async function listHeldEntries(input: { readonly id: string }, ctx: ServiceContext = {}): Promise<HeldList> {
  const paths = await findProject(ctx);
  const thread = await getThread(input.id, ctx);
  const host = remoteHost(thread);
  const entries = host ? await readHeldEntries(paths, host, thread.id) : [];

  return { threadId: thread.id, host: host ?? null, entries: entries.map(heldView) };
}

/** True when the Thread has at least one held entry. */
export async function hasHeldEntries(paths: ProjectPaths, thread: ThreadRecord): Promise<boolean> {
  const host = remoteHost(thread);

  return !!host && (await readHeldEntries(paths, host, thread.id)).length > 0;
}

/** Applies the held entries under the lock. The entries without a conflict leave the held folder. */
async function applyLocked(paths: ProjectPaths, host: string, threadId: string, ctx: ServiceContext) {
  const env: ApplyEnv = {
    host,
    paths,
    ctx: { ...ctx, recorder: undefined },
    source: { blob: (sha256) => readHeldBlob(paths, host, threadId, sha256) },
  };
  const entries = await readHeldEntries(paths, host, threadId);
  const results = await mapInOrder(entries, async (entry) => ({ entry, conflicts: await entryConflicts(env, entry) }));
  const kept = results.filter((result) => result.conflicts.length > 0);

  await writeHeldEntries(
    paths,
    host,
    threadId,
    kept.map((result) => result.entry),
  );

  return {
    applied: results.filter((result) => result.conflicts.length === 0).map((result) => result.entry.seq),
    conflicts: kept.flatMap((result) => result.conflicts),
  };
}

/**
 * Applies the held entries of the Thread with the compare-and-set of the outbox apply, under the Project write lock.
 * An entry with a conflict stays held. A second apply of the same entries has no new effect.
 */
export async function applyHeldEntries(
  input: { readonly id: string },
  ctx: ServiceContext = {},
): Promise<HeldApplyResult> {
  const paths = await findProject(ctx);
  const thread = await getThread(input.id, ctx);
  const host = remoteHost(thread);

  if (!host) {
    return { threadId: thread.id, host: null, applied: [], conflicts: [] };
  }

  const result = await projectWrite(paths.root, () => applyLocked(paths, host, thread.id, ctx));

  return { threadId: thread.id, host, ...result };
}

/** Deletes the held folder of the Thread under the Project write lock. The canonical files do not change. */
export async function discardHeldEntries(
  input: { readonly id: string },
  ctx: ServiceContext = {},
): Promise<HeldDiscardResult> {
  const paths = await findProject(ctx);
  const thread = await getThread(input.id, ctx);
  const host = remoteHost(thread);

  if (!host) {
    return { threadId: thread.id, host: null, discarded: 0 };
  }

  const discarded = await projectWrite(paths.root, async () => {
    const entries = await readHeldEntries(paths, host, thread.id);

    await removeHeld(paths, host, thread.id);

    return entries.length;
  });

  return { threadId: thread.id, host, discarded };
}

/** The input of `rowbly thread held`: list the entries, or apply or discard them. */
export interface HeldActionInput {
  readonly id: string;
  readonly apply?: boolean;
  readonly discard?: boolean;
}

export type HeldActionResult =
  | ({ readonly action: "list" } & HeldList)
  | ({ readonly action: "apply" } & HeldApplyResult)
  | ({ readonly action: "discard" } & HeldDiscardResult);

/** Lists, applies or discards the held entries of the Thread. `apply` and `discard` together give a ValidationError. */
export async function heldAction(input: HeldActionInput, ctx: ServiceContext = {}): Promise<HeldActionResult> {
  if (input.apply && input.discard) {
    throw new ValidationError("Use --apply or --discard, not both");
  }

  if (input.apply) {
    return { action: "apply", ...(await applyHeldEntries(input, ctx)) };
  }

  if (input.discard) {
    return { action: "discard", ...(await discardHeldEntries(input, ctx)) };
  }

  return { action: "list", ...(await listHeldEntries(input, ctx)) };
}
