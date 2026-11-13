import {
  CUSTOM_FIELD_TYPES,
  type CustomField,
  type CustomFieldType,
  checkFieldKey,
  checkFieldOptions,
  type Issue,
  type ProjectConfig,
  readConfig,
  throwIfIssues,
  toFieldKey,
  writeConfig,
} from "../config/config.js";
import { ConflictError, NotFoundError } from "../errors/errors.js";
import { coerceFieldValue } from "../fields/fields.js";
import { readStoryFiles, rewriteStories } from "../story-files/story-files.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

export interface AddCustomFieldInput {
  label: string;
  type: CustomFieldType;
  /** Defaults to the label in snake_case. */
  key?: string;
  /** Required for a `select` field. */
  options?: string[];
}

export interface UpdateCustomFieldInput {
  key: string;
  /** Renames the field in the config and in every story. */
  newKey?: string;
  label?: string;
  /** Existing values are converted to the new type; the update fails if one cannot be. */
  type?: CustomFieldType;
  options?: string[];
}

function checkType(type: string, issues: Issue[]): void {
  if (!CUSTOM_FIELD_TYPES.includes(type as CustomFieldType)) {
    issues.push({ path: ["type"], message: `Type must be one of ${CUSTOM_FIELD_TYPES.join(", ")}` });
  }
}

function requireField(config: ProjectConfig, key: string): CustomField {
  const field = config.customFields.find((f) => f.key === key.trim());
  if (!field) {
    const keys = config.customFields.map((f) => f.key).join(", ") || "none";
    throw new NotFoundError(`Custom field "${key}" not found. Fields: ${keys}`);
  }
  return field;
}

export async function listCustomFields(ctx: ServiceContext = {}): Promise<CustomField[]> {
  return (await readConfig(await findProject(ctx))).customFields;
}

/** Adds a field to the project, and to every story with no value (`null`). */
export async function addCustomField(input: AddCustomFieldInput, ctx: ServiceContext = {}): Promise<CustomField> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const label = input.label.trim();
  const key = (input.key ?? toFieldKey(label)).trim();
  const issues: Issue[] = [];
  if (!label) issues.push({ path: ["label"], message: "Label is required" });
  issues.push(...checkFieldKey(key));
  checkType(input.type, issues);
  issues.push(...checkFieldOptions(input.type, input.options, ["options"]));
  throwIfIssues("The custom field is invalid", issues);
  if (config.customFields.some((f) => f.key === key)) throw new ConflictError(`Custom field "${key}" already exists`);

  const field: CustomField = { key, label, type: input.type, ...(input.options && { options: input.options }) };
  config.customFields.push(field);
  await writeConfig(paths, config);
  await rewriteStories(paths, config, (data) => {
    if (key in data) return false;
    data[key] = null;
    return true;
  });
  return field;
}

export async function updateCustomField(input: UpdateCustomFieldInput, ctx: ServiceContext = {}): Promise<CustomField> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const field = requireField(config, input.key);
  const oldKey = field.key;
  const newKey = input.newKey?.trim() ?? oldKey;
  const type = input.type ?? field.type;
  // Switching away from select drops the options; switching to it needs new ones.
  const options = input.options ?? (type === "select" ? field.options : undefined);
  const issues: Issue[] = [];
  if (input.label !== undefined && input.label.trim() === "") {
    issues.push({ path: ["label"], message: "Label is required" });
  }
  if (newKey !== oldKey) issues.push(...checkFieldKey(newKey, ["newKey"]));
  checkType(type, issues);
  issues.push(...checkFieldOptions(type, options, ["options"]));
  throwIfIssues("The custom field is invalid", issues);
  if (newKey !== oldKey && config.customFields.some((f) => f.key === newKey)) {
    throw new ConflictError(`Custom field "${newKey}" already exists`);
  }

  const updated: CustomField = {
    key: newKey,
    label: input.label?.trim() ?? field.label,
    type,
    ...(options && { options }),
  };

  // Every existing value must fit the new definition before anything is written.
  const values = new Map<string, unknown>();
  const valueIssues: Issue[] = [];
  for (const file of await readStoryFiles(paths)) {
    if (!(oldKey in file.doc.data)) continue;
    const result = coerceFieldValue(updated, file.doc.data[oldKey]);
    if (result.ok) values.set(file.id, result.value);
    else valueIssues.push({ path: [file.id], message: `${file.id}: ${result.error}` });
  }
  throwIfIssues(
    `Existing values do not fit the new definition: ${valueIssues.map((issue) => issue.message).join("; ")}`,
    valueIssues,
    "Change or clear those values first.",
  );

  config.customFields[config.customFields.indexOf(field)] = updated;
  await writeConfig(paths, config);
  await rewriteStories(paths, config, (data, file) => {
    if (!(oldKey in data)) return false;
    delete data[oldKey];
    data[newKey] = values.get(file.id) ?? null;
    return true;
  });
  return updated;
}

/** Removes a field from the project and its value from every story. */
export async function removeCustomField(input: { key: string }, ctx: ServiceContext = {}): Promise<CustomField> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const field = requireField(config, input.key);
  config.customFields.splice(config.customFields.indexOf(field), 1);
  await writeConfig(paths, config);
  await rewriteStories(paths, config, (data) => {
    if (!(field.key in data)) return false;
    delete data[field.key];
    return true;
  });
  return field;
}
