// The recoverable multi-file commit of ADR-0019 §2: validate, stage, prepare (the commit point),
// apply, complete. Nothing in services uses it yet; WP02A commits Change Sets through it and WP02C
// runs `recoverTransactions` under the Data Root lock.
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { z } from 'zod';
import { ConflictError, DataIntegrityError, ValidationError } from '../core';
import { preflightMoves } from './files';
import { entryExists, errorCode, io } from './io';
import { writeFileAtomic } from './system';

/** The journal folder at the top of the canonical Data Root. */
export const TRANSACTIONS_DIR = '.txn';

/**
 * One change in a plan. Paths are absolute inside the Data Root, or relative to it with `/`.
 * `write` and `delete` paths name the **final** layout, after every `move`: a file in a Story that
 * moves is named at its new place.
 */
export type TransactionChange =
  /** Create or replace a file with `text`. Missing parent folders are created. */
  | { kind: 'write'; path: string; text: string | Uint8Array; mode?: number }
  /**
   * Delete a file or a whole folder. A missing path is nothing to do. After a file is deleted, its
   * empty parent folders are removed up to, but not including, `pruneTo`.
   */
  | { kind: 'delete'; path: string; pruneTo?: string }
  /** Move a folder (Story renumbering). Another move or a delete in the plan may free `to`. */
  | { kind: 'move'; from: string; to: string };

export interface TransactionPlan {
  /** The operation name, e.g. `stories.create`; it names the operation in errors and recovery. */
  operation: string;
  changes: readonly TransactionChange[];
}

/** A durable point in a commit or a recovery, reported to `onCheckpoint` (tests kill the process here). */
export type TransactionCheckpoint = 'staged' | 'prepared' | `applied:${number}` | 'complete';

export interface TransactionOptions {
  /** The operation clock; it stamps the manifest and orders transaction ids. */
  now?: () => Date;
  /** Publication precondition, checked immediately before a live write or delete. */
  beforeStep?: (step: TransactionStep) => void | Promise<void>;
  /** Called after each durable checkpoint. For tests. */
  onCheckpoint?: (checkpoint: TransactionCheckpoint) => void | Promise<void>;
}

/** ADR-0019 §2 manifest, version 1. */
export interface TransactionManifest {
  version: 1;
  id: string;
  operation: string;
  createdAt: string;
  pid: number;
  host: string;
  /** `prepared` is the commit point; `complete` means every step is done and only cleanup remains. */
  phase: 'prepared' | 'complete';
  /** In apply order: every `moveOut`, then every `delete`, then every `moveIn`, then every `write`. */
  steps: TransactionStep[];
}

/**
 * Paths starting with `staged/`, `moving/` or `trash/` are relative to the transaction folder; all
 * others to the canonical Data Root.
 */
export type TransactionStep =
  | { kind: 'moveOut'; from: string; temp: string }
  | { kind: 'delete'; path: string; entry: 'file' | 'folder'; trash: string; pruneTo?: string }
  | { kind: 'moveIn'; temp: string; to: string }
  | { kind: 'write'; path: string; staged: string; existed: boolean };

/** A staged, not yet committed transaction. Nothing live has changed until `commit()`. */
export interface Transaction {
  readonly id: string;
  /** The manifest that `commit()` writes. */
  readonly manifest: Readonly<TransactionManifest>;
  /**
   * Writes the manifest (the commit point), applies every step and completes. Before the commit
   * point a failure removes the staging and rethrows. After it, a failed step is retried once; if
   * that fails too, it throws `DataIntegrityError` with the pending paths.
   */
  commit(): Promise<CommitResult>;
  /** Removes the staged content. Only before `commit()`. */
  discard(): Promise<void>;
}

export interface CommitResult {
  id: string;
  /** The transaction folder could not be removed; the next recovery removes it. */
  leftover: boolean;
}

const STAGING_DIRS = ['staged', 'moving', 'trash'] as const;
const RESERVED = new Set<string>([TRANSACTIONS_DIR, '.lock', '.lock.break', ...STAGING_DIRS]);

