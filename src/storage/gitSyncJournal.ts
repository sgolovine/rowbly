import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { DataIntegrityError } from '../core';
import type { DataRoot } from '../schemas';
import { gitProcess, gitText } from './gitProcess';
import { assertGitWorker, type GitRepository, repositoryFor, repositoryPath, withGitWorker } from './gitRepository';
import { describePaths, GitSyncFailure } from './gitSyncFailure';
import { type GitDataFiles, readGitDataFiles } from './gitSyncFiles';
import { entryExists, errorCode, io } from './io';
import { acquireLock, type LockHandle, type LockTiming } from './lock';
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
  captures?: { root: string; files: GitDataFiles }[];
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
/**
 * The staged content of an index image, one `mode object stage\tpath` line per entry, or `null`
 * when Git cannot read it. Two images with equal content differ only in caches, such as the stat
 * data `git status` refreshes (ADR-0058 §1).
 */
async function indexContent(repo: GitRepository, bytes: string): Promise<Set<string> | null> {
  const file = join(repo.gitDir, 'rowbly', `index-content-${randomBytes(8).toString('hex')}`);
  try {
    await io.writeFile(file, Buffer.from(bytes, 'base64'));
    const listed = await gitProcess(repo.top, ['ls-files', '--stage', '-z'], { index: file });
    return new Set(listed.stdout.toString('utf8').split('\0').filter(Boolean));
  } catch {
    return null;
  } finally {
    await io.rm(file);
  }
}

/**
 * The paths whose staged entries differ between two index images, or `null` when both stage the
 * same content. Equal bytes need no Git; an unreadable image differs, with no paths named.
 */
async function stagedDifference(
  repo: GitRepository,
  expected: string | null,
  actual: string | null,
): Promise<string[] | null> {
  if (expected === actual) return null;
  if (expected === null || actual === null) return [];
  const [before, after] = await Promise.all([indexContent(repo, expected), indexContent(repo, actual)]);
  if (!before || !after) return [];
  const changed = [...before, ...after].filter((line) => !(before.has(line) && after.has(line)));
  return changed.length ? [...new Set(changed.map((line) => line.slice(line.indexOf('\t') + 1)))] : null;
}
async function sameIndex(repo: GitRepository, expected: string | null, actual: string | null): Promise<boolean> {
  return (await stagedDifference(repo, expected, actual)) === null;
}

/** Which journal image the live index stages: equal bytes first, then equal content; `null` for neither. */
async function indexImage(journal: JournalData, actual: string | null): Promise<'before' | 'after' | null> {
  if (actual === journal.indexAfter) return 'after';
  if (actual === journal.indexBefore) return 'before';
  if (await sameIndex(journal.repo, journal.indexAfter, actual)) return 'after';
  if (await sameIndex(journal.repo, journal.indexBefore, actual)) return 'before';
  return null;
}

/** Fails with `index-changed`, naming the staged paths, unless `actual` stages what `expected` does. */
async function assertIndexContent(repo: GitRepository, expected: string | null, actual: string | null, when: string) {
  const paths = await stagedDifference(repo, expected, actual);
  if (paths === null) return;
  throw new GitSyncFailure(
    'index-changed',
    `Git index changed ${when}${paths.length ? `: staged ${describePaths(paths)}` : ''}`,
    paths,
  );
}

