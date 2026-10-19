// Narrows the Story form's core values, so a malformed value fails validation instead of clearing
// data (CQ-79).
import { ValidationError } from '../../../core';
import { type Priority, PrioritySchema } from '../../../schemas';
import type { FormValue } from '../../components';
import { NONE } from './shared';

function invalid(field: string, message: string): ValidationError {
  return new ValidationError(`${field}: ${message}`, { details: { issues: [{ path: [field], message }] } });
}

/** The chosen Priority, or `null` for none; anything else is invalid. */
export function priorityValue(value: FormValue | undefined): Priority | null {
  if (value === null || value === undefined || value === '' || value === NONE) return null;
  const parsed = PrioritySchema.safeParse(value);
  if (!parsed.success) throw invalid('priority', `must be one of ${PrioritySchema.options.join(', ')}`);
  return parsed.data;
}
