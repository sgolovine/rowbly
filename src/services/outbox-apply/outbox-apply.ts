// The main machine applies the outbox entries of a worker host to the canonical Story files.

import { mapInOrder } from "../in-order/in-order.js";
import type { OutboxEntry } from "../outbox/outbox.js";
import { projectWrite } from "../project-write/project-write.js";
import { Store } from "../store/store.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { applyAttachmentAdd, applyAttachmentRemove } from "./apply-attachments.js";
import { applyFieldEntry } from "./apply-fields.js";
import {
  type AbandonedHold,
  type ApplyEnv,
  isTransportFailure,
  type OutboxConflict,
  rowblyProblem,
} from "./apply-state.js";
import { type HeldRef, holdEntry, holdingThread } from "./held-entries.js";
import { readAppliedSeq, writeAppliedSeq } from "./host-files.js";
import { checkEntry, entrySeq, entryStoryId } from "./outbox-shape.js";
import type { OutboxSource } from "./outbox-source.js";

export type { AbandonedHold, OutboxConflict } from "./apply-state.js";
export type { HeldRef } from "./held-entries.js";

/** The entries of one worker host, and the source of their attachment files. */
export interface ApplyOutboxInput {
  /** The ID of the worker host. */
  readonly host: string;
  /** The entries, from the source or from the live channel. The apply checks the shape of each one. */
  readonly entries: readonly unknown[];
  readonly source: Pick<OutboxSource, "blob">;
  /** The abandoned Threads of the host. Their entries after the `appliedSeq` of the note are held, not applied. */
  readonly abandoned?: readonly AbandonedHold[];
}

export interface ApplyOutboxResult {
  /** The last applied `seq` of the host. It is on the disk. */
  readonly appliedSeq: number;
  /** The `seq` of each entry that this apply examined. An entry that was applied before is not in the list. */
  readonly applied: readonly number[];
  readonly conflicts: readonly OutboxConflict[];
  /** The entries that this apply held for abandoned Threads. Absent when the apply held no entry. */
  readonly held?: readonly HeldRef[];
}

/** The result of one entry, or `undefined` for an entry that was applied before. */
interface EntryResult {
  readonly seq: number;
  readonly conflicts: readonly OutboxConflict[];
  /** The abandoned Thread that holds the entry. */
  readonly heldBy?: string;
}

/** Runs a call in the order of the caller, for example one lifecycle change at a time. */
export type RunInOrder = <T>(call: () => Promise<T>) => Promise<T>;

/** Applies an entry with a good shape, by its type. */
function applyChecked(env: ApplyEnv, entry: OutboxEntry): Promise<OutboxConflict[]> {
  if (!("type" in entry)) {
    return applyFieldEntry(env, entry);
  }

  return entry.type === "attachment.add" ? applyAttachmentAdd(env, entry) : applyAttachmentRemove(env, entry);
}

/** The conflict of a full entry, for example a bad shape. */
function entryConflict(env: ApplyEnv, value: unknown, reason: string): OutboxConflict[] {
  const storyId = entryStoryId(value);

  return [{ host: env.host, seq: entrySeq(value), ...(storyId ? { storyId } : {}), reason }];
}

/** Applies one entry and gives its conflicts. A connection failure stops the apply. */
export async function entryConflicts(env: ApplyEnv, value: unknown): Promise<OutboxConflict[]> {
  const checked = checkEntry(value);

  if (!checked.entry) {
    return entryConflict(env, value, checked.problem);
  }

  try {
    return await applyChecked(env, checked.entry);
  } catch (error) {
    if (isTransportFailure(error)) {
      throw error;
    }

    return entryConflict(env, value, rowblyProblem(error));
  }
}

/**
 * Applies one entry, then records its `seq` on the disk before the next entry. An entry with a `seq` equal to or
 * less than the last applied `seq` is skipped, so an entry that arrives two times has one effect.
 */
async function applyOne(
  env: ApplyEnv,
  applied: Store<{ seq: number }>,
  value: unknown,
): Promise<EntryResult | undefined> {
  const seq = entrySeq(value);

  if (seq !== 0 && seq <= applied.current.seq) {
    return undefined;
  }

  const result = await decideEntry(env, value);

  if (seq !== 0) {
    await writeAppliedSeq(env.paths, env.host, seq);
    applied.update(() => ({ seq }));
  }

  return { seq, ...result };
}

