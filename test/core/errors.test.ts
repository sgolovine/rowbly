import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  DataIntegrityError,
  DataRootNotFoundError,
  exitCodeFor,
  NotFoundError,
  RowblyError,
  UsageError,
  ValidationError,
} from '../../src/core';

describe('errors', () => {
  it.each([
    [new UsageError('x'), 'USAGE', 2],
    [new ValidationError('x'), 'VALIDATION', 2],
    [new NotFoundError('x'), 'NOT_FOUND', 3],
    [new ConflictError('x'), 'CONFLICT', 4],
    [new DataRootNotFoundError(), 'NO_DATA_ROOT', 5],
    [new DataIntegrityError('x'), 'DATA_INTEGRITY', 6],
  ] as const)('%s has code %s and exit %i', (err, code, exit) => {
    expect(err).toBeInstanceOf(RowblyError);
    expect(err.code).toBe(code);
    expect(err.exitCode).toBe(exit);
    expect(exitCodeFor(err)).toBe(exit);
  });

  it('treats anything else as INTERNAL (exit 1)', () => {
    expect(exitCodeFor(new Error('boom'))).toBe(1);
    expect(exitCodeFor('boom')).toBe(1);
  });
});
