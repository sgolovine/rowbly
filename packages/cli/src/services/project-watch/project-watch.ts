import { type FSWatcher, watch } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Store, withEntry, withMember, withoutEntry, withoutMember } from "../store/store.js";

/** Gets the name of a changed entry relative to the watched path, or `null` when the event has no name. */
type WatchListener = (filename: string | null) => void;

/** One path to watch, and the names of its events that call the callback. */
export interface WatchRoute {
  readonly path: string;
  readonly recursive: boolean;
  readonly accept: (filename: string | null) => boolean;
}

/** One open watch of one path. All subscribers of the path share it. */
interface WatchEntry {
  readonly path: string;
  readonly recursive: boolean;
  // The watch is absent while the folder does not exist.
  readonly watcher: FSWatcher | undefined;
  readonly listeners: ReadonlySet<WatchListener>;
}

interface WatchRegistry {
  readonly entries: ReadonlyMap<string, WatchEntry>;
}

/**
 * One changed name: the path of the changed entry relative to the path of the first route, or `null` when the event
 * has no name. `null` means that any file can have changed.
 */
export type WatchChange = string | null;

/** Gets the changed names of one quiet time, in the order of their first event. A name is in the list one time. */
export type WatchCallback = (changes: readonly WatchChange[]) => void;

/** The timer of the quiet time, and the changed names that the timer collected. */
interface WatchTimer {
  readonly timer: NodeJS.Timeout | undefined;
  readonly changes: readonly WatchChange[];
}

/** A description of one shared watch, for tests and diagnostics. */
export interface OpenWatch {
  readonly path: string;
  readonly recursive: boolean;
  readonly subscribers: number;
}

/** One save writes more than one event, so the callback waits for this quiet time. */
const QUIET_MS = 100;

/** The registry is per process. The daemon and the TUI each have their own watches. */
const registry = new Store<WatchRegistry>({ entries: new Map() });

function entryOf(path: string): WatchEntry | undefined {
  return registry.current.entries.get(path);
}

function putEntry(entry: WatchEntry): void {
  registry.update((state) => ({ entries: withEntry(state.entries, entry.path, entry) }));
}

function closeWatcher(watcher: FSWatcher | undefined): void {
  watcher?.close();
}

/** Tells if this watch is the watch of the entry now, and not a watch that a reopen replaced. */
function isCurrent(path: string, watcher: FSWatcher): boolean {
  return entryOf(path)?.watcher === watcher;
}

/** Forgets a watch that failed, for example because its folder was removed. */
function onWatchError(path: string, watcher: FSWatcher): void {
  watcher.close();

  const entry = entryOf(path);

  if (entry === undefined || entry.watcher !== watcher) {
    return;
  }

  putEntry({ ...entry, watcher: undefined });
}

function notify(path: string, filename: string | null): void {
  const listeners = entryOf(path)?.listeners ?? new Set<WatchListener>();

  [...listeners].map((listener) => listener(filename));
}

/** Tells if this event of the folder can be the creation or the removal of a watched child folder. */
function isChildChange(entry: WatchEntry | undefined, event: string, filename: string | null): boolean {
  return entry !== undefined && !entry.recursive && event === "rename" && filename !== null;
}

function onWatchEvent(path: string, watcher: FSWatcher, event: string, file: string | Buffer | null): void {
  const filename = file?.toString() ?? null;

  if (!isCurrent(path, watcher)) {
    return;
  }

  notify(path, filename);

  if (isChildChange(entryOf(path), event, filename)) {
    reopen(join(path, filename ?? ""));
  }
}

/** Opens the watch of a path. Gives `undefined` when the folder does not exist. */
function openWatcher(path: string, recursive: boolean): FSWatcher | undefined {
  try {
    const watcher = watch(path, { persistent: false, recursive }, (event, file) =>
      onWatchEvent(path, watcher, event, file),
    );

    // The folder can go away while Rowbly runs. Without a listener, this error stops the process.
    watcher.on("error", () => onWatchError(path, watcher));

    return watcher;
  } catch {
    return undefined;
  }
}

/** Opens the watches of the child folders that do not have a watch, after their parent folder came back. */
function reopenChildren(path: string): void {
  const children = [...registry.current.entries.values()].filter(
    (entry) => entry.watcher === undefined && dirname(entry.path) === path,
  );

  children.map((entry) => reopen(entry.path));
}

