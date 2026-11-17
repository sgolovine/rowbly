import { type WatchRoute, watchRoutes } from "../project-watch/project-watch.js";
import { findProject, type ProjectPaths, runtimePaths, type ServiceContext } from "../workspace/workspace.js";

/** Tells if this name in `.rowbly/runtime/` is the factory status or the factory owner. */
function isFactoryFile(filename: string | null): boolean {
  return filename === "status.json" || filename === "factory.lock";
}

function acceptAll(): boolean {
  return true;
}

/**
 * The watches of thread metadata. The watches of `.rowbly/` and `runtime/` see the creation of `runtime/` and
 * `threads/`. Session histories and logs are in other folders of `runtime/`, so no watch sees them.
 */
function threadRoutes(paths: ProjectPaths, factory: boolean): readonly WatchRoute[] {
  const runtime = runtimePaths(paths);

  return [
    { path: paths.dir, recursive: false, accept: (filename) => factory && filename === "runtime" },
    {
      path: paths.runtimeDir,
      recursive: false,
      accept: (filename) => filename === "threads" || (factory && isFactoryFile(filename)),
    },
    { path: runtime.threadsDir, recursive: false, accept: acceptAll },
  ];
}

/**
 * Calls `onChange` after thread metadata changes, also from a different process. With `factory`, a change
 * of the factory status or owner also calls it. Session histories and logs do not call it. The watch waits
 * for 100 ms of quiet, and it does not keep the process alive. Returns the function that stops the watch.
 */
export async function watchThreads(
  onChange: () => void,
  ctx: ServiceContext = {},
  options: { factory?: boolean } = {},
): Promise<() => void> {
  const paths = await findProject(ctx);

  return watchRoutes(threadRoutes(paths, !!options.factory), onChange);
}
