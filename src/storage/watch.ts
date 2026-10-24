// Watches a Data Root for changes made outside this process: the CLI, another Rowbly or an editor.
import { existsSync, type FSWatcher, readdirSync, statSync, watch } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { DataRoot } from '../schemas';
import { TRANSACTIONS_DIR } from './transaction';

/** How long the watcher waits after the last event before it reports the burst. */
export const WATCH_DEBOUNCE_MS = 100;
/** How long the watcher waits before it starts again after it failed. */
export const WATCH_RETRY_MS = 2_000;

/**
 * Files that every read and write passes through and that change no record: the Data Root lock and
 * its temporary files (ADR-0019 §1) and the temporary file of an atomic write (ADR-0019 §3), which
 * is renamed over its destination. Every service call takes the lock, reads included, so a watcher
 * that reported the lock would make each reload report another change.
 */
const LOCK_FILES_RE = /^\.lock(\.break)?(\.[0-9a-f]{8}\.tmp)?$/;
const ATOMIC_TEMP_RE = /^\..+\.[0-9a-f]{8}\.tmp$/;

/** Whether a change at `relPath` (relative to the Data Root, `/`-separated) can change a record. */
export function isWatchedPath(relPath: string): boolean {
  const parts = relPath.split('/');
  const name = parts[parts.length - 1] ?? '';
  // The commit journal (ADR-0019 §2): its changes reach the records only when they are applied.
  if (parts[0] === TRANSACTIONS_DIR) return false;
  if (parts.length === 1 && LOCK_FILES_RE.test(name)) return false;
  return !ATOMIC_TEMP_RE.test(name);
}

export interface WatchDataRootOptions {
  /**
   * A burst of changes settled. `paths` are relative to the Data Root with `/`; `null` when the
   * platform did not name a changed file, so anything may have changed.
   */
  onChange(paths: readonly string[] | null): void;
  /**
   * The watcher failed. It starts again every `WATCH_RETRY_MS` until it is closed; a run of
   * failures is reported once.
   */
  onError(err: unknown): void;
  debounceMs?: number;
}

/**
 * Watches every file and folder under the Data Root, including folders created later, and reports
 * each burst of changes once. Call the returned function to stop; it is safe to call twice.
 *
 * It watches each folder rather than using `fs.watch`'s `recursive`, which on Linux watches each
 * file by its inode: an atomic write replaces the inode, so the next write to that file went unseen.
 * A folder's watch sees every file created, changed, renamed or deleted in it.
 */
export function watchDataRoot(root: DataRoot, opts: WatchDataRootOptions): () => void {
  const debounceMs = opts.debounceMs ?? WATCH_DEBOUNCE_MS;
  /** One watcher per folder, by absolute path. */
  const watchers = new Map<string, FSWatcher>();
  let closed = false;
  let pending: Set<string> | null = new Set();
  let timer: NodeJS.Timeout | undefined;
  let retry: NodeJS.Timeout | undefined;
  // Reported once per run of failures, so a Data Root that stays unwatchable does not repeat it.
  let failing = false;

  const flush = () => {
    timer = undefined;
    const paths = pending;
    pending = new Set();
    if (!closed) opts.onChange(paths ? [...paths].sort() : null);
  };

  const record = (relPath: string | null) => {
    if (relPath === null) pending = null;
    else pending?.add(relPath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
    timer.unref();
  };

  const closeAll = () => {
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };

  /** Stops watching `dir` and every folder under it, once it is gone. */
  const unwatch = (dir: string) => {
    for (const [path, watcher] of watchers) {
      if (path === dir || path.startsWith(dir + sep)) {
        watcher.close();
        watchers.delete(path);
      }
    }
  };

  const fail = (err: unknown) => {
    closeAll();
    if (closed) return;
    if (!failing) opts.onError(err);
    failing = true;
    retry = setTimeout(() => start(true), WATCH_RETRY_MS);
    retry.unref();
  };

  const onEvent = (dir: string, name: string | null) => {
    if (closed) return;
    if (name === null) return record(null);
    if (dir === root.path && !existsSync(root.path)) return fail(new Error(`${root.path} is gone`));
    const path = join(dir, name);
    const relPath = relative(root.path, path).split(sep).join('/');
    if (!isWatchedPath(relPath)) return;
    record(relPath);
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      // Deleted or renamed away.
    }
    if (isDir) watchTree(path);
    else unwatch(path);
  };

  /** Watches `dir` and the folders under it that are not watched yet; the commit journal is skipped. */
  function watchTree(dir: string) {
    if (closed || watchers.has(dir)) return;
    const relDir = relative(root.path, dir).split(sep).join('/');
    if (relDir !== '' && !isWatchedPath(relDir)) return;
    let watcher: FSWatcher;
    try {
      watcher = watch(dir, { persistent: false }, (_event, name) => onEvent(dir, name === null ? null : String(name)));
    } catch (err) {
      // A folder below the Data Root can go away while it is being watched; the Data Root cannot.
      if (dir === root.path) throw err;
      return;
    }
    watcher.on('error', (err) => (dir === root.path ? fail(err) : unwatch(dir)));
    watchers.set(dir, watcher);
    let folders: string[] = [];
    try {
      folders = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (err) {
      if (dir === root.path) throw err;
    }
    for (const name of folders) watchTree(join(dir, name));
  }

  /** After a failure, anything may have changed while nothing watched: report it once restarted. */
  function start(again: boolean) {
    retry = undefined;
    if (closed) return;
    try {
      watchTree(root.path);
      failing = false;
      if (again) record(null);
    } catch (err) {
      fail(err);
    }
  }

  start(false);
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    if (retry) clearTimeout(retry);
    closeAll();
  };
}
