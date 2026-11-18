import { join } from "node:path";
import { type WatchRoute, watchRoutes } from "../project-watch/project-watch.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

interface WatchOptions {
  readonly includeState?: boolean;
}

/** Tells if this name in `.rowbly/` is the factory state file, or a temporary file of a write of it. */
function isStateFile(filename: string | null): boolean {
  return filename?.startsWith("state.json") === true;
}

/** Tells if a change to this name in `.rowbly/` must call the Story callback. */
function isStoryChange(filename: string | null, options: WatchOptions): boolean {
  if (options.includeState === false && isStateFile(filename)) {
    return false;
  }

  return filename !== "runtime";
}

function acceptAll(): boolean {
  return true;
}

/** The folders of `.rowbly/` with Story data. Story folders and attachment folders have sub-folders. */
function storyRoutes(paths: ProjectPaths, options: WatchOptions): readonly WatchRoute[] {
  return [
    { path: paths.dir, recursive: false, accept: (filename) => isStoryChange(filename, options) },
    { path: paths.storiesDir, recursive: true, accept: acceptAll },
    { path: join(paths.dir, "attachments"), recursive: true, accept: acceptAll },
    { path: paths.specsDir, recursive: false, accept: acceptAll },
    { path: paths.stagesDir, recursive: false, accept: acceptAll },
    { path: paths.promptsDir, recursive: false, accept: acceptAll },
  ];
}

/**
 * Calls `onChange` after Story files or attachment files change, also from a different process. Returns the
 * function that stops the watch. The watch does not keep the process alive.
 */
export async function watchStories(
  onChange: () => void,
  ctx: ServiceContext = {},
  options: WatchOptions = {},
): Promise<() => void> {
  const paths = await findProject(ctx);

  return watchRoutes(storyRoutes(paths, options), onChange);
}

/**
 * Calls `onChange` after the factory state file `.rowbly/state.json` changes, and for no other file. Returns
 * the function that stops the watch. The watch does not keep the process alive.
 */
export async function watchFactoryState(onChange: () => void, ctx: ServiceContext = {}): Promise<() => void> {
  const paths = await findProject(ctx);

  return watchRoutes([{ path: paths.dir, recursive: false, accept: isStateFile }], onChange);
}
