import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/** A Rank strictly between `before` and `after`; `null` means an open end. */
export function rankBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

/** The Rank for a Story placed below `last` (the bottom of a Stage). */
export function rankAfter(last: string | null): string {
  return generateKeyBetween(last, null);
}

/** The Rank for a Story placed above `first` (the top of a Stage). */
export function rankBefore(first: string | null): string {
  return generateKeyBetween(null, first);
}

/** `count` evenly spread Ranks between `before` and `after`, for re-ranking a whole Stage. */
export function ranksBetween(before: string | null, after: string | null, count: number): string[] {
  return generateNKeysBetween(before, after, count);
}
