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
import { coerceFieldValue, type FieldValue } from "../fields/fields.js";
import { readStoryFiles, rewriteStories } from "../story-files/story-files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

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

function typeIssues(type: string): Issue[] {
  return CUSTOM_FIELD_TYPES.includes(type as CustomFieldType)
    ? []
    : [{ path: ["type"], message: `Type must be one of ${CUSTOM_FIELD_TYPES.join(", ")}` }];
}

function requireField(config: ProjectConfig, key: string): CustomField {
  const field = config.customFields.find((f) => f.key === key.trim());

  if (!field) {
    const keys = config.customFields.map((f) => f.key).join(", ") || "none";

    throw new NotFoundError(`Custom field "${key}" not found. Fields: ${keys}`);
  }

  return field;
}

/** Every custom field of the project, in config order. */
export async function listCustomFields(ctx: ServiceContext = {}): Promise<CustomField[]> {
  return (await readConfig(await findProject(ctx))).customFields;
}

/** Adds a field to the project, and to every story with no value (`null`). */
export async function addCustomField(input: AddCustomFieldInput, ctx: ServiceContext = {}): Promise<CustomField> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const label = input.label.trim();
  const key = (input.key ?? toFieldKey(label)).trim();

  throwIfIssues("The custom field is invalid", [
    ...(label ? [] : [{ path: ["label"], message: "Label is required" }]),
    ...checkFieldKey(key),
    ...typeIssues(input.type),
    ...checkFieldOptions(input.type, input.options, ["options"]),
  ]);

  if (config.customFields.some((f) => f.key === key)) {
    throw new ConflictError(`Custom field "${key}" already exists`);
  }

  const field: CustomField = { key, label, type: input.type, ...(input.options && { options: input.options }) };
  const next = { ...config, customFields: [...config.customFields, field] };

  await writeConfig(paths, next);
  await rewriteStories(paths, next, (data) => (key in data ? false : { ...data, [key]: null }));

  return field;
}

/** Checks the input of an update, before the service reads the stories. */
function updateIssues(input: UpdateCustomFieldInput, field: CustomField, updated: CustomField): Issue[] {
  return [
    ...(input.label !== undefined && input.label.trim() === ""
      ? [{ path: ["label"], message: "Label is required" }]
      : []),
    ...(updated.key === field.key ? [] : checkFieldKey(updated.key, ["newKey"])),
    ...typeIssues(updated.type),
    ...checkFieldOptions(updated.type, updated.options, ["options"]),
  ];
}

type CoercedValue = ReturnType<typeof coerceFieldValue>;

/** Every existing value, coerced to the new definition. Throws before a write when one does not fit. */
async function coerceValues(
  paths: ProjectPaths,
  oldKey: string,
  updated: CustomField,
): Promise<ReadonlyMap<string, FieldValue>> {
  const results = (await readStoryFiles(paths))
    .filter((file) => oldKey in file.doc.data)
    .map((file): [string, CoercedValue] => [file.id, coerceFieldValue(updated, file.doc.data[oldKey])]);
  const valueIssues = results.flatMap(([id, result]) =>
    result.ok ? [] : [{ path: [id], message: `${id}: ${result.error}` }],
  );

  throwIfIssues(
    `Existing values do not fit the new definition: ${valueIssues.map((issue) => issue.message).join("; ")}`,
    valueIssues,
    "Change or clear those values first.",
  );

  return new Map(results.flatMap(([id, result]) => (result.ok ? [[id, result.value] as const] : [])));
}

/** The frontmatter with the value at `oldKey` moved to `newKey`. `writeStoryFile` puts the field keys in config order. */
function renameValue(
  data: Record<string, unknown>,
  oldKey: string,
  newKey: string,
  value: unknown,
): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(data).filter(([key]) => key !== oldKey));

  return { ...rest, [newKey]: value };
}

/** Changes a field. Existing values follow a new key or a new type. */
export async function updateCustomField(input: UpdateCustomFieldInput, ctx: ServiceContext = {}): Promise<CustomField> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const field = requireField(config, input.key);
  const oldKey = field.key;
  const newKey = input.newKey?.trim() ?? oldKey;
  const type = input.type ?? field.type;
  // Switching away from select drops the options; switching to it needs new ones.
  const options = input.options ?? (type === "select" ? field.options : undefined);
  const updated: CustomField = {
    key: newKey,
    label: input.label?.trim() ?? field.label,
    type,
    ...(options && { options }),
  };

  throwIfIssues("The custom field is invalid", updateIssues(input, field, updated));

  if (newKey !== oldKey && config.customFields.some((f) => f.key === newKey)) {
    throw new ConflictError(`Custom field "${newKey}" already exists`);
  }

  // Every existing value must fit the new definition before anything is written.
  const values = await coerceValues(paths, oldKey, updated);
  const next = { ...config, customFields: config.customFields.map((f) => (f === field ? updated : f)) };

  await writeConfig(paths, next);
  await rewriteStories(paths, next, (data, file) =>
    oldKey in data ? renameValue(data, oldKey, newKey, values.get(file.id) ?? null) : false,
  );

  return updated;
}

/** Removes a field from the project and its value from every story. */
export async function removeCustomField(input: { key: string }, ctx: ServiceContext = {}): Promise<CustomField> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const field = requireField(config, input.key);
  const next = { ...config, customFields: config.customFields.filter((f) => f !== field) };

  await writeConfig(paths, next);
  await rewriteStories(paths, next, (data) =>
    field.key in data ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== field.key)) : false,
  );

  return field;
}
