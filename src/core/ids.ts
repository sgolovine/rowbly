import { UsageError } from './errors';

/** Board, Stage and Custom Field ids, and handles such as Me (1–40 chars). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 40;
/** Board key prefix, unique across the Data Root. */
export const KEY_PREFIX_RE = /^[A-Z][A-Z0-9]{1,9}$/;
/** Canonical (upper-case) Story Key, e.g. `WEB-42`. */
export const STORY_KEY_RE = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]*)$/;
/** Labels use the slug format. */
export const LABEL_RE = SLUG_RE;

export function isSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG_RE.test(value);
}

/** A name with accents stripped, split into ASCII alphanumeric words. */
function nameWords(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** Appends the lowest free number to `base` (`web` → `web-2`), keeping the result within `max` chars. */
function firstFree(base: string, taken: ReadonlySet<string>, max: number, join: string): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `${join}${n}`;
    const candidate = `${base.slice(0, max - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Infers a Board id from its name: `slugFromName('My Web App')` → `my-web-app`, numbered when taken. */
export function slugFromName(name: string, taken: ReadonlySet<string> = new Set()): string {
  const base = nameWords(name).join('-').toLowerCase().slice(0, SLUG_MAX_LENGTH).replace(/-+$/, '') || 'board';
  return firstFree(base, taken, SLUG_MAX_LENGTH, '-');
}

/**
 * Infers a Board key prefix from its name: the initials of a multi-word name (`My Web App` → `MWA`),
 * otherwise the first three characters (`Rowbly` → `ROW`); numbered when taken (`ROW2`).
 */
export function keyPrefixFromName(name: string, taken: ReadonlySet<string> = new Set()): string {
  // A key prefix starts with a letter, so anything before the first letter is dropped.
  const words = nameWords(name.toUpperCase())
    .join(' ')
    .replace(/^[^A-Z]+/, '')
    .split(' ')
    .filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  base = base.slice(0, 10);
  if (base.length < 2) base = `${base}BRD`.slice(0, 3);
  return firstFree(base, taken, 10, '');
}

export interface StoryKeyParts {
  key: string;
  prefix: string;
  n: number;
}

export function formatStoryKey(prefix: string, n: number): string {
  return `${prefix}-${n}`;
}

/** Parses a case-insensitive Story Key: `parseStoryKey('web-42')` → `{ key: 'WEB-42', prefix: 'WEB', n: 42 }`. */
export function parseStoryKey(input: string): StoryKeyParts {
  const key = input.trim().toUpperCase();
  const match = STORY_KEY_RE.exec(key);
  if (!match) throw new UsageError(`invalid Story Key "${input}"`, { hint: 'expected e.g. WEB-42' });
  const [, prefix = '', n = ''] = match;
  return { key, prefix, n: Number(n) };
}

export function isStoryKey(input: string): boolean {
  return STORY_KEY_RE.test(input.trim().toUpperCase());
}
