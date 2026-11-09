import type { CustomField } from "../config/config.js";

/** A custom field's value in a story; `null` when it is not set. */
export type FieldValue = string | number | boolean | null;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return DATE.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Why `value` is not valid for `field`, or `undefined` when it is. */
export function fieldValueError(field: CustomField, value: unknown): string | undefined {
  if (value === null) return undefined;
  switch (field.type) {
    case "string":
      return typeof value === "string" ? undefined : `${field.label} must be text`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? undefined : `${field.label} must be a number`;
    case "boolean":
      return typeof value === "boolean" ? undefined : `${field.label} must be true or false`;
    case "url":
      return typeof value === "string" && URL.canParse(value) ? undefined : `${field.label} must be a URL`;
    case "date":
      return typeof value === "string" && isDate(value) ? undefined : `${field.label} must be a date (YYYY-MM-DD)`;
    case "select":
      return typeof value === "string" && field.options?.includes(value)
        ? undefined
        : `${field.label} must be one of ${field.options?.join(", ")}`;
  }
}

/**
 * Turns user input into a value for `field`. Text (from a CLI flag or a text input) is parsed by the
 * field's type, and `""` clears the field.
 */
export function coerceFieldValue(
  field: CustomField,
  value: unknown,
): { ok: true; value: FieldValue } | { ok: false; error: string } {
  let result = value === undefined ? null : value;
  if (typeof result === "string") {
    const text = result.trim();
    if (text === "") result = null;
    else if (field.type === "number" && !Number.isNaN(Number(text))) result = Number(text);
    else if (field.type === "boolean" && /^(true|yes|y|1)$/i.test(text)) result = true;
    else if (field.type === "boolean" && /^(false|no|n|0)$/i.test(text)) result = false;
    else if (field.type !== "string") result = text;
  } else if (field.type === "string" && (typeof result === "number" || typeof result === "boolean")) {
    result = String(result);
  }
  const error = fieldValueError(field, result);
  return error ? { ok: false, error } : { ok: true, value: result as FieldValue };
}
