/** The default instant used by fixtures and `fixedClock()`. */
export const FIXED_NOW = '2026-10-12T17:21:07.000Z';

export interface FixedClock {
  now(): Date;
  /** Moves the clock forward. */
  advance(ms: number): void;
  set(iso: string): void;
}

/** A clock that only moves when told to; plug `now` into `RowblyContext`. */
export function fixedClock(start: string = FIXED_NOW): FixedClock {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
    set: (iso) => {
      current = new Date(iso).getTime();
    },
  };
}

/** A deterministic `newId` producing 8-character ids: `id000001`, `id000002`, … */
export function fixedIds(prefix = 'id'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${String(n).padStart(8 - prefix.length, '0')}`;
  };
}