/**
 * Validates a plan against the Data Root and stages it under `.txn/<id>/`. Every check runs before
 * anything is written: path containment, duplicate targets, the complete move set (RES-04), revived
 * folders and the single-filesystem rule. A failure while staging removes the transaction folder,
 * best effort, and rethrows.
 */
export async function prepareTransaction(
  root: string,
  plan: TransactionPlan,
  options: TransactionOptions = {},
): Promise<Transaction> {
  const canonical = await io.realpath(root);
  const now = options.now ?? (() => new Date());
  const id = transactionId(now());
  const { steps, writes } = await planSteps(root, canonical, plan);
  await checkOneFilesystem(canonical, steps);

  const txnDir = join(canonical, TRANSACTIONS_DIR, id);
  try {
    for (const name of STAGING_DIRS) await io.mkdir(join(txnDir, name));
    for (const [n, write] of writes.entries())
      await io.writeFile(join(txnDir, 'staged', String(n)), write.text, 'wx', write.mode);
  } catch (err) {
    await removeQuietly(txnDir);
    throw err;
  }
  await options.onCheckpoint?.('staged');

  const manifest: TransactionManifest = {
    version: 1,
    id,
    operation: plan.operation,
    createdAt: now().toISOString(),
    pid: process.pid,
    host: hostname(),
    phase: 'prepared',
    steps,
  };
  let state: 'staged' | 'committing' | 'discarded' = 'staged';
  return {
    id,
    manifest,
    async commit() {
      if (state !== 'staged') throw new Error(`transaction ${id} was already ${state}`);
      state = 'committing';
      return commitPrepared(canonical, txnDir, manifest, options);
    },
    async discard() {
      if (state !== 'staged') return;
      state = 'discarded';
      await removeQuietly(txnDir);
    },
  };
}

