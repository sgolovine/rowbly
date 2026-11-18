import { basename, dirname, join } from "node:path";
import { type WatchCallback, type WatchChange, type WatchRoute, watchRoutes } from "../project-watch/project-watch.js";
import { readStoryAt, type StoryRead } from "../story/story.js";
import { parseStoryFileName } from "../story-files/story-files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

export type { WatchChange } from "../project-watch/project-watch.js";

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
 * Calls `onChange` after Story files or attachment files change, also from a different process. `onChange` gets the
 * changed names of one quiet time, relative to `.rowbly/`. See `storyFileChanges`. Returns the function that stops the
 * watch. The watch does not keep the process alive.
 */
export async function watchStories(
  onChange: WatchCallback,
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

/** The name of the temporary file of `writeFileAtomic`: `.<uuid>.tmp`. */
const TEMP_FILE_NAME = /^\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;

/** The kind of one changed name: a Story file, a temporary file of a write, or a different file. */
type ChangeKind = "story" | "temp" | "other";

/** Tells if `path` is directly in the Story folder or in one of its Stage folders. */
function inStoryFolder(paths: ProjectPaths, path: string): boolean {
  const folder = dirname(path);

  return folder === paths.storiesDir || dirname(folder) === paths.storiesDir;
}

function changeKind(paths: ProjectPaths, path: string): ChangeKind {
  const name = basename(path);

  if (TEMP_FILE_NAME.test(name)) {
    return "temp";
  }

  return inStoryFolder(paths, path) && parseStoryFileName(name) !== undefined ? "story" : "other";
}

/**
 * Classifies the changed names of one quiet time of `watchStories`. Gives the absolute paths of the changed Story
 * files, or `undefined` when the board must be read again in full: for a change with no name, or for a change of a
 * file that is not a Story file, for example the config, a Stage, a Spec, a prompt or an attachment. The temporary
 * file of an atomic write is ignored, because the rename of the write also gives an event.
 */
export function storyFileChanges(paths: ProjectPaths, changes: readonly WatchChange[]): readonly string[] | undefined {
  if (changes.includes(null)) {
    return undefined;
  }

  const files = (changes as readonly string[]).map((change) => join(paths.dir, change));
  const kinds = files.map((path) => changeKind(paths, path));

  if (kinds.includes("other")) {
    return undefined;
  }

  return [...new Set(files.filter((_, index) => kinds[index] === "story"))];
}

/** Reads the Story of each path. Gives `undefined` when one read fails. */
async function readStories(files: readonly string[], ctx: ServiceContext): Promise<readonly StoryRead[] | undefined> {
  try {
    return await Promise.all(files.map(async (path) => ({ path, story: await readStoryAt(path, ctx) })));
  } catch {
    return undefined;
  }
}

/**
 * Reads only the Stories that the changed names of `watchStories` name. Each result has the path of a changed Story
 * file, and its Story, or `undefined` when the file does not exist. Gives `undefined` when the board must be read
 * again in full: see `storyFileChanges`, and also when the read of one Story fails.
 */
export async function readStoryChanges(
  changes: readonly WatchChange[],
  ctx: ServiceContext = {},
): Promise<readonly StoryRead[] | undefined> {
  const files = storyFileChanges(await findProject(ctx), changes);

  return files === undefined ? undefined : readStories(files, ctx);
}
