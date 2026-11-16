import type { TagConfig } from "../../../services/config/config.js";

/** The choices of the `Tags` field: the tag values, and the label of each value. */
export interface TagChoices {
  readonly options: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
}

/** The change of an update of the `tags` list, or no key when the list does not change. */
interface TagsChange {
  readonly tags?: readonly string[];
}

/**
 * The choices of the `Tags` field: the tags of the project in config order, then each value of `selected` that
 * is not a tag of the project. Such a stale value has its value as its label, so that the user can remove it.
 * When the project has no tags, there are no choices and the form does not show the field.
 */
export function tagChoices(tags: readonly TagConfig[], selected: readonly string[]): TagChoices {
  if (tags.length === 0) {
    return { options: [], labels: {} };
  }

  const stale = selected.filter((value) => !tags.some((tag) => tag.value === value));

  return {
    options: [...tags.map((tag) => tag.value), ...stale],
    labels: Object.fromEntries([...stale.map((value) => [value, value]), ...tags.map((tag) => [tag.value, tag.label])]),
  };
}

/** The labels of the tag `values`, in their order. A value that is not a tag of the project shows as its value. */
export function tagLabels(values: readonly string[], tags: readonly TagConfig[]): string[] {
  return values.map((value) => tags.find((tag) => tag.value === value)?.label ?? value);
}

/** The tag values of a form value of the `Tags` field, or `undefined` when the form has no such field. */
export function tagsValue(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : undefined;
}

/** The full list `after` as `tags`, only when it is different from the list `before`. */
export function tagsChange(before: readonly string[], after: readonly string[] | undefined): TagsChange {
  if (after === undefined) {
    return {};
  }

  const same = after.length === before.length && after.every((tag, i) => tag === before[i]);

  return same ? {} : { tags: after };
}