/** Turns plan changes into ordered manifest steps, checking everything that can be checked first. */
async function planSteps(
  root: string,
  canonical: string,
  plan: TransactionPlan,
): Promise<{ steps: TransactionStep[]; writes: { text: string | Uint8Array; mode?: number }[] }> {
  const writes: { path: string; text: string | Uint8Array; mode?: number }[] = [];
  const deletes: { path: string; pruneTo?: string }[] = [];
  const moves: { from: string; to: string }[] = [];
  const seen = new Map<string, string>();
  const claim = (path: string, kind: string) => {
    const other = seen.get(path);
    if (other) {
      throw new ConflictError(`${path} is both ${other} and ${kind} in one ${plan.operation}`, { details: { path } });
    }
    seen.set(path, kind);
  };

  for (const change of plan.changes) {
    if (change.kind === 'write') {
      const path = toRelative(root, canonical, change.path);
      claim(path, 'written');
      writes.push({ path, text: change.text, mode: change.mode });
    } else if (change.kind === 'delete') {
      const path = toRelative(root, canonical, change.path);
      const pruneTo = change.pruneTo === undefined ? undefined : toRelative(root, canonical, change.pruneTo, true);
      if (pruneTo !== undefined && !isWithin(path, pruneTo, false)) {
        throw new ValidationError(`${change.pruneTo} is not a folder above ${change.path}`, { details: { path } });
      }
      claim(path, 'deleted');
      deletes.push({ path, pruneTo });
    } else {
      const move = { from: toRelative(root, canonical, change.from), to: toRelative(root, canonical, change.to) };
      if (move.from === move.to) continue;
      moves.push(move);
    }
  }

  const abs = (path: string) => join(canonical, path);
  const deletedPaths = deletes.map((d) => d.path);
  for (const move of moves) {
    if (deletedPaths.includes(move.from)) {
      throw new ConflictError(`${move.from} is both moved and deleted in one ${plan.operation}`, {
        details: { path: move.from },
      });
    }
  }
  await preflightMoves(
    moves.map((m) => ({ from: abs(m.from), to: abs(m.to) })),
    deletedPaths.map(abs),
  );

  const vacatedBy = (path: string) =>
    moves.find((m) => isWithin(path, m.from, true))?.from ??
    deletedPaths.find((d) => d !== path && isWithin(path, d, true));

  for (const write of writes) {
    const gone = vacatedBy(write.path);
    if (gone !== undefined && !moves.some((m) => isWithin(write.path, m.to, false))) {
      throw new ConflictError(
        `cannot write ${write.path}: ${gone} is moved away or deleted in the same ${plan.operation}`,
        {
          details: { path: write.path },
        },
      );
    }
  }

  const steps: TransactionStep[] = moves.map((m, n) => ({ kind: 'moveOut', from: m.from, temp: `moving/${n}` }));
  for (const [n, del] of deletes.entries()) {
    const into = moves.findIndex((m) => isWithin(del.path, m.to, false));
    const move = moves[into];
    if (!move && moves.some((m) => isWithin(del.path, m.from, false))) {
      throw new ConflictError(`cannot delete ${del.path}: its folder is moved in the same ${plan.operation}`, {
        details: { path: del.path },
        hint: 'name the file at its new place',
      });
    }
    if (!move && deletedPaths.some((d) => isWithin(del.path, d, false))) continue; // Its folder goes anyway.
    // A file in a folder that moves is deleted in `moving/<n>`, before the folder arrives.
    const inFolder = (path: string) => (move ? `moving/${into}${path.slice(move.to.length)}` : path);
    const now = move ? join(canonical, move.from, del.path.slice(move.to.length)) : abs(del.path);
    const info = await io.lstat(now).catch((err: unknown) => {
      if (errorCode(err) === 'ENOENT') return undefined;
      throw err;
    });
    if (!info) continue;
    const pruneTo =
      del.pruneTo === undefined || (move && !isWithin(del.pruneTo, move.to, true)) ? undefined : inFolder(del.pruneTo);
    steps.push({
      kind: 'delete',
      path: inFolder(del.path),
      entry: info.isDirectory() ? 'folder' : 'file',
      trash: `trash/${n}`,
      ...(pruneTo === undefined ? {} : { pruneTo }),
    });
  }
  for (const [n, m] of moves.entries()) steps.push({ kind: 'moveIn', temp: `moving/${n}`, to: m.to });
  for (const [n, write] of writes.entries()) {
    steps.push({ kind: 'write', path: write.path, staged: `staged/${n}`, existed: await entryExists(abs(write.path)) });
  }
  return { steps, writes: writes.map(({ text, mode }) => ({ text, mode })) };
}

/** A plan path as a normalized `/`-separated path relative to the Data Root; rejects escapes. */
function toRelative(root: string, canonical: string, path: string, allowRoot = false): string {
  let rel = isAbsolute(path) ? relative(root, path) : normalize(path);
  if (isAbsolute(path) && (rel.startsWith('..') || isAbsolute(rel))) rel = relative(canonical, path);
  rel = rel.split(sep).join('/').replace(/\/+$/, '');
  if (rel === '.' || rel === '') {
    if (allowRoot) return '';
    throw new ValidationError(`${path} is the Data Root itself`, { details: { path } });
  }
  const first = rel.split('/')[0] as string;
  if (first === '..' || isAbsolute(rel)) {
    throw new ValidationError(`${path} lies outside the Data Root`, { details: { path } });
  }
  if (RESERVED.has(first)) throw new ValidationError(`${path} is reserved for Rowbly's journal`, { details: { path } });
  return rel;
}

/** Whether relative path `path` is inside `dir` (or is `dir`, with `orSame`). `''` is the root. */
function isWithin(path: string, dir: string, orSame: boolean): boolean {
  if (path === dir) return orSame;
  return dir === '' || path.startsWith(`${dir}/`);
}

/** ADR-0019 §3: every destination must be on the Data Root's filesystem, or renames fail with EXDEV. */
async function checkOneFilesystem(canonical: string, steps: readonly TransactionStep[]): Promise<void> {
  const device = (await io.stat(canonical)).dev;
  for (const step of steps) {
    const target = step.kind === 'write' ? step.path : step.kind === 'moveIn' ? step.to : undefined;
    if (target === undefined) continue;
    let dir = dirname(join(canonical, target));
    while (!(await entryExists(dir)) && dir.length > canonical.length) dir = dirname(dir);
    if ((await io.stat(dir)).dev !== device) {
      throw new ValidationError(`${target} is on another filesystem than the Data Root`, {
        details: { path: target },
        hint: 'keep the whole Data Root on one filesystem',
      });
    }
  }
}

