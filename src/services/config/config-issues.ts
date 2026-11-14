import { checkFieldKey, checkFieldOptions, checkProjectKey, checkStageKey, isSkillName } from "./config-keys.js";
import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldType,
  FEATURES,
  type Feature,
  type Issue,
  SKILL_HARNESSES,
  type SkillHarness,
} from "./config-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Tells if a record before `index` has the same value at `key`. A `Set` of seen values gave the same result. */
function repeatsEarlier(items: readonly unknown[], index: number, key: string): boolean {
  const value = (items[index] as Record<string, unknown>)[key];

  return items.findIndex((item) => isRecord(item) && item[key] === value) < index;
}

function skillIssues(skills: unknown): Issue[] {
  if (!Array.isArray(skills)) {
    return [{ path: ["skills"], message: "skills must be an array" }];
  }

  return (skills as unknown[]).flatMap((skill, index, all) => oneSkillIssues(skill, index, all));
}

function oneSkillIssues(skill: unknown, index: number, skills: readonly unknown[]): Issue[] {
  const path = ["skills", index];

  if (!isRecord(skill)) {
    return [{ path, message: "A skill must be an object" }];
  }

  return [
    ...skillNameIssues(skill.name, index, skills, path),
    ...harnessIssues(skill.harnesses, [...path, "harnesses"]),
  ];
}

function skillNameIssues(name: unknown, index: number, skills: readonly unknown[], path: Issue["path"]): Issue[] {
  const namePath = [...path, "name"];

  if (typeof name !== "string") {
    return [{ path: namePath, message: "name is required" }];
  }

  const invalid = isSkillName(name)
    ? []
    : [
        {
          path: namePath,
          message: `Skill name "${name}" must be lowercase letters and digits, separated by single hyphens`,
        },
      ];
  const duplicate = repeatsEarlier(skills, index, "name")
    ? [{ path: namePath, message: `Duplicate skill "${name}"` }]
    : [];

  return [...invalid, ...duplicate];
}

function harnessIssues(harnesses: unknown, path: Issue["path"]): Issue[] {
  if (!Array.isArray(harnesses)) {
    return [{ path, message: "harnesses must be an array" }];
  }

  if (harnesses.length === 0) {
    return [{ path, message: "A skill needs at least one harness" }];
  }

  return (harnesses as unknown[]).flatMap((harness, index, all) => oneHarnessIssues(harness, index, all, path));
}

function oneHarnessIssues(
  harness: unknown,
  index: number,
  harnesses: readonly unknown[],
  path: Issue["path"],
): Issue[] {
  if (!SKILL_HARNESSES.includes(harness as SkillHarness)) {
    return [{ path: [...path, index], message: `Unknown harness "${harness}"` }];
  }

  if (harnesses.indexOf(harness) < index) {
    return [{ path: [...path, index], message: `Duplicate harness "${harness}"` }];
  }

  return [];
}

function projectNameIssues(name: unknown): Issue[] {
  return nonEmptyString(name) ? [] : [{ path: ["projectName"], message: "projectName is required" }];
}

function projectKeyIssues(key: unknown): Issue[] {
  return typeof key === "string" ? checkProjectKey(key) : [{ path: ["projectKey"], message: "projectKey is required" }];
}

function labelIssues(label: unknown, path: Issue["path"]): Issue[] {
  return nonEmptyString(label) ? [] : [{ path: [...path, "label"], message: "label is required" }];
}

function customFieldsIssues(fields: unknown): Issue[] {
  if (!Array.isArray(fields)) {
    return [{ path: ["customFields"], message: "customFields must be an array" }];
  }

  return (fields as unknown[]).flatMap((field, index, all) => customFieldIssues(field, index, all));
}

function customFieldIssues(field: unknown, index: number, fields: readonly unknown[]): Issue[] {
  const path = ["customFields", index];

  if (!isRecord(field)) {
    return [{ path, message: "A custom field must be an object" }];
  }

  return [
    ...fieldKeyIssues(field.key, index, fields, path),
    ...labelIssues(field.label, path),
    ...fieldTypeIssues(field, path),
  ];
}

