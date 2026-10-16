import { ValidationError } from '../core';
import type { Stage } from '../schemas';

/** Throws unless `key` is one of the Board's Stages. */
export function checkStage(stages: readonly Stage[], key: string): void {
  if (stages.some((s) => s.key === key)) return;
  const valid = stages.map((s) => s.key);
  throw new ValidationError(`unknown Stage "${key}"`, {
    details: { issues: [{ path: ['stage'], message: `unknown Stage "${key}"` }], validStages: valid },
    hint: `valid Stages: ${valid.join(', ')}`,
  });
}
