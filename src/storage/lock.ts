// The Data Root lock of ADR-0019 §1: one exclusive lock file per canonical Data Root, shared by
// every Rowbly process. Nothing in services takes it yet; WP02C wires operations, reads and
// recovery onto it and keeps the held handle in the operation's execution scope.
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { ConflictError } from '../core';
import { errorCode, io } from './io';

export const LOCK_FILE = '.lock';
export const LOCK_BREAK_FILE = '.lock.break';
/** How long `acquireLock` waits by default. */
export const LOCK_TIMEOUT_MS = 10_000;
/** A lock older than this is stale, whoever holds it. */
export const LOCK_STALE_MS = 10 * 60_000;
/** A `.lock.break` older than this is stale. */
export const LOCK_BREAK_STALE_MS = 30_000;

/** The content of the lock file. */
export interface LockOwner {
  pid: number;
  host: string;
  startedAt: string;
  token: string;
  operation: string;
}

/** A held lock. Release it on every path: `withLock`, `try … finally`, or `await using`. */
export interface LockHandle {
  /** The canonical (realpath) Data Root. */
  readonly root: string;
  /** The lock file. */
  readonly path: string;
  readonly token: string;
  /** False for a handle that reuses one the caller already holds (`AcquireOptions.held`). */
  readonly owner: boolean;
  readonly released: boolean;
  /**
   * Removes the lock file if it is still this handle's. Returns false when it was not, because a
   * waiter broke it as stale; the caller may warn. Releasing twice does nothing.
   */
  release(): Promise<boolean>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface AcquireOptions {
  /** How long to wait for another holder; `LOCK_TIMEOUT_MS` by default. */
  timeoutMs?: number;
  /** The operation that takes the lock, recorded in the lock file. */
  operation?: string;
  /**
   * A handle the caller already holds. If it is for the same Data Root and not released, it is
   * reused: the result is a non-owning handle whose release does nothing. Reentrancy is explicit:
   * the lock never recognizes its holder by itself (ADR-0019 §1, "Reentrancy").
   */
  held?: LockHandle;
}

/** Waiters in this process, per canonical Data Root, in FIFO order. */
const queues = new Map<string, Promise<void>>();

/**
 * Takes the Data Root lock. The root is canonicalized with realpath, so aliases share one lock.
 * Waiters in one process queue first; then the lock file is created exclusively, retrying with
 * backoff (25 ms doubling to 250 ms, with jitter) and breaking a stale lock. After `timeoutMs` it
 * throws `ConflictError` naming the holder.
 */
export async function acquireLock(root: string, options: AcquireOptions = {}): Promise<LockHandle> {
  const canonical = await io.realpath(root);
  if (options.held) return reuse(options.held, canonical);

  const deadline = Date.now() + (options.timeoutMs ?? LOCK_TIMEOUT_MS);
  const path = join(canonical, LOCK_FILE);
  const previous = queues.get(canonical) ?? Promise.resolve();
  let leave!: () => void;
  const mine = new Promise<void>((resolve) => {
    leave = resolve;
  });
  const tail = previous.then(() => mine);
  queues.set(canonical, tail);
  void tail.then(() => {
    if (queues.get(canonical) === tail) queues.delete(canonical);
  });

  const owner: LockOwner = {
    pid: process.pid,
    host: hostname(),
    startedAt: new Date().toISOString(),
    token: randomBytes(8).toString('hex'),
    operation: options.operation ?? 'unknown',
  };
  try {
    if (!(await settlesBefore(previous, deadline))) throw busy(path, (await readLock(path))?.owner);
    await createLock(canonical, owner, deadline);
  } catch (err) {
    leave();
    throw err;
  }

  let released = false;
  const handle: LockHandle = {
    root: canonical,
    path,
    token: owner.token,
    owner: true,
    get released() {
      return released;
    },
    async release() {
      if (released) return true;
      released = true;
      try {
        const current = await readLock(path);
        if (current?.owner?.token !== owner.token) return false;
        await io.unlink(path);
        return true;
      } finally {
        leave();
      }
    },
    async [Symbol.asyncDispose]() {
      await handle.release();
    },
  };
  return handle;
}

/** Runs `fn` while holding the lock, and releases it on every path. */
export async function withLock<T>(
  root: string,
  options: AcquireOptions,
  fn: (lock: LockHandle) => Promise<T>,
): Promise<T> {
  const lock = await acquireLock(root, options);
  try {
    return await fn(lock);
  } finally {
    await lock.release();
  }
}

function reuse(held: LockHandle, canonical: string): LockHandle {
  if (held.released || held.root !== canonical) {
    throw new Error(`cannot reuse a lock handle that is ${held.released ? 'released' : `for ${held.root}`}`);
  }
  let released = false;
  return {
    root: held.root,
    path: held.path,
    token: held.token,
    owner: false,
    get released() {
      return released || held.released;
    },
    async release() {
      released = true;
      return true;
    },
    async [Symbol.asyncDispose]() {
      released = true;
    },
  };
}

/** Creates the lock file, waiting for its holder or breaking it when stale, until `deadline`. */
async function createLock(canonical: string, owner: LockOwner, deadline: number): Promise<void> {
  const path = join(canonical, LOCK_FILE);
  let delay = 25;
  for (;;) {
    if (await createExclusive(path, owner)) return;
    const current = await readLock(path);
    if (!current) continue; // Released meanwhile: try again at once.
    if (isStale(current) && (await breakStale(canonical, current))) continue;
    const left = deadline - Date.now();
    if (left <= 0) throw busy(path, current.owner);
    await new Promise((resolve) => setTimeout(resolve, Math.min(left, delay * (0.5 + Math.random()))));
    delay = Math.min(delay * 2, 250);
  }
}

/**
 * Creates `path` holding `content` only if nothing is there. The content is written to a private
 * temporary file first and then hard-linked into place, so the lock file never exists half
 * written. Returns false when `path` already exists.
 */
async function createExclusive(path: string, content: object): Promise<boolean> {
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await io.writeFile(temp, `${JSON.stringify(content)}\n`);
  try {
    await io.link(temp, path);
    return true;
  } catch (err) {
    if (errorCode(err) === 'EEXIST') return false;
    throw err;
  } finally {
    await io.unlink(temp).catch(() => undefined);
  }
}

interface LockFile {
  /** The parsed content; `undefined` when unreadable. */
  owner: LockOwner | undefined;
  raw: string;
  mtimeMs: number;
}

/** The lock file as it is now, or `undefined` when there is none. */
async function readLock(path: string): Promise<LockFile | undefined> {
  try {
    const { mtimeMs } = await io.lstat(path);
    const raw = await io.readFile(path);
    return { owner: parseOwner(raw), raw, mtimeMs };
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return undefined;
    throw err;
  }
}

function parseOwner(raw: string): LockOwner | undefined {
  try {
    const value = JSON.parse(raw) as Partial<LockOwner>;
    if (typeof value.pid === 'number' && typeof value.host === 'string' && typeof value.token === 'string') {
      return { startedAt: '', operation: 'unknown', ...value } as LockOwner;
    }
  } catch {
    // Unreadable: judged by its age only.
  }
  return undefined;
}

/**
 * ADR-0019 §1: stale when its owner is a dead process on this host, or when it is older than
 * `LOCK_STALE_MS` (by `startedAt`, or by mtime when the content is unreadable).
 */
function isStale(lock: LockFile): boolean {
  const { owner } = lock;
  if (owner && owner.host === hostname() && !isAlive(owner.pid)) return true;
  const started = owner ? Date.parse(owner.startedAt) : Number.NaN;
  const since = Number.isNaN(started) ? lock.mtimeMs : started;
  return Date.now() - since > LOCK_STALE_MS;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errorCode(err) !== 'ESRCH';
  }
}

