import { type Issue, throwIfIssues } from "../config/config.js";
import { ValidationError } from "../errors/errors.js";

/** What a user chooses in onboarding. A choice that is left out takes its default. */
export interface OnboardingInput {
  name?: string;
  key?: string;
  /**
   * In board order. Each entry is the key or name of a default stage, or the name of a custom stage.
   * Backlog and Done are always in the project: if one is left out, it goes at the start or the end.
   */
  stages?: string[];
  skills?: string[];
  /** Every skill in `skills` is installed for each of these harnesses. */
  harnesses?: string[];
}

const INPUT_KEYS = ["name", "key", "stages", "skills", "harnesses"];

/** The CLI prints the list of issues only if there are two or more, so one issue must be the message. */
export function headline(issues: readonly Issue[], several: string): string {
  return issues.length === 1 ? (issues[0]?.message ?? several) : several;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Checks the shape of JSON input for `rowbly init`. */
export function parseOnboardingInput(value: unknown): OnboardingInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("The setup input must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  const issues: Issue[] = [
    ...Object.keys(record)
      .filter((key) => !INPUT_KEYS.includes(key))
      .map((key) => ({ path: [key], message: `Unknown setup key "${key}"` })),
    ...["name", "key"]
      .filter((key) => record[key] !== undefined && typeof record[key] !== "string")
      .map((key) => ({ path: [key], message: `"${key}" must be a string` })),
    ...["stages", "skills", "harnesses"]
      .filter((key) => record[key] !== undefined && !stringList(record[key]))
      .map((key) => ({ path: [key], message: `"${key}" must be a list of strings` })),
  ];

  throwIfIssues(headline(issues, "The setup input is invalid"), issues, `Keys: ${INPUT_KEYS.join(", ")}`);

  return record as OnboardingInput;
}