/** `<UTC yyyymmddThhmmssSSSZ>-<8 hex>`, so ids sort by time. */
function transactionId(at: Date): string {
  return `${at.toISOString().replace(/[-:.]/g, '')}-${randomBytes(4).toString('hex')}`;
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await io.rm(path);
  } catch {
    // Best effort: recovery removes an unprepared folder later.
  }
}

export interface RecoveryReport {
  /** Prepared transactions that were rolled forward. */
  finished: { id: string; operation: string }[];
  /** Unprepared or complete transaction folders that were removed. */
  removed: string[];
  /** Folders that could not be removed; the next recovery tries again (doctor: `TRANSACTION_LEFTOVER`). */
  leftovers: { id: string; error: string }[];
}

const ID_RE = /^\d{8}T\d{9}Z-[0-9a-f]{8}$/;

const ManifestSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  operation: z.string(),
  createdAt: z.string(),
  pid: z.number(),
  host: z.string(),
  phase: z.enum(['prepared', 'complete']),
  steps: z.array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('moveOut'), from: z.string(), temp: z.string() }),
      z.object({
        kind: z.literal('delete'),
        path: z.string(),
        entry: z.enum(['file', 'folder']),
        trash: z.string(),
        pruneTo: z.string().optional(),
      }),
      z.object({ kind: z.literal('moveIn'), temp: z.string(), to: z.string() }),
      z.object({ kind: z.literal('write'), path: z.string(), staged: z.string(), existed: z.boolean() }),
    ]),
  ),
});

/**
 * Finishes or removes every transaction left in `.txn/`, in id order (ADR-0019 §2, "Recovery
 * policy"): a folder without a manifest was never prepared and is removed; a prepared one is rolled
 * forward and completed; a complete one is removed. Idempotent, and safe to interrupt and run
 * again. The caller holds the Data Root lock. A prepared transaction that cannot be finished throws
 * `DataIntegrityError` naming the operation and the pending paths.
 */
export async function recoverTransactions(root: string, options: TransactionOptions = {}): Promise<RecoveryReport> {
  const canonical = await io.realpath(root);
  const journal = join(canonical, TRANSACTIONS_DIR);
  const report: RecoveryReport = { finished: [], removed: [], leftovers: [] };
  let names: string[];
  try {
    names = await io.readdir(journal);
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return report;
    throw err;
  }
  for (const id of names.filter((name) => ID_RE.test(name)).sort()) {
    const txnDir = join(journal, id);
    const manifest = await readManifest(txnDir, id);
    if (manifest?.phase === 'prepared') {
      try {
        await rollForward(canonical, txnDir, manifest, options);
      } catch (err) {
        throw await partialSave(canonical, txnDir, manifest, err);
      }
      report.finished.push({ id, operation: manifest.operation });
      if (!(await finish(txnDir, manifest, options))) report.leftovers.push({ id, error: 'could not remove it' });
      continue;
    }
    try {
      await io.rm(txnDir);
      report.removed.push(id);
    } catch (err) {
      report.leftovers.push({ id, error: messageOf(err) });
    }
  }
  return report;
}

/** The manifest of a transaction folder, or `undefined` when it was never prepared. */
async function readManifest(txnDir: string, id: string): Promise<TransactionManifest | undefined> {
  const path = join(txnDir, MANIFEST);
  let text: string;
  try {
    text = await io.readFile(path);
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return undefined;
    throw err;
  }
  let parsed: ReturnType<typeof ManifestSchema.safeParse>;
  try {
    parsed = ManifestSchema.safeParse(JSON.parse(text));
  } catch (err) {
    throw unreadable(path, id, err);
  }
  if (!parsed.success || parsed.data.id !== id) throw unreadable(path, id, parsed.error);
  return parsed.data;
}

