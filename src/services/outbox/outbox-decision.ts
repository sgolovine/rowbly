// The compare-and-set decision of a field change against a Story, and the Story write of the changes. The outbox apply
// on the main machine and the inbound apply on a worker host use it.

import type { Story, UpdateStoryInput } from "../story/story-types.js";
import type { FieldChange } from "./outbox.js";
import { type ChangeAction, compareChange, storyValue } from "./outbox-compare.js";

/** The decision for one change. */
export interface Decision {
  readonly change: FieldChange;
  readonly action: ChangeAction;
  readonly current: unknown;
  readonly reason: string;
}

const FIELD_PREFIX = "fields.";
const TEXT_PATHS = ["title", "stage", "description"];
const LIST_PATHS = ["tags", "dependsOn"];

function isTextList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Tells if `after` has a form that the Story write can take for the path. */
export function hasWritableForm(change: FieldChange): boolean {
  if (TEXT_PATHS.includes(change.path)) {
    return typeof change.after === "string";
  }

  if (LIST_PATHS.includes(change.path)) {
    return isTextList(change.after);
  }

  return change.path.startsWith(FIELD_PREFIX);
}

/** The compare-and-set decision for one change on the Story. */
export function decide(story: Story, change: FieldChange, reason: string): Decision {
  const current = storyValue(story, change.path);

  if (!current.found) {
    return { change, action: "conflict", current: undefined, reason: `Unknown path ${change.path}` };
  }

  const action = compareChange(current.value, change);

  if (action === "write" && !hasWritableForm(change)) {
    return { change, action: "conflict", current: current.value, reason: "The new value has a bad form" };
  }

  return { change, action, current: current.value, reason };
}

/** The Story write for the changes to write. */
export function updateInput(id: string, changes: readonly FieldChange[]): UpdateStoryInput {
  const fieldChanges = changes.filter((change) => change.path.startsWith(FIELD_PREFIX));
  const named = Object.fromEntries(
    changes.filter((change) => !change.path.startsWith(FIELD_PREFIX)).map((change) => [change.path, change.after]),
  );
  const fields = Object.fromEntries(
    fieldChanges.map((change) => [change.path.slice(FIELD_PREFIX.length), change.after]),
  );

  return { ...named, id, ...(fieldChanges.length > 0 ? { fields } : {}) };
}
