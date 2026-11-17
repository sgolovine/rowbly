import { type Issue, type ProjectConfig, projectTags, throwIfIssues } from "../config/config.js";
import { ValidationError } from "../errors/errors.js";
import { tagsOf, withTags } from "../story-files/story-files.js";
import type { UpdateStoryInput } from "./story-types.js";

/** The values without spaces at the ends and without duplicates, in the given order. */
function normalizeTags(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()))];
}

/** Gives an issue for each value that is not a tag of the project. */
function unknownTagIssues(config: ProjectConfig, values: readonly string[], path: Issue["path"]): Issue[] {
  const known = projectTags(config).map((tag) => tag.value);
  const unknown = values.filter((value) => !known.includes(value));
  const list = known.join(", ") || "none";

  return unknown.map((value) => ({ path, message: `Unknown tag "${value}". Tags: ${list}` }));
}

/** The values in normalized form. Throws a `ValidationError` when a value is not a tag of the project. */
export function checkedTags(config: ProjectConfig, values: readonly string[], path: Issue["path"]): string[] {
  const tags = normalizeTags(values);

  throwIfIssues("The tags are invalid", unknownTagIssues(config, tags, path));

  return tags;
}

/**
 * The new `tags` list of an update, or `undefined` when the list does not change. Throws a `ValidationError` when the
 * input has a full list together with an addition or a removal, or when a new value is not a tag of the project.
 */
function requestedTags(
  config: ProjectConfig,
  data: Record<string, unknown>,
  input: UpdateStoryInput,
): readonly string[] | undefined {
  const { tags, addTags, removeTags } = input;

  if (addTags === undefined && removeTags === undefined) {
    return tags === undefined ? undefined : checkedTags(config, tags, ["tags"]);
  }

  if (tags !== undefined) {
    throw new ValidationError("Give a full tags list or the changes to the list, not both", {
      details: { issues: [{ path: ["tags"], message: "tags cannot be used with addTags or removeTags" }] },
    });
  }

  const current = tagsOf(data);
  const removed = new Set(normalizeTags(removeTags ?? []));
  const added = checkedTags(config, addTags ?? [], ["addTags"]);
  const changed = normalizeTags([...current.filter((value) => !removed.has(value)), ...added]);

  return changed.join("\n") === current.join("\n") ? undefined : changed;
}

/** The frontmatter after an update of the `tags` list. Without a change of the list, the old value stays. */
export function updatedTags(
  config: ProjectConfig,
  data: Record<string, unknown>,
  input: UpdateStoryInput,
): Record<string, unknown> {
  const tags = requestedTags(config, data, input);

  return tags === undefined ? data : withTags(data, tags);
}
