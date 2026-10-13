import { UsageError } from './errors';

/** Workspace, Board, Epic, Stage, Custom Field and Assignee ids (1–40 chars). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 40;
/** Board key prefix, unique across the Data Root. */
export const KEY_PREFIX_RE = /^[A-Z][A-Z0-9]{1,9}$/;
/** Canonical (upper-case) Story Key, e.g. `WEB-42`. */
export const STORY_KEY_RE = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]*)$/;
/** Canonical Task id, e.g. `WEB-42.3`. */
export const TASK_ID_RE = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]*)\.([1-9][0-9]*)$/;
/** Labels use the slug format. */
export const LABEL_RE = SLUG_RE;

export function isSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG_RE.test(value);
}

export interface StoryKeyParts {
  key: string;
  prefix: string;
  n: number;
}

export interface TaskIdParts {
  id: string;
  storyKey: string;
  prefix: string;
  n: number;
  taskNumber: number;
}

export function formatStoryKey(prefix: string, n: number): string {
  return `${prefix}-${n}`;
}

export function formatTaskId(storyKey: string, taskNumber: number): string {
  return `${storyKey}.${taskNumber}`;
}

/** Parses a case-insensitive Story Key: `parseStoryKey('web-42')` → `{ key: 'WEB-42', prefix: 'WEB', n: 42 }`. */
export function parseStoryKey(input: string): StoryKeyParts {
  const key = input.trim().toUpperCase();
  const match = STORY_KEY_RE.exec(key);
  if (!match) throw new UsageError(`invalid Story Key "${input}"`, { hint: 'expected e.g. WEB-42' });
  const [, prefix = '', n = ''] = match;
  return { key, prefix, n: Number(n) };
}

/** Parses a case-insensitive Task id: `parseTaskId('web-42.3')` → `{ id: 'WEB-42.3', storyKey: 'WEB-42', … }`. */
export function parseTaskId(input: string): TaskIdParts {
  const id = input.trim().toUpperCase();
  const match = TASK_ID_RE.exec(id);
  if (!match) throw new UsageError(`invalid Task id "${input}"`, { hint: 'expected e.g. WEB-42.1' });
  const [, prefix = '', n = '', taskNumber = ''] = match;
  return {
    id,
    storyKey: formatStoryKey(prefix, Number(n)),
    prefix,
    n: Number(n),
    taskNumber: Number(taskNumber),
  };
}

export function isStoryKey(input: string): boolean {
  return STORY_KEY_RE.test(input.trim().toUpperCase());
}

export function isTaskId(input: string): boolean {
  return TASK_ID_RE.test(input.trim().toUpperCase());
}