/** Holds an entry of an abandoned Thread, or applies each other entry. */
async function decideEntry(env: ApplyEnv, value: unknown): Promise<Omit<EntryResult, "seq">> {
  const held = holdingThread(env.abandoned, value);

  if (!held) {
    return { conflicts: await entryConflicts(env, value) };
  }

  await holdEntry(env, held);

  return { conflicts: [], heldBy: held.threadId };
}

/** Gives the held entries of the results. */
function heldRefs(done: readonly EntryResult[]): HeldRef[] {
  return done.flatMap((result) => (result.heldBy ? [{ threadId: result.heldBy, seq: result.seq }] : []));
}

/**
 * Applies the entries of one host in `seq` order. The caller holds the Project write lock. The services run without
 * a recorder, so they write the canonical files and record nothing.
 */
export async function applyOutboxEntries(
  input: ApplyOutboxInput,
  ctx: ServiceContext = {},
): Promise<ApplyOutboxResult> {
  const paths = await findProject(ctx);
  const env: ApplyEnv = {
    host: input.host,
    paths,
    ctx: { ...ctx, recorder: undefined },
    source: input.source,
    abandoned: input.abandoned,
  };
  const applied = new Store({ seq: await readAppliedSeq(paths, input.host) });

  const ordered = input.entries.toSorted((a, b) => entrySeq(a) - entrySeq(b));
  const results = await mapInOrder(ordered, (value) => applyOne(env, applied, value));
  const done = results.filter((result): result is EntryResult => result !== undefined);
  const held = heldRefs(done);

  return {
    appliedSeq: applied.current.seq,
    applied: done.map((result) => result.seq),
    conflicts: done.flatMap((result) => result.conflicts),
    ...(held.length > 0 ? { held } : {}),
  };
}

/** Applies the entries under the Project write lock. It does not take the state lock. */
export async function applyOutbox(
  input: ApplyOutboxInput,
  ctx: ServiceContext = {},
  inOrder: RunInOrder = (call) => call(),
): Promise<ApplyOutboxResult> {
  const { root } = await findProject(ctx);

  return inOrder(() => projectWrite(root, () => applyOutboxEntries(input, ctx)));
}

/** The worker host and the source of its entries. */
export interface SyncOutboxInput {
  readonly host: string;
  readonly source: OutboxSource;
  /** Runs the locked apply in the order of the caller, for example the lifecycle queue of the factory manager. */
  readonly inOrder?: RunInOrder;
  /** The abandoned Threads of the host, whose later entries the apply holds. */
  readonly abandoned?: readonly AbandonedHold[];
}

export interface SyncOutboxResult extends ApplyOutboxResult {
  /** The message of a failed acknowledgement. The next sync sends the acknowledgement again. */
  readonly acknowledgeProblem?: string;
}

/** Sends the acknowledgement of the applied `seq`. A failure gives its message, because the apply is complete. */
async function acknowledge(source: OutboxSource, seq: number): Promise<string | undefined> {
  if (seq === 0) {
    return undefined;
  }

  try {
    await source.acknowledge(seq);

    return undefined;
  } catch (error) {
    return rowblyProblem(error);
  }
}

/**
 * Gets the entries after the last applied `seq` of the host, applies them under the Project write lock, and then
 * sends the acknowledgement of the applied `seq`, which is on the disk. Gives the conflicts.
 */
export async function syncOutbox(input: SyncOutboxInput, ctx: ServiceContext = {}): Promise<SyncOutboxResult> {
  const paths = await findProject(ctx);
  const entries = await input.source.entriesAfter(await readAppliedSeq(paths, input.host));
  const result = await applyOutbox(
    { host: input.host, entries, source: input.source, abandoned: input.abandoned },
    ctx,
    input.inOrder,
  );

  // A crash before the acknowledgement is safe: the next sync skips the applied entries and sends it again.
  const acknowledgeProblem = await acknowledge(input.source, result.appliedSeq);

  return acknowledgeProblem ? { ...result, acknowledgeProblem } : result;
}