/**
 * Removes a stale lock under `.lock.break`, so that two waiters never both break it and then delete
 * a fresh one. Returns false when another waiter is breaking it.
 */
async function breakStale(canonical: string, stale: LockFile): Promise<boolean> {
  const breakPath = join(canonical, LOCK_BREAK_FILE);
  if (
    !(await createExclusive(breakPath, { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }))
  ) {
    const other = await readLock(breakPath);
    if (other && Date.now() - other.mtimeMs > LOCK_BREAK_STALE_MS) await io.unlink(breakPath).catch(() => undefined);
    return false;
  }
  try {
    const again = await readLock(join(canonical, LOCK_FILE));
    if (again && again.raw === stale.raw && again.mtimeMs === stale.mtimeMs) {
      await io.unlink(join(canonical, LOCK_FILE)).catch((err: unknown) => {
        if (errorCode(err) !== 'ENOENT') throw err;
      });
    }
    return true;
  } finally {
    await io.unlink(breakPath).catch(() => undefined);
  }
}

function busy(path: string, owner: LockOwner | undefined): ConflictError {
  const who = owner ? `pid ${owner.pid} on ${owner.host}, since ${owner.startedAt}` : 'unknown owner';
  return new ConflictError(`Data Root is busy: another Rowbly process (${who}) is saving`, {
    details: { lock: path, pid: owner?.pid, host: owner?.host, startedAt: owner?.startedAt },
    hint: `try again; if no Rowbly process is running, delete ${path}`,
  });
}

/** Resolves true when `promise` settles before `deadline`, false otherwise. */
async function settlesBefore(promise: Promise<void>, deadline: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
