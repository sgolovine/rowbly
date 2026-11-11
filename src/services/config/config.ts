import { readFile } from "node:fs/promises";
import { ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import type { ProjectPaths } from "../workspace/workspace.js";

export const CUSTOM_FIELD_TYPES = ["string", "number", "boolean", "url", "date", "select"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export interface CustomField {
  /** The frontmatter key in every story. */
  key: string;
  label: string;
  type: CustomFieldType;
  /** The allowed values of a `select` field. */
  options?: string[];
}

export interface StageConfig {
  /** Also the stage's file name: `stages/<key>.md`. */
  key: string;
  label: string;
  enabled: boolean;
}

/** The shape of `.rowbly/rowbly.config.json`. */
export interface ProjectConfig {
  projectName: string;
  /** The prefix of every story ID: `ROW` in `ROW-01`. */
  projectKey: string;
  customFields: CustomField[];
  /** In board order. */
  stages: StageConfig[];
  /** The optional features that are on. A feature that is not here is off. */
  features?: FeatureConfig;
  /** The bundled skills that Rowbly installed in this project. */
  skills?: InstalledSkill[];
}

/** The optional features of a project, by name. */
export interface FeatureConfig {
  /** Markdown documents that are linked to Stories, in `specs/`. */
  specs?: boolean;
}

const FEATURES = ["specs"] as const;
export type Feature = (typeof FEATURES)[number];

/** The coding harnesses that Rowbly can install a skill for. */
export const SKILL_HARNESSES = ["claude-code", "codex", "gemini-cli", "github-copilot", "cursor"] as const;
export type SkillHarness = (typeof SKILL_HARNESSES)[number];

/** A bundled skill and the harnesses it is installed for. */
export interface InstalledSkill {
  name: string;
  harnesses: SkillHarness[];
}

export function featureEnabled(config: ProjectConfig, feature: Feature): boolean {
  return config.features?.[feature] === true;
}

const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]*$/;
export const STAGE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_NAME_MAX_LENGTH = 64;
/** Story frontmatter keys Rowbly owns; a custom field cannot use them. */
const RESERVED_FIELD_KEYS = ["title", "stage", "position", "id", "description"];

export interface Issue {
  path: (string | number)[];
  message: string;
}

/** Throws a `ValidationError` carrying `issues` when there are any. */
export function throwIfIssues(message: string, issues: Issue[], hint?: string): void {
  if (issues.length > 0) throw new ValidationError(message, { details: { issues }, hint });
}

export function checkProjectKey(key: string, path: Issue["path"] = ["projectKey"]): Issue[] {
  return PROJECT_KEY_PATTERN.test(key)
    ? []
    : [{ path, message: `Project key "${key}" must be uppercase letters and digits, starting with a letter` }];
}

export function checkStageKey(key: string, path: Issue["path"] = ["key"]): Issue[] {
  return STAGE_KEY_PATTERN.test(key)
    ? []
    : [{ path, message: `Stage key "${key}" must be uppercase letters, digits and _, starting with a letter` }];
}

export function checkFieldKey(key: string, path: Issue["path"] = ["key"]): Issue[] {
  if (!FIELD_KEY_PATTERN.test(key)) {
    return [{ path, message: `Field key "${key}" must be lowercase letters, digits and _, starting with a letter` }];
  }
  if (RESERVED_FIELD_KEYS.includes(key)) return [{ path, message: `Field key "${key}" is reserved` }];
  return [];
}

export function checkFieldOptions(type: CustomFieldType, options: string[] | undefined, path: Issue["path"]): Issue[] {
  if (type !== "select") {
    return options === undefined ? [] : [{ path, message: "Only a select field has options" }];
  }
  if (!options || options.length === 0) return [{ path, message: "A select field needs at least one option" }];
  if (new Set(options).size !== options.length) return [{ path, message: "Options must be unique" }];
  if (options.some((option) => option.trim() === "")) return [{ path, message: "Options cannot be empty" }];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function skillIssues(skills: unknown): Issue[] {
  if (!Array.isArray(skills)) return [{ path: ["skills"], message: "skills must be an array" }];
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const [i, skill] of (skills as unknown[]).entries()) {
    const path = ["skills", i];
    if (!isRecord(skill)) {
      issues.push({ path, message: "A skill must be an object" });
      continue;
    }
    if (typeof skill.name !== "string") issues.push({ path: [...path, "name"], message: "name is required" });
    else {
      if (!isSkillName(skill.name)) {
        issues.push({
          path: [...path, "name"],
          message: `Skill name "${skill.name}" must be lowercase letters and digits, separated by single hyphens`,
        });
      }
      if (seen.has(skill.name)) issues.push({ path: [...path, "name"], message: `Duplicate skill "${skill.name}"` });
      seen.add(skill.name);
    }
    issues.push(...harnessIssues(skill.harnesses, [...path, "harnesses"]));
  }
  return issues;
}

function harnessIssues(harnesses: unknown, path: Issue["path"]): Issue[] {
  if (!Array.isArray(harnesses)) return [{ path, message: "harnesses must be an array" }];
  if (harnesses.length === 0) return [{ path, message: "A skill needs at least one harness" }];
  const issues: Issue[] = [];
  const seen = new Set<unknown>();
  for (const [i, harness] of (harnesses as unknown[]).entries()) {
    if (!SKILL_HARNESSES.includes(harness as SkillHarness)) {
      issues.push({ path: [...path, i], message: `Unknown harness "${harness}"` });
    } else if (seen.has(harness)) {
      issues.push({ path: [...path, i], message: `Duplicate harness "${harness}"` });
    }
    seen.add(harness);
  }
  return issues;
}

/** Every problem with a parsed config file; none means `raw` is a valid `ProjectConfig`. */
export function configIssues(raw: unknown): Issue[] {
  if (!isRecord(raw)) return [{ path: [], message: "The config must be a JSON object" }];
  const issues: Issue[] = [];
  if (!nonEmptyString(raw.projectName)) issues.push({ path: ["projectName"], message: "projectName is required" });
  if (typeof raw.projectKey !== "string") issues.push({ path: ["projectKey"], message: "projectKey is required" });
  else issues.push(...checkProjectKey(raw.projectKey));

  if (!Array.isArray(raw.customFields)) {
    issues.push({ path: ["customFields"], message: "customFields must be an array" });
  } else {
    const seen = new Set<string>();
    for (const [i, field] of (raw.customFields as unknown[]).entries()) {
      const path = ["customFields", i];
      if (!isRecord(field)) {
        issues.push({ path, message: "A custom field must be an object" });
        continue;
      }
      if (typeof field.key !== "string") issues.push({ path: [...path, "key"], message: "key is required" });
      else {
        issues.push(...checkFieldKey(field.key, [...path, "key"]));
        if (seen.has(field.key)) issues.push({ path: [...path, "key"], message: `Duplicate field key "${field.key}"` });
        seen.add(field.key);
      }
      if (!nonEmptyString(field.label)) issues.push({ path: [...path, "label"], message: "label is required" });
      if (!CUSTOM_FIELD_TYPES.includes(field.type as CustomFieldType)) {
        issues.push({ path: [...path, "type"], message: `type must be one of ${CUSTOM_FIELD_TYPES.join(", ")}` });
      } else if (
        field.options !== undefined &&
        (!Array.isArray(field.options) || field.options.some((o) => typeof o !== "string"))
      ) {
        issues.push({ path: [...path, "options"], message: "options must be an array of strings" });
      } else {
        issues.push(
          ...checkFieldOptions(field.type as CustomFieldType, field.options as string[] | undefined, [
            ...path,
            "options",
          ]),
        );
      }
    }
  }

  if (!Array.isArray(raw.stages)) {
    issues.push({ path: ["stages"], message: "stages must be an array" });
  } else {
    if (raw.stages.length === 0) issues.push({ path: ["stages"], message: "A project needs at least one stage" });
    const seen = new Set<string>();
    for (const [i, stage] of (raw.stages as unknown[]).entries()) {
      const path = ["stages", i];
      if (!isRecord(stage)) {
        issues.push({ path, message: "A stage must be an object" });
        continue;
      }
      if (typeof stage.key !== "string") issues.push({ path: [...path, "key"], message: "key is required" });
      else {
        issues.push(...checkStageKey(stage.key, [...path, "key"]));
        if (seen.has(stage.key)) issues.push({ path: [...path, "key"], message: `Duplicate stage key "${stage.key}"` });
        seen.add(stage.key);
      }
      if (!nonEmptyString(stage.label)) issues.push({ path: [...path, "label"], message: "label is required" });
      if (typeof stage.enabled !== "boolean") {
        issues.push({ path: [...path, "enabled"], message: "enabled must be true or false" });
      }
    }
  }
  if (raw.features !== undefined) {
    if (!isRecord(raw.features)) issues.push({ path: ["features"], message: "features must be an object" });
    else {
      for (const [name, value] of Object.entries(raw.features)) {
        if (!FEATURES.includes(name as Feature)) {
          issues.push({ path: ["features", name], message: `Unknown feature "${name}"` });
        } else if (typeof value !== "boolean") {
          issues.push({ path: ["features", name], message: `${name} must be true or false` });
        }
      }
    }
  }
  if (raw.skills !== undefined) issues.push(...skillIssues(raw.skills));
  return issues;
}

/** Parses the config file's text; a JSON syntax error is an issue, not a throw. */
export function parseConfig(text: string): { config?: ProjectConfig; issues: Issue[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { issues: [{ path: [], message: `The config is not valid JSON: ${(error as Error).message}` }] };
  }
  const issues = configIssues(raw);
  return issues.length > 0 ? { issues } : { config: normalizeConfig(raw as ProjectConfig), issues };
}

/** Keeps only the keys Rowbly knows, in a stable order. */
function normalizeConfig(config: ProjectConfig): ProjectConfig {
  return {
    projectName: config.projectName,
    projectKey: config.projectKey,
    customFields: config.customFields.map(({ key, label, type, options }) =>
      options === undefined ? { key, label, type } : { key, label, type, options },
    ),
    stages: config.stages.map(({ key, label, enabled }) => ({ key, label, enabled })),
    ...(config.features === undefined
      ? {}
      : {
          features: Object.fromEntries(
            FEATURES.filter((f) => f in (config.features ?? {})).map((f) => [f, config.features?.[f]]),
          ),
        }),
    ...(config.skills === undefined
      ? {}
      : { skills: config.skills.map(({ name, harnesses }) => ({ name, harnesses: [...harnesses] })) }),
  };
}

export async function readConfig(paths: ProjectPaths): Promise<ProjectConfig> {
  const { config, issues } = parseConfig(await readFile(paths.configFile, "utf8"));
  throwIfIssues(`${paths.configFile} is invalid`, issues, "Fix the file by hand, then run `rowbly doctor`.");
  return config as ProjectConfig;
}

export async function writeConfig(paths: ProjectPaths, config: ProjectConfig): Promise<void> {
  await writeFileAtomic(paths.configFile, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`);
}
