import { readFile } from "node:fs/promises";
import { attachmentDir, readAttachments } from "../attachment-files/attachment-files.js";
import { readFactoryState } from "../factory-state/factory-state.js";
import { mapInOrder } from "../in-order/in-order.js";
import { parseMarkdown } from "../markdown/markdown.js";
import { canonicalStoryId, readSpecFiles, type SpecFile } from "../spec-files/spec-files.js";
import { dependsOnOf, listStoryFileNames, type StoryFileName } from "../story-files/story-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";

/**
 * The references to the old Story ID that stay with the Story that keeps the ID. The user can correct a reference
 * that belongs to the Story with the new number.
 */
export interface StayedRefs {
  /** The paths of the Story files with the old ID in `dependsOn`. */
  readonly dependents: readonly string[];
  /** The paths of the Spec files that link to the old ID. */
  readonly specs: readonly string[];
  /** The names of the attachments of the old ID without a `storyUid`. */
  readonly attachments: readonly string[];
  /** The number of attempts of `.rowbly/state.json` for the old ID without a `storyUid`. */
  readonly attempts: number;
}

/** The environment of one search: the Project paths, the project key and the old ID. */
interface RefSearch {
  readonly paths: ProjectPaths;
  readonly projectKey: string;
  readonly id: string;
}

function isOldId(search: RefSearch, value: unknown): boolean {
  return canonicalStoryId(search.projectKey, value) === canonicalStoryId(search.projectKey, search.id);
}

/** Tells if the Story file has the old ID in `dependsOn`. A file that cannot be read has no reference. */
async function dependsOnOld(search: RefSearch, name: StoryFileName): Promise<boolean> {
  try {
    const { data } = parseMarkdown(await readFile(name.path, "utf8"), name.path);

    return dependsOnOf(data).some((id) => isOldId(search, id));
  } catch {
    return false;
  }
}

async function dependentPaths(search: RefSearch): Promise<string[]> {
  const names = await listStoryFileNames(search.paths);
  const found = await mapInOrder(names, (name) => dependsOnOld(search, name));

  return names.filter((_, index) => found[index]).map((name) => name.path);
}

function linksOld(search: RefSearch, spec: SpecFile): boolean {
  const stories = spec.doc.data.stories;

  return Array.isArray(stories) && stories.some((id) => isOldId(search, id));
}

/** The Spec files that link to the old ID. When a Spec file cannot be read, no Spec file is listed. */
async function specPaths(search: RefSearch): Promise<string[]> {
  const specs = await readSpecFiles(search.paths).catch((): SpecFile[] => []);

  return specs.filter((spec) => linksOld(search, spec)).map((spec) => spec.path);
}

async function attachmentNames(search: RefSearch): Promise<string[]> {
  try {
    const records = await readAttachments(await attachmentDir(search.paths, search.id));

    return records.filter((record) => record.storyUid === undefined).map((record) => record.name);
  } catch {
    return [];
  }
}

async function attemptCount(search: RefSearch): Promise<number> {
  try {
    const { attempts } = await readFactoryState(search.paths.root);

    return attempts.filter((attempt) => attempt.storyUid === undefined && isOldId(search, attempt.story)).length;
  } catch {
    return 0;
  }
}

/**
 * Finds the references to the old ID that stay with the Story that keeps the ID: `dependsOn` lists, Spec links,
 * attachments without `storyUid`, and attempts without `storyUid`. No file changes.
 */
export async function findStayedRefs(paths: ProjectPaths, projectKey: string, id: string): Promise<StayedRefs> {
  const search = { paths, projectKey, id };

  return {
    dependents: await dependentPaths(search),
    specs: await specPaths(search),
    attachments: await attachmentNames(search),
    attempts: await attemptCount(search),
  };
}