function unreadable(path: string, id: string, cause: unknown): DataIntegrityError {
  return new DataIntegrityError(`the journal of transaction ${id} cannot be read`, {
    details: { transaction: id, path },
    hint: 'run `rowbly doctor`',
    cause,
  });
}

/** After every `moveOut` and `delete` is done, before the first `moveIn`; see `runSteps`. */
const MOVED_OUT = 'moved-out';
const MANIFEST = 'manifest.json';

async function commitPrepared(
  canonical: string,
  txnDir: string,
  manifest: TransactionManifest,
  options: TransactionOptions,
): Promise<CommitResult> {
  try {
    await writeFileAtomic(join(txnDir, MANIFEST), serialize(manifest));
  } catch (err) {
    // Not prepared unless the rename landed; then the commit point has passed.
    let prepared: boolean;
    try {
      prepared = await entryExists(join(txnDir, MANIFEST));
    } catch {
      throw await partialSave(canonical, txnDir, manifest, err);
    }
    if (!prepared) {
      await removeQuietly(txnDir);
      throw err;
    }
  }
  try {
    await io.syncDir(dirname(txnDir));
    await options.onCheckpoint?.('prepared');
    await rollForward(canonical, txnDir, manifest, options);
  } catch {
    // Retry once, as recovery would, while the lock is still held.
    try {
      await rollForward(canonical, txnDir, manifest, { beforeStep: options.beforeStep });
    } catch (err) {
      throw await partialSave(canonical, txnDir, manifest, err);
    }
  }
  return { id: manifest.id, leftover: !(await finish(txnDir, manifest, options)) };
}

/** Runs every step that is not done yet, idempotently, then fsyncs the folders it touched. */
async function rollForward(
  canonical: string,
  txnDir: string,
  manifest: TransactionManifest,
  options: TransactionOptions,
): Promise<void> {
  const ctx = stepContext(canonical, txnDir);
  const touched = new Set<string>();
  // Once the marker exists every `moveOut` and `delete` is done. Without it, a swap would look
  // undone after its `moveIn`s: `from` exists again and `temp` is gone.
  let movedOut = await entryExists(join(txnDir, MOVED_OUT));
  for (const [n, step] of manifest.steps.entries()) {
    if (step.kind === 'moveIn' && !movedOut) {
      await io.writeFile(join(txnDir, MOVED_OUT), '', 'w');
      await io.syncDir(txnDir);
      movedOut = true;
    }
    if (movedOut && (step.kind === 'moveOut' || step.kind === 'delete')) continue;
    await applyStep(ctx, step, touched, options.beforeStep);
    await options.onCheckpoint?.(`applied:${n}`);
  }
  for (const dir of touched) await io.syncDir(dir);
}

interface StepContext {
  /** A manifest path as an absolute path. */
  at(path: string): string;
}

function stepContext(canonical: string, txnDir: string): StepContext {
  return {
    at: (path) => (/^(staged|moving|trash)(\/|$)/.test(path) ? join(txnDir, path) : join(canonical, path)),
  };
}

/** One step, done only if it is not done yet (ADR-0019 §2, "Recovery policy"). */
async function applyStep(
  ctx: StepContext,
  step: TransactionStep,
  touched: Set<string>,
  beforeStep?: TransactionOptions['beforeStep'],
): Promise<void> {
  switch (step.kind) {
    case 'moveOut': {
      const from = ctx.at(step.from);
      const temp = ctx.at(step.temp);
      if (await entryExists(temp)) return;
      if (!(await entryExists(from))) throw stepError(step, `${step.from} is missing`);
      await io.rename(from, temp);
      touched.add(dirname(from));
      return;
    }
    case 'delete': {
      const path = ctx.at(step.path);
      const trash = ctx.at(step.trash);
      if ((await entryExists(path)) && !(await entryExists(trash))) {
        await beforeStep?.(step);
        await io.rename(path, trash);
        if (!step.path.startsWith('moving/')) touched.add(dirname(path));
      }
      if (step.pruneTo !== undefined) await prune(path, ctx.at(step.pruneTo));
      return;
    }
    case 'moveIn': {
      const temp = ctx.at(step.temp);
      const to = ctx.at(step.to);
      if (!(await entryExists(temp))) {
        if (await entryExists(to)) return;
        throw stepError(step, `${step.to} and its staged folder are both missing`);
      }
      await io.mkdir(dirname(to));
      await io.rename(temp, to);
      touched.add(dirname(to));
      return;
    }
    case 'write': {
      const staged = ctx.at(step.staged);
      const path = ctx.at(step.path);
      if (!(await entryExists(staged))) return;
      await io.mkdir(dirname(path));
      await beforeStep?.(step);
      await io.rename(staged, path);
      touched.add(dirname(path));
      return;
    }
  }
}

