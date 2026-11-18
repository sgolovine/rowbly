import { isDeepStrictEqual } from "node:util";
import type { Story } from "../story/story-types.js";
import type { FieldChange } from "./outbox.js";

/** The action for one field change: write `after`, skip a change that is already there, or a conflict. */
export type ChangeAction = "write" | "skip" | "conflict";

/** The value of a recorded path on a Story. `found` is false for a path that the Story cannot have. */
export interface StoryValue {
  readonly found: boolean;
  readonly value: unknown;
}

/** The parts of a Story that the outbox records. */
type RecordedStory = Pick<Story, "title" | "description" | "stage" | "fields" | "tags" | "dependsOn">;

const FIELD_PREFIX = "fields.";

/** The value of a custom field. A field that the config does not have is not found. */
function fieldValue(story: RecordedStory, key: string): StoryValue {
  return Object.hasOwn(story.fields, key)
    ? { found: true, value: story.fields[key] ?? null }
    : { found: false, value: undefined };
}

/**
 * The value of `path` on the Story, in the same form as the recorded values of a write: `null` for a missing value,
 * full lists for `tags` and `dependsOn`, and the body for `description`.
 */
export function storyValue(story: RecordedStory, path: string): StoryValue {
  const values: Record<string, unknown> = {
    title: story.title ?? null,
    description: story.description,
    stage: story.stage ?? null,
    tags: story.tags,
    dependsOn: story.dependsOn,
  };

  if (path.startsWith(FIELD_PREFIX)) {
    return fieldValue(story, path.slice(FIELD_PREFIX.length));
  }

  return Object.hasOwn(values, path) ? { found: true, value: values[path] } : { found: false, value: undefined };
}

/**
 * The compare-and-set rule of one field change. A value equal to `before` gets `after`, a value equal to `after` is
 * already there, and each other value is a conflict.
 */
export function compareChange(current: unknown, change: FieldChange): ChangeAction {
  if (isDeepStrictEqual(current, change.before)) {
    return "write";
  }

  if (isDeepStrictEqual(current, change.after)) {
    return "skip";
  }

  return "conflict";
}
