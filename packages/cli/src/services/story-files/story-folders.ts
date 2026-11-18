import { mkdir, readdir, rename, rm, rmdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type ProjectConfig, STAGE_KEY_PATTERN } from "../config/config.js";
import { listMarkdownFiles, pathOccupied } from "../files/files.js";
import { type ProjectPaths, storyStageDir } from "../workspace/workspace.js";

/** A Markdown file directly in the Story folder or in one of its Stage folders. No file is read. */
export interface StoryEntry {
  /** `ROW-01.md`. */
  readonly fileName: string;
  readonly path: string;
  /** The Stage folder of the file, or `null` for a file directly in `stories/` (the old flat layout). */
  readonly folder: string | null;
}

/** Whether a subfolder of `stories/` has the name of a Stage key. Only these folders hold Story files. */
export function isStageFolderName(name: string): boolean {
  return STAGE_KEY_PATTERN.test(name);
}

/** The names of all subfolders of `stories/`, sorted; none when `stories/` does not exist. */
export async function listStoryFolders(paths: ProjectPaths): Promise<string[]> {
  try {
    const entries = await readdir(paths.storiesDir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function folderEntries(paths: ProjectPaths, folder: string | null): Promise<StoryEntry[]> {
  const dir = folder === null ? paths.storiesDir : storyStageDir(paths, folder);
  const names = await listMarkdownFiles(dir);

  return names.map((fileName) => ({ fileName, path: join(dir, fileName), folder }));
}

/**
 * Each Markdown file directly in `stories/` and in each Stage folder of `stories/`. The flat files come first, then
 * the Stage folders in name order. A subfolder with a name that is not a Stage key is not read.
 */
export async function listStoryEntries(paths: ProjectPaths): Promise<StoryEntry[]> {
  const folders = (await listStoryFolders(paths)).filter(isStageFolderName);
  const lists = await Promise.all([null, ...folders].map((folder) => folderEntries(paths, folder)));

  return lists.flat();
}

/**
 * The path where the Story file belongs: the folder of its Stage, with the same file name. A Story with a Stage that
 * is not in the config stays where it is, and `doctor` reports its Stage.
 */
export function storyHomePath(
  paths: ProjectPaths,
  config: ProjectConfig,
  path: string,
  data: Readonly<Record<string, unknown>>,
): string {
  const stage = data.stage;
  const known = typeof stage === "string" && config.stages.some((s) => s.key === stage);

  return known ? join(storyStageDir(paths, stage), basename(path)) : path;
}

/**
 * The path that a write of the Story file uses. A different file at the home path keeps the Story where it is, so
 * that a write never replaces the file of a different copy. `doctor` reports the two copies.
 */
export async function storyWritePath(
  paths: ProjectPaths,
  config: ProjectConfig,
  path: string,
  data: Readonly<Record<string, unknown>>,
): Promise<string> {
  const home = storyHomePath(paths, config, path, data);

  return home !== path && (await pathOccupied(home)) ? path : home;
}

/** Removes a Stage folder of `stories/` when it is empty. It never removes `stories/` or a folder outside it. */
async function removeEmptyStageFolder(paths: ProjectPaths, dir: string): Promise<void> {
  if (dirname(dir) !== paths.storiesDir) {
    return;
  }

  try {
    await rmdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "ENOENT") {
      throw error;
    }
  }
}

/** Removes a Story file, and its Stage folder when the folder is then empty. */
export async function removeStoryFile(paths: ProjectPaths, path: string): Promise<void> {
  await rm(path, { force: true });
  await removeEmptyStageFolder(paths, dirname(path));
}

/** Removes the old file of a Story that moved to a new path. */
export async function removeMovedStoryFile(paths: ProjectPaths, from: string, to: string): Promise<void> {
  if (from !== to) {
    await removeStoryFile(paths, from);
  }
}

/** Moves a Story file to a new path without a change of its bytes, and removes the old Stage folder when it is empty. */
export async function moveStoryFile(paths: ProjectPaths, from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  await removeEmptyStageFolder(paths, dirname(from));
}
