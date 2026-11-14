import { type FSWatcher, watch } from "node:fs";
import { Store } from "../store/store.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

interface WatchOptions {
  readonly includeState?: boolean;
}

interface WatchTimer {
  readonly timer: NodeJS.Timeout | undefined;
}

/** One save writes more than one event, so the callback waits for this quiet time. */
const QUIET_MS = 100;

/** Tells if this path of `.rowbly/` is the factory state file, or a temporary file of a write of it. */
function isStateFile(filename: string | null): boolean {
  return filename?.startsWith("state.json") === true;
}

/** Tells if a change to this path of `.rowbly/` must not call the callback. */
function isIgnored(filename: string | null, options: WatchOptions): boolean {
  if (options.includeState === false && isStateFile(filename)) {
    return true;
  }

  return filename === "runtime" || filename?.startsWith("runtime/") === true;
}

/** Starts the quiet time again, so that a burst of events gives one call. */
function schedule(timer: Store<WatchTimer>, onChange: () => void): void {
  clearTimeout(timer.current.timer);
  timer.update(() => ({ timer: setTimeout(onChange, QUIET_MS) }));
}

function onWatchEvent(
  filename: string | null,
  timer: Store<WatchTimer>,
  onChange: () => void,
  accept: (filename: string | null) => boolean,
): void {
  if (!accept(filename)) {
    return;
  }

  schedule(timer, onChange);
}

function stopWatch(timer: Store<WatchTimer>, watcher: FSWatcher): void {
  clearTimeout(timer.current.timer);
  watcher.close();
}

/** Watches `.rowbly/` and calls `onChange` after the quiet time, for each change that `accept` accepts. */
async function watchProjectDir(
  onChange: () => void,
  ctx: ServiceContext,
  accept: (filename: string | null) => boolean,
): Promise<() => void> {
  const paths = await findProject(ctx);
  const timer = new Store<WatchTimer>({ timer: undefined });
  const watcher = watch(paths.dir, { persistent: false, recursive: true }, (_event, filename) =>
    onWatchEvent(filename, timer, onChange, accept),
  );

  // The folder can go away while Rowbly runs. Without a listener, this error stops the process.
  watcher.on("error", () => watcher.close());

  return () => stopWatch(timer, watcher);
}

/**
 * Calls `onChange` after Story files or attachment files change, also from a different process. Returns the
 * function that stops the watch. The watch does not keep the process alive.
 */
export function watchStories(
  onChange: () => void,
  ctx: ServiceContext = {},
  options: WatchOptions = {},
): Promise<() => void> {
  return watchProjectDir(onChange, ctx, (filename) => !isIgnored(filename, options));
}

/**
 * Calls `onChange` after the factory state file `.rowbly/state.json` changes, and for no other file. Returns
 * the function that stops the watch. The watch does not keep the process alive.
 */
export function watchFactoryState(onChange: () => void, ctx: ServiceContext = {}): Promise<() => void> {
  return watchProjectDir(onChange, ctx, isStateFile);
}
