// Coordination of one Data Root (ADR-0019 §1, §5): every service call holds the Data Root lock, and
// every acquisition first finishes or removes interrupted commits. An operation holds the lock from
// before its first read through the save, and gives it up before its reactions.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DataRoot } from '../schemas';
import {
  acquireLock,
  canonicalDataRoot,
  type LockHandle,
  type RecoveryReport,
  type Repositories,
  recoverTransactions,
} from '../storage';
import { enterPublication } from '../storage/gitSyncJournal';
import type { OperationCoordinator } from './plugins/runtime';

/** The lock one coordinated call holds on one Data Root. */
interface Hold {
  /** The lock, while it is held. An operation gives it up for its reactions. */
  lock: LockHandle | undefined;
  /** False once the call that made the hold has returned. */
  open: boolean;
  operation: string;
}

/** The holds of the running code, per canonical Data Root. A continuation keeps them. */
const holds = new AsyncLocalStorage<ReadonlyMap<string, Hold>>();

/** Reactions and queued effects own their reads; they cannot extend the saving caller's hold. */
export function outsideCoordination<T>(fn: () => Promise<T>): Promise<T> {
  return holds.run(new Map(), fn);
}

/** Canonical paths, so that aliases of one Data Root share one hold (as they share one lock). */
const canonicalPaths = new Map<string, Promise<string>>();

function canonical(root: DataRoot): Promise<string> {
  let found = canonicalPaths.get(root.path);
  if (!found) {
    found = canonicalDataRoot(root.path);
    canonicalPaths.set(root.path, found);
    found.catch(() => canonicalPaths.delete(root.path));
  }
  return found;
}

/** Takes the lock, then recovers interrupted commits before anything is read (ADR-0019 §2). */
async function lockAndRecover(path: string, operation: string, recover = true): Promise<LockHandle> {
  const publication = await enterPublication({ path, kind: 'local' });
  let lock: LockHandle;
  try {
    lock = await acquireLock(path, { operation });
  } catch (error) {
    await publication?.gate.release();
    throw error;
  }
  try {
    if (recover) await recoverTransactions(path);
  } catch (err) {
    await lock.release();
    await publication?.gate.release();
    throw err;
  }
  if (!publication) return lock;
  const release = async () => {
    try {
      return await lock.release();
    } finally {
      await publication.gate.release();
    }
  };
  return {
    root: lock.root,
    path: lock.path,
    token: lock.token,
    owning: lock.owning,
    get released() {
      return lock.released;
    },
    release,
    async [Symbol.asyncDispose]() {
      await release();
    },
  };
}

async function currentHold(root: DataRoot): Promise<{ path: string; hold: Hold | undefined }> {
  const path = await canonical(root);
  const hold = holds.getStore()?.get(path);
  return { path, hold: hold?.open ? hold : undefined };
}

/** Makes sure `hold` has the lock again, after an operation gave it up for its reactions. */
async function retake(path: string, hold: Hold): Promise<void> {
  if (!hold.lock || hold.lock.released) hold.lock = await lockAndRecover(path, hold.operation);
}

/**
 * Runs `fn` as one participating read or change of the Data Root: it holds the lock from the start
 * of `fn` until `fn` returns, and its reads see one committed state. Inside a call that already
 * holds the lock, `fn` reuses it, so nested service calls never wait for themselves.
 */
export async function coordinated<T>(root: DataRoot, operation: string, fn: () => Promise<T>): Promise<T> {
  const { path, hold } = await currentHold(root);
  if (hold?.lock && !hold.lock.released) return fn();
  // A reaction's service call runs after its operation gave the lock up: it takes its own.
  const mine: Hold = { lock: await lockAndRecover(path, operation), open: true, operation };
  const map = new Map(holds.getStore() ?? []);
  map.set(path, mine);
  try {
    return await holds.run(map, fn);
  } finally {
    mine.open = false;
    await mine.lock?.release();
  }
}

/**
 * Runs `fn` as one mutation (ADR-0019 §1): it holds the lock from before the first read it plans
 * from through the save, and gives the lock up when `fn` returns, so reactions run without it. Doctor
 * plans its fixes inside one of these (WP03).
 */
export async function withMutation<T>(root: DataRoot, operation: string, fn: () => Promise<T>): Promise<T> {
  const { path, hold } = await currentHold(root);
  if (!hold) return coordinated(root, operation, fn);
  await retake(path, hold);
  try {
    return await fn();
  } finally {
    await hold.lock?.release();
  }
}

/** What recovery did when `withRecovery` took the lock: its report, or why it failed. */
export interface RecoveryOutcome {
  report?: RecoveryReport;
  failure?: unknown;
}

/**
 * For doctor (ADR-0019 §2, "Recovery failure at acquisition"): like `withMutation`, but a recovery
 * that fails does not fail the acquisition. `fn` runs with the lock held and learns what recovery
 * did, so it can report a transaction that cannot be finished instead of failing.
 */
export async function withRecovery<T>(
  root: DataRoot,
  operation: string,
  fn: (recovery: RecoveryOutcome) => Promise<T>,
): Promise<T> {
  const { path, hold } = await currentHold(root);
  const recover = async (): Promise<RecoveryOutcome> => {
    try {
      return { report: await recoverTransactions(path) };
    } catch (failure) {
      return { failure };
    }
  };
  if (hold) {
    // Inside a call that holds the lock, recovery already ran when it was taken.
    if (hold.lock && !hold.lock.released) return fn({});
    // An operation of this call gave the lock up: take it again, for as long as the call lasts.
    hold.lock = await lockAndRecover(path, operation, false);
    return fn(await recover());
  }
  const mine: Hold = { lock: await lockAndRecover(path, operation, false), open: true, operation };
  const map = new Map(holds.getStore() ?? []);
  map.set(path, mine);
  try {
    const recovery = await recover();
    return await holds.run(map, () => fn(recovery));
  } finally {
    mine.open = false;
    await mine.lock?.release();
  }
}

/**
 * Repositories whose every call reads under the lock: inside a coordinated call it is held already
 * (taken again if an operation gave it up for its reactions); outside one, each call is its own read.
 */
export function coordinatedRepositories(root: DataRoot, repos: Repositories): Repositories {
  const wrap = <R extends object>(repository: R): R => {
    const out: Record<string, unknown> = {};
    for (const [name, method] of Object.entries(repository)) {
      out[name] =
        typeof method === 'function'
          ? async (...args: unknown[]) => {
              const { path, hold } = await currentHold(root);
              if (!hold) return coordinated(root, `read ${name}`, () => method.apply(repository, args));
              await retake(path, hold);
              return method.apply(repository, args);
            }
          : method;
    }
    return out as R;
  };
  return {
    rootConfig: wrap(repos.rootConfig),
    localState: wrap(repos.localState),
    boards: wrap(repos.boards),
    stories: wrap(repos.stories),
  };
}

/** `service` with every method but the synchronous `except` ones run as one coordinated call. */
export function coordinatedServices<S extends object>(
  root: DataRoot,
  area: string,
  service: S,
  except: readonly string[] = [],
): S {
  const out: Record<string, unknown> = {};
  for (const [name, method] of Object.entries(service)) {
    out[name] =
      typeof method === 'function' && !except.includes(name)
        ? (...args: unknown[]) => coordinated(root, `${area}.${name}`, async () => method.apply(service, args))
        : method;
  }
  return out as S;
}

/** The runner's coordinator: each operation is one `withMutation` (ADR-0019 §1). */
export function mutationCoordinator(root: DataRoot): OperationCoordinator {
  return { hold: (operation, fn) => withMutation(root, operation.name, fn) };
}