/** Reserves the index, waiting briefly while another Git command, such as `git status`, holds its lock. */
async function reserveLiveIndex(repo: GitRepository, token: string, options: PublicationOptions) {
  for (let waited = 0; ; waited += 50) {
    try {
      return await reserveIndex(repo, token, options);
    } catch (err) {
      if (errorCode(err) !== 'EEXIST') throw err;
      if (waited >= 2000)
        throw new GitSyncFailure('index-changed', `Another Git command kept the index locked: ${repo.index}.lock`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
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
function tokenPath(repo: GitRepository, token: string): string {
  return join(repo.gitDir, 'rowbly', `index-token-${token}`);
}
async function reserveIndex(repo: GitRepository, token: string, options: PublicationOptions = {}) {
  const payload = tokenPath(repo, token);
  if (!(await entryExists(payload))) await io.writeFile(payload, Buffer.from(indexToken(token), 'base64'));
  else if ((await io.readBytes(payload)).toString('base64') !== indexToken(token))
    throw new Error('Private index token is incomplete');
  await options.checkpoint?.('index-token-ready');
  await io.link(payload, `${repo.index}.lock`);
  await options.checkpoint?.('index-reserved');
}
function ownerPath(repo: GitRepository): string {
  return join(repo.common, 'rowbly', 'index-reservation.json');
}
function indexPayloadPath(repo: GitRepository, token: string): string {
  return join(repo.gitDir, 'rowbly', `index-${token}`);
}
function indexInstallPath(repo: GitRepository, token: string): string {
  return join(repo.gitDir, 'rowbly', `index-install-${token}`);
}

/** Private hardlinks retain ownership identity even after the live name has been renamed. */
async function ownedFile(path: string, reference: string, bytes: string): Promise<boolean> {
  try {
    const actual = await io.lstat(path);
    const owner = await io.lstat(reference);
    return (
      actual.isFile() &&
      owner.isFile() &&
      actual.dev === owner.dev &&
      actual.ino === owner.ino &&
      (await io.readBytes(reference)).toString('base64') === bytes
    );
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return false;
    throw err;
  }
}
/**
 * Who holds the index lock. Before the candidate index is installed, only Rowbly's reservation
 * may; once it is installed the reservation is released, and another Git command, such as
 * `git status`, may hold the lock. Git checks that the index it read is still current before it
 * writes, so that holder cannot revert the installed index; Rowbly leaves it alone (ADR-0058 §1).
 */
async function indexLockState(
  journal: JournalData,
  installed = false,
): Promise<'missing' | 'reservation' | 'payload' | 'foreign'> {
  const { repo, token, indexAfter } = journal;
  const lock = `${repo.index}.lock`;
  if (!(await entryExists(lock))) return 'missing';
  if (await ownedFile(lock, tokenPath(repo, token), indexToken(token))) return 'reservation';
  if (await ownedFile(lock, indexPayloadPath(repo, token), indexAfter)) return 'payload';
  if (installed) return 'foreign';
  throw new Error(`Prepared index lock has an external holder: ${lock}`);
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
  if (await ownedFile(`${repo.index}.lock`, tokenPath(repo, owner.token), indexToken(owner.token)))
    await io.rm(`${repo.index}.lock`);
  else if (await entryExists(`${repo.index}.lock`))
    throw new Error(`Git index lock changed outside Rowbly; preserving it: ${repo.index}.lock`);
  await io.rm(tokenPath(repo, owner.token));
  await gitText(repo.top, ['update-ref', '-d', `refs/rowbly/prepared/${owner.token}`]).catch(() => undefined);
  await io.rm(ownerPath(repo));
}

/**
 * Gate admission recovers locally before a root lock/read, including while scheduling is Off.
 * `timing`, for the trace, learns how long the gate's own acquisition waited and for whom.
 */
export async function enterPublication(root: DataRoot, timing?: LockTiming): Promise<PublicationHold | null> {
  const repo = await repositoryFor(root);
  if (!repo) return null;
  await io.mkdir(repo.gate);
  let gate = await acquireLock(repo.gate, { operation: 'git.publication', subject: 'Git publication', timing });
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
async function verifyFile(repo: GitRepository, edit: PublicationEdit, allowAfter: boolean) {
  const actual = await readPublicationFile(repo, edit.path);
  if (!isDeepStrictEqual(actual, edit.before) && !(allowAfter && isDeepStrictEqual(actual, edit.after)))
    throw new Error(`Publication path changed outside captured snapshot: ${edit.path}`);
}
async function verifyFiles(journal: Pick<JournalData, 'repo' | 'edits'>, allowAfter: boolean) {
  for (const edit of journal.edits) await verifyFile(journal.repo, edit, allowAfter);
}
function recoveryFailure(repo: GitRepository, cause: unknown, journal?: JournalData): DataIntegrityError {
  return new DataIntegrityError('Git local publication needs recovery before the next read or change', {
    details: {
      ...(cause instanceof DataIntegrityError ? cause.details : {}),
      path: repo.journal,
      paths: journal?.edits.map((edit) => edit.path) ?? [],
      indexLock: `${repo.index}.lock`,
      cause:
        cause instanceof DataIntegrityError
          ? (cause.details.cause ?? cause.message)
          : cause instanceof Error
            ? cause.message
            : String(cause),
    },
    hint: 'preserve the journal and affected files; resolve the reported external change or I/O failure, then run `rowbly doctor`',
    cause,
  });
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
  const { captures, ...durable } = plan;
  const journal: JournalData = { ...durable, roots: [], version: 1, token, repo, phase: 'prepared' };
  let prepared = false;
  try {
    if (
      (await gitText(repo.top, ['symbolic-ref', 'HEAD'])) !== plan.branch ||
      (await gitText(repo.top, ['rev-parse', plan.branch])) !== plan.old
    )
      throw new Error('Git branch changed before publication');
    await assertIndexContent(repo, plan.indexBefore, await readIndex(repo), 'before publication');
    await rootLocks(plan.roots, async () => {
      await verifyFiles(journal, false);
      for (const capture of captures ?? []) {
        const now = await readGitDataFiles({ path: capture.root, kind: 'local' });
        const changed = [...new Set([...Object.keys(now), ...Object.keys(capture.files)])].filter(
          (path) => !isDeepStrictEqual(now[path], capture.files[path]),
        );
        if (changed.length)
          throw new GitSyncFailure(
            'capture-changed',
            `Rowbly data changed while Sync prepared it: another writer, such as the TUI, was saving ${describePaths(changed)}`,
            changed,
          );
      }
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
    await reserveLiveIndex(repo, token, options);
    await io.syncDir(repo.gitDir);
    await gitText(repo.top, ['update-ref', `refs/rowbly/prepared/${token}`, plan.candidate]);
    // Under the reservation no cooperating Git writes the index, so recovery may compare these
    // exact bytes; an earlier stat-only refresh changed caches, not content (ADR-0058 §1).
    const reserved = await readIndex(repo);
    await assertIndexContent(repo, plan.indexBefore, reserved, 'while reserving publication');
    journal.indexBefore = reserved;
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
    if (prepared) throw recoveryFailure(repo, cause, journal);
    throw cause;
  } finally {
    if (!prepared) {
      for (const { tx } of transactions) await tx.discard();
      if (await ownedFile(`${repo.index}.lock`, tokenPath(repo, token), indexToken(token)))
        await io.rm(`${repo.index}.lock`);
      await io.rm(tokenPath(repo, token));
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
      (await sameIndex(repo, journal.indexBefore, await readIndex(repo))) &&
      (await indexLockState(journal)) === 'reservation'
    ) {
      // CAS refused before any live effect: discard only our staged payload and reservation.
      await io.rm(`${repo.index}.lock`);
      for (const root of journal.roots) await io.rm(join(root.path, '.txn', root.transaction));
      await io.rm(tokenPath(repo, journal.token));
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
  // Once installed, the index is no longer reserved: other Git may refresh its caches, so recovery
  // compares staged content rather than bytes (ADR-0058 §1).
  const image = await indexImage(journal, await readIndex(repo));
  if (!image) throw new Error('Prepared index changed externally; preserving publication');
  await verifyFiles(journal, true);
  await indexLockState(journal, image === 'after');
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
        await verifyFiles({ repo, edits }, true);
        const done = await Promise.all(
          edits.map(async (e) => isDeepStrictEqual(await readPublicationFile(repo, e.path), e.after)),
        );
        if (!done.every(Boolean)) {
          if (!(await entryExists(transactionDir))) throw new Error('Prepared Data Root payload is missing');
          await writeFileAtomic(
            join(transactionDir, 'manifest.json'),
            JSON.stringify(root.manifest as TransactionManifest),
          );
          await recoverTransactions(root.path, {
            beforeStep: async (step) => {
              if (step.kind !== 'write' && step.kind !== 'delete')
                throw new Error('Unexpected publication transaction step');
              const path = prefix ? `${prefix}/${step.path}` : step.path;
              const edit = edits.find((edit) => edit.path === path);
              if (!edit) throw new Error(`Unexpected publication transaction path: ${path}`);
              await verifyFile(repo, edit, true);
            },
            onCheckpoint: (point) => options.checkpoint?.(`root:${point}`),
          });
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
        if (!edit.after) {
          await verifyFile(repo, edit, true);
          await io.rm(path);
        } else {
          await io.mkdir(dirname(path));
          await writeFileAtomic(
            path,
            Buffer.from(edit.after.data, 'base64'),
            edit.after.mode === '100755' ? 0o755 : 0o644,
            () => verifyFile(repo, edit, true),
          );
        }
      }
      await options.checkpoint?.(`working:${n}`);
    }
  journal.phase = 'files';
  await writeJournal(journal);
  await options.checkpoint?.('files');
  const beforeInstall = await indexImage(journal, await readIndex(repo));
  if (!beforeInstall) throw new Error(`Prepared index changed externally: ${repo.index}`);
  const installed = beforeInstall === 'after';
  const lockState = await indexLockState(journal, installed);
  if (!installed) {
    if (lockState === 'missing') await reserveLiveIndex(repo, journal.token, {});
    const payload = indexPayloadPath(repo, journal.token);
    if (!(await entryExists(payload))) await io.writeFile(payload, Buffer.from(journal.indexAfter, 'base64'));
    if (!(await ownedFile(payload, payload, journal.indexAfter)))
      throw new Error(`Prepared index payload changed: ${payload}`);
    const install = indexInstallPath(repo, journal.token);
    if (!(await entryExists(install))) await io.link(payload, install);
    if (!(await ownedFile(install, payload, journal.indexAfter)))
      throw new Error(`Prepared index install link changed: ${install}`);
    await io.syncDir(dirname(payload));
    // Replace only our reservation/payload; the private payload remains linked across installation.
    if ((await indexLockState(journal)) === 'missing') throw new Error('Prepared index reservation disappeared');
    await io.rename(install, `${repo.index}.lock`);
    await options.checkpoint?.('index-ready');
    if (!(await ownedFile(`${repo.index}.lock`, payload, journal.indexAfter)))
      throw new Error(`Prepared index lock changed externally: ${repo.index}.lock`);
    if (!(await sameIndex(repo, journal.indexBefore, await readIndex(repo))))
      throw new Error(`Prepared index changed externally: ${repo.index}`);
    await io.rename(`${repo.index}.lock`, repo.index);
    await io.syncDir(repo.gitDir);
  }
  await options.checkpoint?.('index-effect');
  journal.phase = 'index';
  await writeJournal(journal);
  await indexLockState(journal, true);
  if (!(await sameIndex(repo, journal.indexAfter, await readIndex(repo))))
    throw new Error(`Installed index changed externally: ${repo.index}`);
  await verifyFiles(journal, true);
  for (const edit of journal.edits)
    if (!isDeepStrictEqual(await readPublicationFile(repo, edit.path), edit.after))
      throw new Error('Publication did not install its complete candidate');
  journal.phase = 'complete';
  await writeJournal(journal);
  await options.checkpoint?.('complete');
  const lock = await indexLockState(journal, true);
  if (lock === 'reservation' || lock === 'payload') await io.rm(`${repo.index}.lock`);
  await io.rm(tokenPath(repo, journal.token));
  await io.rm(indexInstallPath(repo, journal.token));
  await io.rm(indexPayloadPath(repo, journal.token));
  await io.rm(ownerPath(repo));
  await gitText(repo.top, ['update-ref', '-d', `refs/rowbly/prepared/${journal.token}`]);
  await io.rm(repo.journal);
  await io.syncDir(dirname(repo.journal));
  return true;
}
export async function recoverPublication(hold: PublicationHold, options: PublicationOptions = {}): Promise<void> {
  assertHold(hold);
  let journal: JournalData | null = null;
  try {
    journal = await readJournal(hold.repo);
    if (journal) await applyPublication(journal, options);
    else await cleanupReservation(hold.repo);
  } catch (cause) {
    throw recoveryFailure(journal?.repo ?? hold.repo, cause, journal ?? undefined);
  }
}

function validateRoots(repo: GitRepository, roots: string[]) {
  for (const root of roots) {
    if (root !== repo.top) repositoryPath(repo, relative(repo.top, root).split('\\').join('/'));
  }
  if (roots.some((root, n) => roots.some((other, m) => m !== n && root.startsWith(`${other}/`))))
    throw new Error('Publication Data Roots overlap');
}
