import type { Issue, ProjectConfig } from "../config/config.js";
import { coerceFieldValue, type FieldValue } from "../fields/fields.js";
import type { FieldInput } from "./story-types.js";

/** The coerced values of the fields in the input, and an issue for each unknown field or invalid value. */
export interface FieldUpdates {
  readonly values: Record<string, FieldValue>;
  readonly issues: Issue[];
}

type FieldUpdate = { key: string; value: FieldValue } | { issue: Issue };

function fieldUpdate(config: ProjectConfig, key: string, value: unknown): FieldUpdate {
  const field = config.customFields.find((f) => f.key === key);

  if (!field) {
    return { issue: { path: [key], message: `Unknown custom field "${key}"` } };
  }

  const result = coerceFieldValue(field, value);

  return result.ok ? { key, value: result.value } : { issue: { path: [key], message: result.error } };
}

/** Coerces each field of the input by its type, in the order of the input. */
export function fieldUpdates(config: ProjectConfig, fields: FieldInput): FieldUpdates {
  const updates = Object.entries(fields).map(([key, value]) => fieldUpdate(config, key, value));

  return {
    values: Object.fromEntries(updates.flatMap((update) => ("key" in update ? [[update.key, update.value]] : []))),
    issues: updates.flatMap((update) => ("issue" in update ? [update.issue] : [])),
  };
}

/** Gives an issue when the title is empty. */
export function titleIssues(title: string): Issue[] {
  return title.trim() === "" ? [{ path: ["title"], message: "Title is required" }] : [];
}

/** Gives an issue when the position is not a whole number from 1. */
export function positionIssues(position: number | undefined): Issue[] {
  return position !== undefined && (!Number.isInteger(position) || position < 1)
    ? [{ path: ["position"], message: "Position must be a whole number from 1" }]
    : [];
}