/** Removes the empty folders above `path`, up to but not including `stopAt`. */
async function prune(path: string, stopAt: string): Promise<void> {
  for (let dir = dirname(path); dir !== stopAt && dir.startsWith(`${stopAt}${sep}`); dir = dirname(dir)) {
    try {
      await io.rmdir(dir);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'ENOTEMPTY' || code === 'EEXIST') return; // Not empty: keep it and everything above.
      if (code !== 'ENOENT') throw err; // Already gone (an earlier attempt): carry on upwards.
    }
  }
}

function stepError(step: TransactionStep, message: string): Error {
  return Object.assign(new Error(`cannot finish ${step.kind}: ${message}`), { step });
}

/** Marks the transaction complete and removes its folder. Returns whether the folder is gone. */
async function finish(txnDir: string, manifest: TransactionManifest, options: TransactionOptions): Promise<boolean> {
  try {
    await writeFileAtomic(join(txnDir, MANIFEST), serialize({ ...manifest, phase: 'complete' }));
    await options.onCheckpoint?.('complete');
  } catch {
    // Every step is done, so removing a still-prepared folder is safe too.
  }
  try {
    await io.rm(txnDir);
    await io.syncDir(dirname(txnDir));
    return true;
  } catch {
    return false;
  }
}

/** The error for a prepared transaction that could not be finished. It never says "nothing saved". */
async function partialSave(
  canonical: string,
  txnDir: string,
  manifest: TransactionManifest,
  cause: unknown,
): Promise<DataIntegrityError> {
  const pending = await pendingPaths(canonical, txnDir, manifest);
  return new DataIntegrityError(
    `${manifest.operation} was saved only in part; Rowbly finishes it before the next read or change`,
    {
      details: { transaction: manifest.id, operation: manifest.operation, pending, cause: messageOf(cause) },
      hint: 'fix the cause (for example file permissions), then run `rowbly doctor`',
      cause,
    },
  );
}

/** The Data Root paths of the steps that are not done yet. */
async function pendingPaths(canonical: string, txnDir: string, manifest: TransactionManifest): Promise<string[]> {
  const ctx = stepContext(canonical, txnDir);
  const movedOut = await entryExists(join(txnDir, MOVED_OUT)).catch(() => false);
  const pending: string[] = [];
  for (const step of manifest.steps) {
    const done = await stepDone(ctx, step, movedOut).catch(() => false);
    if (done) continue;
    if (step.kind === 'moveOut') pending.push(step.from);
    else if (step.kind === 'moveIn') pending.push(step.to);
    else if (!/^moving\//.test(step.path)) pending.push(step.path);
  }
  return pending;
}

async function stepDone(ctx: StepContext, step: TransactionStep, movedOut: boolean): Promise<boolean> {
  switch (step.kind) {
    case 'moveOut':
      return movedOut || entryExists(ctx.at(step.temp));
    case 'delete':
      return movedOut || !(await entryExists(ctx.at(step.path))) || entryExists(ctx.at(step.trash));
    case 'moveIn':
      return !(await entryExists(ctx.at(step.temp))) && entryExists(ctx.at(step.to));
    case 'write':
      return !(await entryExists(ctx.at(step.staged)));
  }
}

function serialize(manifest: TransactionManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
