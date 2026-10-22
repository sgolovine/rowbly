import { UsageError } from '../../core';

export function cancelled(): never {
  throw new UsageError('cancelled');
}
