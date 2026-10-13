import { describe, expect, it } from 'vitest';
import {
  isIsoDate,
  isTimestamp,
  rankAfter,
  rankBefore,
  rankBetween,
  ranksBetween,
  toIsoDate,
  toTimestamp,
} from '../../src/core';

describe('rank', () => {
  it('orders generated keys lexicographically', () => {
    const first = rankAfter(null);
    const second = rankAfter(first);
    const middle = rankBetween(first, second);
    const top = rankBefore(first);
    expect([second, first, middle, top].sort()).toEqual([top, first, middle, second]);
  });

  it('spreads many keys between two bounds', () => {
    const keys = ranksBetween(null, null, 5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe('time', () => {
  it('formats timestamps and dates in UTC', () => {
    const date = new Date('2026-10-12T17:21:07Z');
    expect(toTimestamp(date)).toBe('2026-10-12T17:21:07.000Z');
    expect(toIsoDate(date)).toBe('2026-10-12');
  });

  it('validates IsoDates against the calendar', () => {
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-1-01')).toBe(false);
  });

  it('requires milliseconds and Z in timestamps', () => {
    expect(isTimestamp('2026-10-12T17:21:07.000Z')).toBe(true);
    expect(isTimestamp('2026-10-12T17:21:07Z')).toBe(false);
    expect(isTimestamp('2026-10-12T17:21:07.000+01:00')).toBe(false);
    expect(isTimestamp('2026-13-12T17:21:07.000Z')).toBe(false);
  });
});
