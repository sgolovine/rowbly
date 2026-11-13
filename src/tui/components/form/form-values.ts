import type { ValidationError } from "../../../services/errors/errors.js";

/** How a form field is edited. */
export type FieldKind = "text" | "multiline" | "number" | "boolean" | "switch" | "date" | "select" | "multiselect";

export interface FormField {
  /** Key in the submitted values; also matched against `ValidationError` issue paths. */
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Choices for `select` and `multiselect`. */
  options?: readonly string[];
  /** What a choice shows instead of its value, e.g. a Stage's name for its key. */
  optionLabels?: Readonly<Record<string, string>>;
  /** A select opens a fuzzy picker over option values and labels instead of cycling. */
  searchable?: boolean;
  /** Separate search fields when a display label combines several values. Defaults to the label. */
  optionSearchText?: Readonly<Record<string, readonly string[]>>;
  /**
   * Fills this text field from another field's text when focus leaves that field, e.g. a key from a
   * name: `{ field: 'name', format: slugFromName }`. A value typed here is never replaced.
   */
  fillFrom?: { field: string; format(text: string): string };
  /** What a `switch` shows for its two states. Defaults to `On` and `Off`. */
  switchLabels?: { on: string; off: string };
}

/** text/multiline: string · number: number | null · boolean/switch: boolean · date: `YYYY-MM-DD` | null · select: string | null · multiselect: string[] */
export type FormValue = string | number | boolean | string[] | null;
export type FormValues = Record<string, FormValue>;

/** What a field holds while it is edited: text, a toggle, a choice or the picked options. */
export type Raw = string | boolean | string[] | null;
export type RawValues = Readonly<Record<string, Raw>>;

type Parsed = { readonly value: FormValue } | { readonly error: string };

interface Issue {
  readonly path?: unknown[];
  readonly message?: string;
}

interface NamedIssue {
  readonly name: unknown;
  readonly message: string;
}

/** Kinds edited in a `TextInput`, where letters are text rather than keys. */
export const TYPED_KINDS: readonly FieldKind[] = ["text", "number", "date"];

function toRaw(field: FormField, value: FormValue | undefined): Raw {
  switch (field.kind) {
    case "boolean":
    case "switch":
      return value === true;
    case "select":
      return typeof value === "string" ? value : null;
    case "multiselect":
      return Array.isArray(value) ? value : [];
    default:
      return value === null || value === undefined ? "" : String(value);
  }
}

/** The edited form of each field of `values`. */
export function rawValues(fields: readonly FormField[], values: FormValues): RawValues {
  return Object.fromEntries(fields.map((f) => [f.name, toRaw(f, values[f.name])]));
}

/** Whether a field holds a value that differs from its starting value. */
export function isDirty(fields: readonly FormField[], values: RawValues, initial: RawValues): boolean {
  return fields.some((f) => JSON.stringify(values[f.name]) !== JSON.stringify(initial[f.name]));
}

function isEmpty(raw: Raw): boolean {
  return raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0);
}

/** Converts raw input to a value, or returns an error message. */
function parse(field: FormField, raw: Raw): Parsed {
  if (field.required && isEmpty(raw)) {
    return { error: "required" };
  }

  if (field.kind === "number") {
    return parseNumber(raw);
  }

  if (field.kind === "date") {
    return parseDate(raw);
  }

  return { value: raw };
}

function parseNumber(raw: Raw): Parsed {
  const n = Number(raw);

  if (raw === "") {
    return { value: null };
  }

  return Number.isFinite(n) ? { value: n } : { error: "must be a number" };
}

function parseDate(raw: Raw): Parsed {
  const ok = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw));

  if (raw === "") {
    return { value: null };
  }

  return ok ? { value: raw } : { error: "must be a date (YYYY-MM-DD)" };
}

/** Parses each field: the values of the valid fields, and the error of each invalid field. */
export function parseAll(
  fields: readonly FormField[],
  current: RawValues,
): { parsed: FormValues; found: Record<string, string> } {
  const results = fields.map((f) => [f.name, parse(f, current[f.name] ?? null)] as const);

  return {
    parsed: Object.fromEntries(results.flatMap(([name, result]) => ("error" in result ? [] : [[name, result.value]]))),
    found: Object.fromEntries(results.flatMap(([name, result]) => ("error" in result ? [[name, result.error]] : []))),
  };
}

function isFieldName(fields: readonly FormField[], name: unknown): name is string {
  return typeof name === "string" && fields.some((f) => f.name === name);
}

/** Maps `ValidationError.details.issues` (zod issues) to fields by the first path segment. */
export function issuesByField(
  err: ValidationError,
  fields: readonly FormField[],
): { byField: Record<string, string>; rest: string[] } {
  const issues = (Array.isArray(err.details.issues) ? err.details.issues : []) as Issue[];
  const named: NamedIssue[] = issues.map((issue) => ({ name: issue.path?.[0], message: issue.message ?? "invalid" }));
  const onFields = named.filter((issue) => isFieldName(fields, issue.name));
  // The first issue of a field is the one it shows.
  const firsts = onFields.filter((issue, index) => onFields.findIndex((o) => o.name === issue.name) === index);
  const rest = named.filter((issue) => !isFieldName(fields, issue.name)).map((issue) => issue.message);

  return {
    byField: Object.fromEntries(firsts.map((issue) => [issue.name, issue.message])),
    rest: issues.length === 0 ? [err.message] : rest,
  };
}

/**
 * The values `fillFrom` gives at the start. A starting value that `fillFrom` would give counts as filled,
 * so a change of the source updates it.
 */
export function initialFilled(fields: readonly FormField[], initial: RawValues): Record<string, string> {
  return Object.fromEntries(fields.flatMap((f) => initialFill(f, initial)));
}

function initialFill(field: FormField, initial: RawValues): [string, string][] {
  const text = field.fillFrom ? String(initial[field.fillFrom.field] ?? "").trim() : "";

  return field.fillFrom && text && initial[field.name] === field.fillFrom.format(text)
    ? [[field.name, String(initial[field.name])]]
    : [];
}

/**
 * The values for the fields that take their text from `source`. A field gets a value only while it is
 * empty or still holds the value that `fillFrom` last gave it.
 */
export function fillsFrom(
  fields: readonly FormField[],
  values: RawValues,
  filled: Readonly<Record<string, string>>,
  source: string | undefined,
): Record<string, string> {
  const text = source === undefined ? "" : String(values[source] ?? "").trim();

  if (!text) {
    return {};
  }

  return Object.fromEntries(
    fields.flatMap((f) =>
      f.fillFrom !== undefined && f.fillFrom.field === source && isFillable(values[f.name] ?? "", filled[f.name])
        ? [[f.name, f.fillFrom.format(text)]]
        : [],
    ),
  );
}

function isFillable(current: Raw, filled: string | undefined): boolean {
  return current === "" || current === filled;
}
