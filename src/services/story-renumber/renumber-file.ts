import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProjectConfig } from "../config/config.js";
import { parseMarkdown, serializeMarkdown } from "../markdown/markdown.js";
import {
  formatStoryId,
  listStoryFileNames,
  orderStoryData,
  removeStoryFile,
  renamedStoryPath,
  storyPath,
  withUpdatedAt,
} from "../story-files/story-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import type { DuplicateGroup, PlannedRenumber, UnrepairedDuplicate } from "./duplicate-plan.js";

/** One Story that got a new number. */
export interface StoryRenumber {
  /** The old ID of the file name: `ROW-77`. */
  readonly from: string;
  /** The new ID: `ROW-79`. */
  readonly to: string;
  /** The path of the new file. */
  readonly path: string;
  /** The path of the old file, which the repair removed. */
  readonly previousPath: string;
  /** The path of the Story that kept the old ID. */
  readonly keptPath: string;
}

/** The fixed environment of one repair. */
export interface RenumberEnv {
  readonly paths: ProjectPaths;
  readonly config: ProjectConfig;
  readonly now: Date;
}

export type RenumberOutcome = { readonly change: StoryRenumber } | { readonly unrepaired: UnrepairedDuplicate };

/** A new file that the repair created. */
interface CreatedFile {
  readonly id: string;
  readonly path: string;
}

/** The text of a file, or `undefined` when the file is gone. */
async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

/** The next free number from the current Story files, and at least one more than `floor`. */
async function nextNumber(paths: ProjectPaths, floor: number): Promise<number> {
  const names = await listStoryFileNames(paths);

  return Math.max(floor, ...names.map((name) => name.number)) + 1;
}

/** The path of the new file: the folder of its Stage, or the old folder when the Stage is not in the config. */
function targetPath(env: RenumberEnv, file: PlannedRenumber, number: number): string {
  const { paths, config } = env;
  const known = file.stage !== null && config.stages.some((stage) => stage.key === file.stage);

  return known
    ? storyPath(paths, config.projectKey, number, file.stage as string)
    : renamedStoryPath(file.path, formatStoryId(config.projectKey, number));
}

/** Creates the file only when no file is at the path. Gives `false` when a file is there. */
async function createExclusive(path: string, content: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });

  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }

    throw error;
  }
}

/** Creates the new file with the next free number. When that path exists, it tries the next number one time. */
async function createTarget(
  env: RenumberEnv,
  file: PlannedRenumber,
  content: string,
  floor = 0,
): Promise<CreatedFile | undefined> {
  const number = await nextNumber(env.paths, floor);
  const created = { id: formatStoryId(env.config.projectKey, number), path: targetPath(env, file, number) };

  if (await createExclusive(created.path, content)) {
    return created;
  }

  return floor === 0 ? createTarget(env, file, content, number) : undefined;
}

function notRepaired(group: DuplicateGroup, file: PlannedRenumber, reason: string): RenumberOutcome {
  return { unrepaired: { id: group.id, paths: [group.keep.path, file.path], reason } };
}

/** The text of the new file: the same Story with `updatedAt` set to the time of the repair. */
function renumberedText(env: RenumberEnv, file: PlannedRenumber): string {
  const doc = parseMarkdown(file.text, file.path);

  return serializeMarkdown({ data: orderStoryData(env.config, withUpdatedAt(doc.data, env.now)), body: doc.body });
}

/**
 * Gives one Story of a duplicate group the next free number. It never replaces a file, and it removes the old file
 * only when its text did not change, so that a second process that runs the repair does not lose or copy a Story.
 */
export async function renumberStory(
  env: RenumberEnv,
  group: DuplicateGroup,
  file: PlannedRenumber,
): Promise<RenumberOutcome> {
  if ((await readText(file.path)) !== file.text) {
    return notRepaired(group, file, "The Story file changed after the plan");
  }

  const created = await createTarget(env, file, renumberedText(env, file));

  if (!created) {
    return notRepaired(group, file, "A file exists at the path of the next free number");
  }

  if ((await readText(file.path)) !== file.text) {
    await removeStoryFile(env.paths, created.path);

    return notRepaired(group, file, "The Story file changed during the repair");
  }

  await removeStoryFile(env.paths, file.path);

  return {
    change: { from: file.id, to: created.id, path: created.path, previousPath: file.path, keptPath: group.keep.path },
  };
}
