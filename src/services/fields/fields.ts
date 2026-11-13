import type { CustomField, CustomFieldType } from "../config/config.js";

/** A custom field's value in a story; `null` when it is not set. */
export type FieldValue = string | number | boolean | null;

interface ValueRule {
  readonly accepts: (value: unknown, field: CustomField) => boolean;
  readonly message: (field: CustomField) => string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The check and the error text for each field type. */
const VALUE_RULES: Readonly<Record<CustomFieldType, ValueRule>> = {
  string: {
    accepts: (value) => typeof value === "string",
    message: (field) => `${field.label} must be text`,
  },
  number: {
    accepts: (value) => typeof value === "number" && Number.isFinite(value),
    message: (field) => `${field.label} must be a number`,
  },
  boolean: {
    accepts: (value) => typeof value === "boolean",
    message: (field) => `${field.label} must be true or false`,
  },
  url: {
    accepts: (value) => typeof value === "string" && URL.canParse(value),
    message: (field) => `${field.label} must be a URL`,
  },
  date: {
    accepts: (value) => typeof value === "string" && isDate(value),
    message: (field) => `${field.label} must be a date (YYYY-MM-DD)`,
  },
  select: {
    accepts: (value, field) => typeof value === "string" && field.options?.includes(value) === true,
    message: (field) => `${field.label} must be one of ${field.options?.join(", ")}`,
  },
};

function isDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);

  return DATE.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Why `value` is not valid for `field`, or `undefined` when it is. */
export function fieldValueError(field: CustomField, value: unknown): string | undefined {
  const rule = VALUE_RULES[field.type];

  if (value === null || rule.accepts(value, field)) {
    return undefined;
  }

  return rule.message(field);
}

/** Parses text by the field type. A text that does not parse stays text, so the check can name the problem. */
function coerceText(field: CustomField, text: string): unknown {
  if (text === "") {
    return null;
  }

  if (field.type === "number" && !Number.isNaN(Number(text))) {
    return Number(text);
  }

  if (field.type === "boolean" && /^(true|yes|y|1)$/i.test(text)) {
    return true;
  }

  if (field.type === "boolean" && /^(false|no|n|0)$/i.test(text)) {
    return false;
  }

  return text;
}

function coerceValue(field: CustomField, value: unknown): unknown {
  if (typeof value === "string") {
    return field.type === "string" && value.trim() !== "" ? value : coerceText(field, value.trim());
  }

  if (field.type === "string" && (typeof value === "number" || typeof value === "boolean")) {
    return String(value);
  }

  return value === undefined ? null : value;
}

/**
 * Turns user input into a value for `field`. Text (from a CLI flag or a text input) is parsed by the
 * field's type, and `""` clears the field.
 */
export function coerceFieldValue(
  field: CustomField,
  value: unknown,
): { ok: true; value: FieldValue } | { ok: false; error: string } {
  const result = coerceValue(field, value);
  const error = fieldValueError(field, result);

  return error ? { ok: false, error } : { ok: true, value: result as FieldValue };
}
