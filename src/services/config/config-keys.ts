import { ValidationError } from "../errors/errors.js";
import type { CustomFieldType, Issue } from "./config-types.js";

const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]*$/;
export const STAGE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_NAME_MAX_LENGTH = 64;
/** Story frontmatter keys Rowbly owns; a custom field cannot use them. */
const RESERVED_FIELD_KEYS = ["title", "stage", "position", "id", "description"];

/** Throws a `ValidationError` carrying `issues` when there are any. */
export function throwIfIssues(message: string, issues: Issue[], hint?: string): void {
  if (issues.length > 0) {
    throw new ValidationError(message, { details: { issues }, hint });
  }
}

/** Gives an issue when the project key is not valid. */
export function checkProjectKey(key: string, path: Issue["path"] = ["projectKey"]): Issue[] {
  return PROJECT_KEY_PATTERN.test(key)
    ? []
    : [{ path, message: `Project key "${key}" must be uppercase letters and digits, starting with a letter` }];
}

/** Gives an issue when the stage key is not valid. */
export function checkStageKey(key: string, path: Issue["path"] = ["key"]): Issue[] {
  return STAGE_KEY_PATTERN.test(key)
    ? []
    : [{ path, message: `Stage key "${key}" must be uppercase letters, digits and _, starting with a letter` }];
}

/** Gives an issue when the field key is not valid or is reserved. */
export function checkFieldKey(key: string, path: Issue["path"] = ["key"]): Issue[] {
  if (!FIELD_KEY_PATTERN.test(key)) {
    return [{ path, message: `Field key "${key}" must be lowercase letters, digits and _, starting with a letter` }];
  }

  if (RESERVED_FIELD_KEYS.includes(key)) {
    return [{ path, message: `Field key "${key}" is reserved` }];
  }

  return [];
}

/** Gives an issue when the options do not agree with the field type. */
export function checkFieldOptions(type: CustomFieldType, options: string[] | undefined, path: Issue["path"]): Issue[] {
  if (type !== "select") {
    return options === undefined ? [] : [{ path, message: "Only a select field has options" }];
  }

  if (!options || options.length === 0) {
    return [{ path, message: "A select field needs at least one option" }];
  }

  if (new Set(options).size !== options.length) {
    return [{ path, message: "Options must be unique" }];
  }

  if (options.some((option) => option.trim() === "")) {
    return [{ path, message: "Options cannot be empty" }];
  }

  return [];
}

/** A skill name is also a folder name, so this check keeps a hand-edited config inside the skills folders. */
export function isSkillName(name: string): boolean {
  return name.length <= SKILL_NAME_MAX_LENGTH && SKILL_NAME_PATTERN.test(name);
}

/** `"In Progress"` → `"IN_PROGRESS"`. */
export function toStageKey(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^[_0-9]+|_+$/g, "");
}

/** `"Some Field"` → `"some_field"`. */
export function toFieldKey(label: string): string {
  return toStageKey(label).toLowerCase();
}

/** The first three letters of the name: `"Rowbly"` → `"ROW"`, `"my-app"` → `"MYA"`. */
export function toProjectKey(name: string): string {
  return (
    name
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3) || "ROW"
  );
}

/** `"IN_PROGRESS"` → `"In Progress"`. */
export function labelFromKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(" ");
}
