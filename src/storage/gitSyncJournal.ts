import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { DataIntegrityError } from '../core';
import type { DataRoot } from '../schemas';
import { gitText } from './gitProcess';
import { assertGitWorker, type GitRepository, repositoryFor, repositoryPath, withGitWorker } from './gitRepository';
import { entryExists, errorCode, io } from './io';
import { acquireLock, type LockHandle } from './lock';
import { writeFileAtomic } from './system';
import { prepareTransaction, recoverTransactions, type Transaction, type TransactionManifest } from './transaction';

const Blob = z.strictObject({ data: z.string(), mode: z.enum(['100644', '100755']) });
export type PublicationFile = z.infer<typeof Blob>;
const Edit = z.strictObject({ path: z.string(), before: Blob.nullable(), after: Blob.nullable() });
export type PublicationEdit = z.infer<typeof Edit>;
const Oid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const Journal = z.strictObject({
  version: z.literal(1),
  token: z.string().regex(/^[a-f0-9]{32}$/),
  repo: z.strictObject({
    top: z.string(),
    gitDir: z.string(),
    common: z.string(),
    worker: z.string(),
    gate: z.string(),
    journal: z.string(),
    index: z.string(),
  }),
  branch: z.string().regex(/^refs\/heads\//),
  old: Oid,
  candidate: Oid,
  indexBefore: z.string().nullable(),
  indexAfter: z.string(),
  edits: z.array(Edit),
  roots: z.array(
    z.strictObject({
      path: z.string(),
      transaction: z.string().regex(/^\d{8}T\d{9}Z-[a-f0-9]{8}$/),
      manifest: z.unknown(),
    }),
  ),
  phase: z.enum(['prepared', 'ref', 'files', 'index', 'complete']),
});
type JournalData = z.infer<typeof Journal>;
export interface PublicationPlan {
  branch: string;
  old: string;
  candidate: string;
  indexBefore: string | null;
  indexAfter: string;
  edits: PublicationEdit[];
  roots: string[];
}
export interface PublicationOptions {
  checkpoint?(name: string): void | Promise<void>;
}
export interface PublicationHold {
  repo: GitRepository;
  gate: LockHandle;
}

/** Byte-exact local file preconditions. Refuse links/topology rather than dereferencing them. */
export async function readPublicationFile(repo: GitRepository, path: string): Promise<PublicationFile | null> {
  const full = repositoryPath(repo, path);
  for (let parent = dirname(full); parent !== repo.top; parent = dirname(parent)) {
    const info = await io.lstat(parent).catch((err: unknown) => {
      if (errorCode(err) === 'ENOENT') return undefined;
      throw err;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`Unsafe publication parent at ${path}`);
  }
  try {
    const info = await io.lstat(full);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Unsafe publication topology at ${path}`);
    return { data: (await io.readBytes(full)).toString('base64'), mode: info.mode & 0o111 ? '100755' : '100644' };
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    throw err;
  }
}
export async function readIndex(repo: GitRepository): Promise<string | null> {
  try {
    return (await io.readBytes(repo.index)).toString('base64');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    throw err;
  }
}
async function readJournal(repo: GitRepository): Promise<JournalData | null> {
  if (!(await entryExists(repo.journal))) return null;
  try {
    const value = Journal.parse(JSON.parse(await io.readFile(repo.journal)));
    if (value.repo.common !== repo.common || value.repo.index !== join(value.repo.gitDir, 'index'))
      throw new Error('Journal location mismatch');
    for (const edit of value.edits) repositoryPath(value.repo, edit.path);
    validateRoots(
      value.repo,
      value.roots.map((r) => r.path),
    );
    return value;
  } catch (cause) {
    throw new DataIntegrityError('Git publication journal cannot be read', { details: { path: repo.journal }, cause });
  }
}
async function writeJournal(journal: JournalData) {
  await writeFileAtomic(journal.repo.journal, JSON.stringify(journal));
}
function indexToken(token: string): string {
  return Buffer.from(`Rowbly publication ${token}\n`).toString('base64');
}
function ownerPath(repo: GitRepository): string {
  return join(repo.common, 'rowbly', 'index-reservation.json');
}
async function lockBytes(repo: GitRepository): Promise<string | null> {
  try {
    return (await io.readBytes(`${repo.index}.lock`)).toString('base64');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    throw err;
  }
}
async function cleanupReservation(repo: GitRepository) {
  if (!(await entryExists(ownerPath(repo)))) return;
  const owner = JSON.parse(await io.readFile(ownerPath(repo))) as {
    pid: number;
    host: string;
    token: string;
    repo: GitRepository;
  };
  if (!owner.repo || owner.repo.common !== repo.common) throw new Error('Invalid index reservation location');
  repo = owner.repo;
  // A common worker is held, but a different live process's reservation still belongs to it.
  let alive = owner.host !== hostname();
  if (!alive && owner.pid !== process.pid) {
    try {
      process.kill(owner.pid, 0);
      alive = true;
    } catch (err) {
      alive = errorCode(err) !== 'ESRCH';
    }
  }
  if (alive) throw new Error('Git index reservation is owned by a live process');
  const bytes = await lockBytes(repo);
  if (bytes === indexToken(owner.token)) await io.rm(`${repo.index}.lock`);
  else if (bytes !== null) throw new Error('Git index lock changed outside Rowbly; preserving it');
  await gitText(repo.top, ['update-ref', '-d', `refs/rowbly/prepared/${owner.token}`]).catch(() => undefined);
  await io.rm(ownerPath(repo));
}

/** Gate admission recovers locally before a root lock/read, including while scheduling is Off. */
export async function enterPublication(root: DataRoot): Promise<PublicationHold | null> {
  const repo = await repositoryFor(root);
  if (!repo) return null;
  await io.mkdir(repo.gate);
  let gate = await acquireLock(repo.gate, { operation: 'git.publication', subject: 'Git publication' });
  if (!(await entryExists(repo.journal)) && !(await entryExists(ownerPath(repo)))) return { repo, gate };
  await gate.release(); // Never wait for worker while holding the gate.
  return withGitWorker(repo, async () => {
    gate = await acquireLock(repo.gate, { operation: 'git.recover', subject: 'Git publication' });
    try {
      await recoverPublication({ repo, gate });
      return { repo, gate };
    } catch (err) {
      await gate.release();
      throw err;
    }
  });
}
export async function withPublication<T>(repo: GitRepository, fn: (hold: PublicationHold) => Promise<T>): Promise<T> {
  await io.mkdir(repo.gate);
  const gate = await acquireLock(repo.gate, { operation: 'git.publish', subject: 'Git publication' });
  try {
    const hold = { repo, gate };
    await recoverPublication(hold);
    return await fn(hold);
  } finally {
    await gate.release();
  }
}
function assertHold(hold: PublicationHold) {
  if (hold.gate.released || hold.gate.root !== hold.repo.gate)
    throw new Error('Publication requires its live gate handle');
}
async function rootLocks<T>(roots: string[], fn: () => Promise<T>, recover = true): Promise<T> {
  const locks: LockHandle[] = [];
  try {
    for (const root of [...new Set(roots)].sort()) {
      const lock = await acquireLock(root, { operation: 'git.publication' });
      locks.push(lock);
      if (recover) await recoverTransactions(root);
    }
    return await fn();
  } finally {
    for (const lock of locks.reverse()) await lock.release();
  }
}
async function verifyFiles(journal: Pick<JournalData, 'repo' | 'edits'>, allowAfter: boolean) {
  for (const edit of journal.edits) {
    const actual = await readPublicationFile(journal.repo, edit.path);
    if (!isDeepStrictEqual(actual, edit.before) && !(allowAfter && isDeepStrictEqual(actual, edit.after)))
      throw new Error(`Publication path changed outside captured snapshot: ${edit.path}`);
  }
}

/** All payloads and owned index reservation precede durable intent; no Git runs under root locks. */
export async function publishPublication(
  hold: PublicationHold,
  plan: PublicationPlan,
  options: PublicationOptions = {},
): Promise<void> {
  assertHold(hold);
  assertGitWorker(hold.repo);
  const repo = hold.repo;
  validateRoots(repo, plan.roots);
  if (await readJournal(repo)) throw new Error('An earlier publication still needs recovery');
  const token = randomBytes(16).toString('hex'),
    transactions: { path: string; tx: Transaction }[] = [];
  const journal: JournalData = { ...plan, roots: [], version: 1, token, repo, phase: 'prepared' };
  let reserved = false,
    prepared = false;
  try {
    if (
      (await gitText(repo.top, ['symbolic-ref', 'HEAD'])) !== plan.branch ||
      (await gitText(repo.top, ['rev-parse', plan.branch])) !== plan.old
    )
      throw new Error('Git branch changed before publication');
    if ((await readIndex(repo)) !== plan.indexBefore) throw new Error('Git index changed before publication');
    await rootLocks(plan.roots, async () => {
      await verifyFiles(journal, false);
      for (const root of [...new Set(plan.roots)].sort()) {
        const prefix = relative(repo.top, root).split('\\').join('/');
        const edits = plan.edits.filter((e) => !prefix || e.path.startsWith(`${prefix}/`));
        const tx = await prepareTransaction(root, {
          operation: 'git.synchronize',
          changes: edits.map((edit) => {
            const path = prefix ? edit.path.slice(prefix.length + 1) : edit.path;
            return edit.after
              ? {
                  kind: 'write' as const,
                  path,
                  text: Buffer.from(edit.after.data, 'base64'),
                  mode: edit.after.mode === '100755' ? 0o755 : 0o644,
                }
              : { kind: 'delete' as const, path, pruneTo: '' };
          }),
        });
        transactions.push({ path: root, tx });
        journal.roots.push({ path: root, transaction: tx.id, manifest: tx.manifest });
      }
    });
    await options.checkpoint?.('staged');
    await io.mkdir(dirname(ownerPath(repo)));
    await writeFileAtomic(ownerPath(repo), JSON.stringify({ token, pid: process.pid, host: hostname(), repo }));
    await io.writeFile(`${repo.index}.lock`, Buffer.from(indexToken(token), 'base64'));
    reserved = true;
    await io.syncDir(repo.gitDir);
    await gitText(repo.top, ['update-ref', `refs/rowbly/prepared/${token}`, plan.candidate]);
    if ((await readIndex(repo)) !== plan.indexBefore) throw new Error('Git index changed while reserving publication');
    await verifyFiles(journal, false);
    await options.checkpoint?.('before-intent');
    await writeJournal(journal);
    prepared = true;
    await options.checkpoint?.('prepared');
    if (!(await applyPublication(journal, options))) {
      prepared = false;
      throw new Error('Git ref changed; candidate publication was safely discarded');
    }
  } catch (cause) {
    prepared ||= await entryExists(repo.journal);
    if (prepared)
      throw new DataIntegrityError('Git local publication is prepared; recovery must finish before the next read', {
        details: { path: repo.journal },
        cause,
      });
    throw cause;
  } finally {
    if (!prepared) {
      for (const { tx } of transactions) await tx.discard();
      if (reserved && (await lockBytes(repo)) === indexToken(token)) await io.rm(`${repo.index}.lock`);
      await io.rm(ownerPath(repo));
      await gitText(repo.top, ['update-ref', '-d', `refs/rowbly/prepared/${token}`]).catch(() => undefined);
    }
  }
}

/** Local, repeatable roll-forward. Branch ancestry is deliberately not assumed (ADR-0034 §5). */
async function applyPublication(journal: JournalData, options: PublicationOptions): Promise<boolean> {
  const repo = journal.repo;
  const current = await gitText(repo.top, ['rev-parse', journal.branch]);
  if (current !== journal.old && current !== journal.candidate) {
    const untouched = await Promise.all(
      journal.edits.map(async (edit) => isDeepStrictEqual(await readPublicationFile(repo, edit.path), edit.before)),
    );
    if (
      journal.phase === 'prepared' &&
      untouched.every(Boolean) &&
      (await readIndex(repo)) === journal.indexBefore &&
      (await lockBytes(repo)) === indexToken(journal.token)
    ) {
      // CAS refused before any live effect: discard only our staged payload and reservation.
      for (const root of journal.roots) await io.rm(join(root.path, '.txn', root.transaction));
      await io.rm(`${repo.index}.lock`);
      await io.rm(ownerPath(repo));
      await gitText(repo.top, ['update-ref', '-d', `refs/rowbly/prepared/${journal.token}`, journal.candidate]);
      await io.rm(repo.journal);
      await io.syncDir(dirname(repo.journal));
      return false;
    }
    throw new Error('Prepared branch ref changed externally; preserving publication');
  }
  if ((await gitText(repo.top, ['symbolic-ref', 'HEAD'])) !== journal.branch)
    throw new Error('Prepared worktree branch changed externally');
  const index = await readIndex(repo);
  if (index !== journal.indexBefore && index !== journal.indexAfter)
    throw new Error('Prepared index changed externally; preserving publication');
  await verifyFiles(journal, true);
  const lock = await lockBytes(repo);
  if (lock !== null && lock !== indexToken(journal.token) && lock !== journal.indexAfter)
    throw new Error('Prepared index lock has an external holder');
  if (current === journal.old) await gitText(repo.top, ['update-ref', journal.branch, journal.candidate, journal.old]);
  await options.checkpoint?.('ref-effect');
  journal.phase = 'ref';
  await writeJournal(journal);
  await options.checkpoint?.('ref');
  await rootLocks(
    journal.roots.map((r) => r.path),
    async () => {
      for (const root of journal.roots) {
        const transactionDir = join(root.path, '.txn', root.transaction);
        // If the transaction already completed, all its paths already equal their after image.
        const prefix = relative(repo.top, root.path).split('\\').join('/');
        const edits = journal.edits.filter((e) => !prefix || e.path.startsWith(`${prefix}/`));
        const done = await Promise.all(
          edits.map(async (e) => isDeepStrictEqual(await readPublicationFile(repo, e.path), e.after)),
        );
        if (!done.every(Boolean)) {
          if (!(await entryExists(transactionDir))) throw new Error('Prepared Data Root payload is missing');
          await writeFileAtomic(
            join(transactionDir, 'manifest.json'),
            JSON.stringify(root.manifest as TransactionManifest),
          );
          await recoverTransactions(root.path, { onCheckpoint: (point) => options.checkpoint?.(`root:${point}`) });
        }
      }
    },
    false,
  );
  const inRoot = (path: string) =>
    journal.roots.some((r) => {
      const prefix = relative(repo.top, r.path).split('\\').join('/');
      return !prefix || path.startsWith(`${prefix}/`);
    });
  for (const [n, edit] of journal.edits.entries())
    if (!inRoot(edit.path)) {
      const path = repositoryPath(repo, edit.path);
      if (!isDeepStrictEqual(await readPublicationFile(repo, edit.path), edit.after)) {
        if (!edit.after) await io.rm(path);
        else {
          await io.mkdir(dirname(path));
          await writeFileAtomic(
            path,
            Buffer.from(edit.after.data, 'base64'),
            edit.after.mode === '100755' ? 0o755 : 0o644,
          );
        }
      }
      await options.checkpoint?.(`working:${n}`);
    }
  journal.phase = 'files';
  await writeJournal(journal);
  await options.checkpoint?.('files');
  if ((await readIndex(repo)) !== journal.indexAfter) {
    const bytes = await lockBytes(repo);
    if (bytes === null) await io.writeFile(`${repo.index}.lock`, Buffer.from(indexToken(journal.token), 'base64'));
    const staged = join(repo.gitDir, 'rowbly', `index-${journal.token}`);
    await writeFileAtomic(staged, Buffer.from(journal.indexAfter, 'base64'));
    await io.rename(staged, `${repo.index}.lock`);
    await options.checkpoint?.('index-ready');
    await io.rename(`${repo.index}.lock`, repo.index);
    await io.syncDir(repo.gitDir);
  }
  await options.checkpoint?.('index-effect');
  journal.phase = 'index';
  await writeJournal(journal);
  await verifyFiles(journal, true);
  for (const edit of journal.edits)
    if (!isDeepStrictEqual(await readPublicationFile(repo, edit.path), edit.after))
      throw new Error('Publication did not install its complete candidate');
  journal.phase = 'complete';
  await writeJournal(journal);
  await options.checkpoint?.('complete');
  const finalLock = await lockBytes(repo);
  if (finalLock === indexToken(journal.token) || finalLock === journal.indexAfter) await io.rm(`${repo.index}.lock`);
  await io.rm(ownerPath(repo));
  await gitText(repo.top, ['update-ref', '-d', `refs/rowbly/prepared/${journal.token}`]);
  await io.rm(repo.journal);
  await io.syncDir(dirname(repo.journal));
  return true;
}
export async function recoverPublication(hold: PublicationHold, options: PublicationOptions = {}): Promise<void> {
  assertHold(hold);
  const journal = await readJournal(hold.repo);
  if (journal) await applyPublication(journal, options);
  else await cleanupReservation(hold.repo);
}

function validateRoots(repo: GitRepository, roots: string[]) {
  for (const root of roots) {
    if (root !== repo.top) repositoryPath(repo, relative(repo.top, root).split('\\').join('/'));
  }
  if (roots.some((root, n) => roots.some((other, m) => m !== n && root.startsWith(`${other}/`))))
    throw new Error('Publication Data Roots overlap');
}
