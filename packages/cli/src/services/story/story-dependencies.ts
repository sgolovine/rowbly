import type { ProjectConfig } from "../config/config.js";
import { ValidationError } from "../errors/errors.js";
import { mapInOrder } from "../in-order/in-order.js";
import { canonicalStoryId } from "../spec-files/spec-files.js";
import { type DependencyStory, dependencyError } from "../story-dependency/story-dependency.js";
import { dependsOnOf, type StoryFile, withDependsOn, writeStoryFile } from "../story-files/story-files.js";

/** The dependency fields of each story file. */
export function dependencyStories(files: readonly StoryFile[]): DependencyStory[] {
  return files.map((file) => ({
    id: file.id,
    stage: String(file.doc.data.stage),
    dependsOn: dependsOnOf(file.doc.data),
  }));
}

/** The IDs in canonical form, without duplicates, in the given order. An ID of a different Project stays as given. */
function normalizeDependsOn(config: ProjectConfig, dependsOn: readonly string[]): string[] {
  const ids = dependsOn.map((id) => canonicalStoryId(config.projectKey, id) ?? id.trim().toUpperCase());

  return [...new Set(ids)];
}

/**
 * The `dependsOn` list after the removal of each ID of `remove` and the addition of each ID of `add`, in this
 * order. An addition of an ID in the list, or a removal of an ID that is not in the list, changes nothing.
 */
export function changedDependsOn(
  config: ProjectConfig,
  current: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] {
  const removed = new Set(normalizeDependsOn(config, remove));
  const kept = normalizeDependsOn(config, current).filter((id) => !removed.has(id));

  return normalizeDependsOn(config, [...kept, ...add]);
}

/**
 * Gives the `dependsOn` list of the story `id` in canonical form. Throws a `ValidationError` with the problem in
 * `details` when the list is invalid. `files` are all the story files of the Project.
 */
export function checkedDependsOn(
  config: ProjectConfig,
  files: readonly StoryFile[],
  id: string,
  dependsOn: readonly string[],
): string[] {
  const ids = normalizeDependsOn(config, dependsOn);
  const problem = dependencyError(dependencyStories(files), id, ids);

  if (problem) {
    throw new ValidationError(problem.message, {
      details: { [problem.kind]: problem.ids, issues: [{ path: ["dependsOn"], message: problem.message }] },
    });
  }

  return ids;
}

/** Whether the frontmatter value is the ID `id`, in any form that the ID rules accept. */
function isId(config: ProjectConfig, value: string, id: string): boolean {
  return canonicalStoryId(config.projectKey, value) === id;
}

/**
 * Removes `id` from the `dependsOn` list of the story file, with `now` as its `updatedAt`. Gives a warning, or nothing
 * when the list has no `id`.
 */
async function removeDependency(config: ProjectConfig, file: StoryFile, id: string, now: Date): Promise<string[]> {
  const dependsOn = dependsOnOf(file.doc.data);
  const kept = dependsOn.filter((value) => !isId(config, value, id));

  if (kept.length === dependsOn.length) {
    return [];
  }

  await writeStoryFile(config, file.path, { ...file.doc, data: withDependsOn(file.doc.data, kept) }, now);

  return [`Removed the dependency on ${id} from ${file.id}`];
}

/** Removes `id` from the `dependsOn` list of each downstream story. Gives a warning for each changed story. */
export async function removeDependencies(
  config: ProjectConfig,
  files: readonly StoryFile[],
  id: string,
  now: Date,
): Promise<string[]> {
  const downstream = files.filter((file) => file.id !== id);
  const warnings = await mapInOrder(downstream, (file) => removeDependency(config, file, id, now));

  return warnings.flat();
}
