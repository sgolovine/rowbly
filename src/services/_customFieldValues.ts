// Custom Field value coercion and validation, shared by the fields service (stripping values) and
// the stories service (WP05). The exported signatures are frozen for WP05.
import { isIsoDate, ValidationError } from '../core';
import type { CustomFieldDef, CustomFieldValue, Slug } from '../schemas';

export interface FieldValueIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Turns a command-line string into a typed value for `def`: `true`/`false` for booleans, numbers,
 * IsoDates, http(s) URLs, and comma-separated values for multiselect. Throws `ValidationError` when
 * the result does not fit the field (type, options, `integer`, `min`, `max`).
 */
export function coerceFieldInput(def: CustomFieldDef, raw: string): CustomFieldValue {
  const value = coerce(def, raw);
  const error = fieldValueError(def, value);
  if (error) throw invalidValue(def, `"${raw}" ${error}`);
  return value;
}

/**
 * Checks Custom Field values against the effective definitions: every key must be a field, every
 * value must fit its field, and with `requireRequired` every required field must have a value.
 * String values for non-text fields are coerced as on the command line. Returns the typed values;
 * throws one `ValidationError` listing every issue (paths `['customFields', key]`).
 */
export function validateFieldValues(
  defs: readonly CustomFieldDef[],
  values: Record<Slug, CustomFieldValue>,
  { requireRequired }: { requireRequired: boolean },
): Record<Slug, CustomFieldValue> {
  const issues: FieldValueIssue[] = [];
  const result: Record<Slug, CustomFieldValue> = {};
  for (const [key, given] of Object.entries(values)) {
    const def = defs.find((d) => d.key === key);
    if (!def) {
      issues.push({ path: ['customFields', key], message: `unknown Custom Field "${key}"` });
      continue;
    }
    const value = typeof given === 'string' ? coerce(def, given) : given;
    const error = fieldValueError(def, value);
    if (error) issues.push({ path: ['customFields', key], message: `${def.name}: ${error}` });
    else result[key] = value;
  }
  if (requireRequired) {
    for (const def of defs) {
      if (def.required && values[def.key] === undefined) {
        issues.push({ path: ['customFields', def.key], message: `${def.name} is required` });
      }
    }
  }
  if (issues.length > 0) {
    throw new ValidationError(issues.map((issue) => issue.message).join('; '), { details: { issues } });
  }
  return result;
}

/** Why `value` does not fit `def`, or `null` when it does. */
export function fieldValueError(def: CustomFieldDef, value: CustomFieldValue): string | null {
  switch (def.type) {
    case 'text':
      return typeof value === 'string' ? null : 'must be text';
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
      if (def.integer && !Number.isInteger(value)) return 'must be a whole number';
      if (def.min !== undefined && value < def.min) return `must be at least ${def.min}`;
      if (def.max !== undefined && value > def.max) return `must be at most ${def.max}`;
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'date':
      return typeof value === 'string' && isIsoDate(value) ? null : 'must be a date in YYYY-MM-DD format';
    case 'url':
      return typeof value === 'string' && isHttpUrl(value) ? null : 'must be an absolute http(s) URL';
    case 'select':
      return typeof value === 'string' && def.options.includes(value)
        ? null
        : `must be one of: ${def.options.join(', ')}`;
    case 'multiselect': {
      if (!Array.isArray(value)) return `must be a list of: ${def.options.join(', ')}`;
      const unknown = value.filter((option) => !def.options.includes(option));
      if (unknown.length > 0) return `unknown option(s) ${unknown.join(', ')}; expected: ${def.options.join(', ')}`;
      if (new Set(value).size !== value.length) return 'must not repeat an option';
      return null;
    }
  }
}

function coerce(def: CustomFieldDef, raw: string): CustomFieldValue {
  const text = raw.trim();
  switch (def.type) {
    case 'text':
      return raw;
    case 'number':
      return text === '' ? Number.NaN : Number(text);
    case 'boolean':
      if (text.toLowerCase() === 'true') return true;
      if (text.toLowerCase() === 'false') return false;
      return text;
    case 'multiselect':
      return [
        ...new Set(
          text
            .split(',')
            .map((option) => option.trim())
            .filter(Boolean),
        ),
      ];
    default:
      return text;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function invalidValue(def: CustomFieldDef, message: string): ValidationError {
  return new ValidationError(`${def.name}: ${message}`, {
    details: { issues: [{ path: ['customFields', def.key], message }] },
  });
}
