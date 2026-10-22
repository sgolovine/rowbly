import { UsageError } from '../../core';

export function parseNumber(flag: string, value: string): number {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n)) throw new UsageError(`${flag} must be a number, got "${value}"`);
  return n;
}