/**
 * Opens the watch of a path again after its folder was created or removed. When the folder exists, the
 * subscribers get one event without a name, because the folder can have files that no watch saw.
 */
function reopen(path: string): void {
  const entry = entryOf(path);

  if (entry === undefined) {
    return;
  }

  closeWatcher(entry.watcher);

  const watcher = openWatcher(path, entry.recursive);

  putEntry({ ...entry, watcher });

  if (watcher === undefined) {
    return;
  }

  notify(path, null);
  reopenChildren(path);
}

function addListener(path: string, recursive: boolean, listener: WatchListener): void {
  const entry = entryOf(path);

  if (entry !== undefined) {
    putEntry({ ...entry, listeners: withMember(entry.listeners, listener) });

    return;
  }

  // The watch sends its events later, on the event loop, after the entry exists.
  putEntry({ path, recursive, watcher: openWatcher(path, recursive), listeners: new Set([listener]) });
}

function removeListener(path: string, listener: WatchListener): void {
  const entry = entryOf(path);

  if (entry === undefined) {
    return;
  }

  const listeners = withoutMember(entry.listeners, listener);

  if (listeners.size > 0) {
    putEntry({ ...entry, listeners });

    return;
  }

  closeWatcher(entry.watcher);
  registry.update((state) => ({ entries: withoutEntry(state.entries, path) }));
}

/** Gives the collected names to `onChange`, and clears them for the next quiet time. */
function flush(timer: Store<WatchTimer>, onChange: WatchCallback): void {
  const { changes } = timer.current;

  timer.update(() => ({ timer: undefined, changes: [] }));
  onChange(changes);
}

/** Adds `change` to the names of the quiet time. A name that the list has already does not go in again. */
function withChange(changes: readonly WatchChange[], change: WatchChange): readonly WatchChange[] {
  return changes.includes(change) ? changes : [...changes, change];
}

/** Starts the quiet time again, so that a burst of events gives one call with all of their names. */
function schedule(timer: Store<WatchTimer>, change: WatchChange, onChange: WatchCallback): void {
  clearTimeout(timer.current.timer);
  timer.update((state) => ({
    timer: setTimeout(() => flush(timer, onChange), QUIET_MS),
    changes: withChange(state.changes, change),
  }));
}

/** The name of an event of `route`, relative to `root`. An event with no name gives `null`. */
function changeOf(root: string, route: WatchRoute, filename: string | null): WatchChange {
  return filename === null ? null : relative(root, join(route.path, filename));
}

function routeListener(
  root: string,
  route: WatchRoute,
  timer: Store<WatchTimer>,
  onChange: WatchCallback,
): WatchListener {
  return (filename) =>
    route.accept(filename) ? schedule(timer, changeOf(root, route, filename), onChange) : undefined;
}

function stopRoutes(timer: Store<WatchTimer>, subscriptions: readonly (readonly [string, WatchListener])[]): void {
  clearTimeout(timer.current.timer);
  subscriptions.map(([path, listener]) => removeListener(path, listener));
}

/**
 * Watches each path of `routes` with the shared watch of that path. Calls `onChange` after the quiet time,
 * for the events that their routes accept, with the changed names of that quiet time. The names are relative to the
 * path of the first route. Give a parent folder before its child folders: the watch of a child
 * folder that does not exist starts when the watch of its parent sees its creation. Returns the function that
 * stops the watch. The watches do not keep the process alive.
 */
export function watchRoutes(routes: readonly WatchRoute[], onChange: WatchCallback): () => void {
  const timer = new Store<WatchTimer>({ timer: undefined, changes: [] });
  const root = routes[0]?.path ?? "";
  const subscriptions = routes.map((route) => [route.path, routeListener(root, route, timer, onChange)] as const);

  subscriptions.map(([path, listener], index) => addListener(path, routes[index]?.recursive ?? false, listener));

  return () => stopRoutes(timer, subscriptions);
}

/** Lists the shared watches of this process that have an open handle. */
export function openWatches(): readonly OpenWatch[] {
  return [...registry.current.entries.values()]
    .filter((entry) => entry.watcher !== undefined)
    .map((entry) => ({ path: entry.path, recursive: entry.recursive, subscribers: entry.listeners.size }));
}