function fieldKeyIssues(key: unknown, index: number, fields: readonly unknown[], path: Issue["path"]): Issue[] {
  const keyPath = [...path, "key"];

  if (typeof key !== "string") {
    return [{ path: keyPath, message: "key is required" }];
  }

  const duplicate = repeatsEarlier(fields, index, "key")
    ? [{ path: keyPath, message: `Duplicate field key "${key}"` }]
    : [];

  return [...checkFieldKey(key, keyPath), ...duplicate];
}

function fieldTypeIssues(field: Record<string, unknown>, path: Issue["path"]): Issue[] {
  if (!CUSTOM_FIELD_TYPES.includes(field.type as CustomFieldType)) {
    return [{ path: [...path, "type"], message: `type must be one of ${CUSTOM_FIELD_TYPES.join(", ")}` }];
  }

  if (
    field.options !== undefined &&
    (!Array.isArray(field.options) || field.options.some((option) => typeof option !== "string"))
  ) {
    return [{ path: [...path, "options"], message: "options must be an array of strings" }];
  }

  return checkFieldOptions(field.type as CustomFieldType, field.options as string[] | undefined, [...path, "options"]);
}

function stagesIssues(stages: unknown): Issue[] {
  if (!Array.isArray(stages)) {
    return [{ path: ["stages"], message: "stages must be an array" }];
  }

  const empty = stages.length === 0 ? [{ path: ["stages"], message: "A project needs at least one stage" }] : [];

  return [...empty, ...(stages as unknown[]).flatMap((stage, index, all) => stageIssues(stage, index, all))];
}

function stageIssues(stage: unknown, index: number, stages: readonly unknown[]): Issue[] {
  const path = ["stages", index];

  if (!isRecord(stage)) {
    return [{ path, message: "A stage must be an object" }];
  }

  const enabled =
    typeof stage.enabled === "boolean"
      ? []
      : [{ path: [...path, "enabled"], message: "enabled must be true or false" }];

  return [...stageKeyIssues(stage.key, index, stages, path), ...labelIssues(stage.label, path), ...enabled];
}

function stageKeyIssues(key: unknown, index: number, stages: readonly unknown[], path: Issue["path"]): Issue[] {
  const keyPath = [...path, "key"];

  if (typeof key !== "string") {
    return [{ path: keyPath, message: "key is required" }];
  }

  const duplicate = repeatsEarlier(stages, index, "key")
    ? [{ path: keyPath, message: `Duplicate stage key "${key}"` }]
    : [];

  return [...checkStageKey(key, keyPath), ...duplicate];
}

function featuresIssues(features: unknown): Issue[] {
  if (features === undefined) {
    return [];
  }

  if (!isRecord(features)) {
    return [{ path: ["features"], message: "features must be an object" }];
  }

  return Object.entries(features).flatMap(([name, value]) => featureIssues(name, value));
}

function featureIssues(name: string, value: unknown): Issue[] {
  if (!FEATURES.includes(name as Feature)) {
    return [{ path: ["features", name], message: `Unknown feature "${name}"` }];
  }

  if (typeof value !== "boolean") {
    return [{ path: ["features", name], message: `${name} must be true or false` }];
  }

  return [];
}

/** Checks only the shape of the factory section, so that a bad section does not stop the board. */
function factoryIssues(factory: unknown): Issue[] {
  return factory === undefined || isRecord(factory)
    ? []
    : [{ path: ["factory"], message: "factory must be an object" }];
}

/** Every problem with a parsed config file; none means `raw` is a valid `ProjectConfig`. */
export function configIssues(raw: unknown): Issue[] {
  if (!isRecord(raw)) {
    return [{ path: [], message: "The config must be a JSON object" }];
  }

  return [
    ...projectNameIssues(raw.projectName),
    ...projectKeyIssues(raw.projectKey),
    ...customFieldsIssues(raw.customFields),
    ...stagesIssues(raw.stages),
    ...featuresIssues(raw.features),
    ...(raw.skills === undefined ? [] : skillIssues(raw.skills)),
    ...factoryIssues(raw.factory),
  ];
}
