/** ISO-8601 UTC with milliseconds, e.g. `2026-10-12T17:21:07.000Z`. */
export const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** `YYYY-MM-DD`. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toTimestamp(date: Date): string {
  return date.toISOString();
}

/** The UTC calendar date of `date` as an IsoDate. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** True for a well-formed `YYYY-MM-DD` that names a real calendar day. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && toIsoDate(date) === value;
}

export function isTimestamp(value: string): boolean {
  if (!TIMESTAMP_RE.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && toTimestamp(date) === value;
}
