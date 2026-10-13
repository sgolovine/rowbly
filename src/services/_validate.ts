import type { ZodType } from 'zod';
import { ValidationError } from '../core';

/** Parses service input with `schema`; a failure is a `ValidationError` carrying the zod issues. */
export function validInput<T>(schema: ZodType<T>, what: string, value: T): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const [first] = result.error.issues;
  const where = first?.path.length ? `${first.path.join('.')}: ` : '';
  throw new ValidationError(`invalid ${what}: ${where}${first?.message ?? 'invalid input'}`, {
    details: { issues: result.error.issues },
  });
}

/** `plural(1, 'story')` → `1 story`; `plural(2, 'story')` → `2 stories`. */
export function plural(n: number, noun: string): string {
  if (n === 1) return `${n} ${noun}`;
  return `${n} ${noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
}
