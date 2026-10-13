import { z } from 'zod';
import {
  isIsoDate,
  isTimestamp,
  KEY_PREFIX_RE,
  LABEL_RE,
  SLUG_MAX_LENGTH,
  SLUG_RE,
  STORY_KEY_RE,
  TASK_ID_RE,
} from '../core';

export const SlugSchema = z.string().max(SLUG_MAX_LENGTH).regex(SLUG_RE, 'must be a lower-kebab-case slug');
export type Slug = z.infer<typeof SlugSchema>;

export const KeyPrefixSchema = z
  .string()
  .regex(KEY_PREFIX_RE, 'must be 2–10 upper-case letters or digits, starting with a letter');
export type KeyPrefix = z.infer<typeof KeyPrefixSchema>;

export const StoryKeySchema = z.string().regex(STORY_KEY_RE, 'must be a Story Key such as WEB-42');
export type StoryKey = z.infer<typeof StoryKeySchema>;

export const TaskIdSchema = z.string().regex(TASK_ID_RE, 'must be a Task id such as WEB-42.1');
export type TaskId = z.infer<typeof TaskIdSchema>;

export const LabelSchema = z.string().max(SLUG_MAX_LENGTH).regex(LABEL_RE, 'must be lower-kebab-case');
export type Label = z.infer<typeof LabelSchema>;

export const TimestampSchema = z.string().refine(isTimestamp, 'must be an ISO-8601 UTC timestamp with milliseconds');
export type Timestamp = z.infer<typeof TimestampSchema>;

export const IsoDateSchema = z.string().refine(isIsoDate, 'must be a date in YYYY-MM-DD format');
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** Every persisted root object carries `version: 1`. */
export const VersionSchema = z.literal(1);

/** Adds an issue for each repeated `key` in a list. */
export function uniqueKeys<T>(label: string, keyOf: (item: T) => string) {
  return (items: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const key = keyOf(item);
      if (seen.has(key)) ctx.addIssue({ code: 'custom', message: `duplicate ${label} "${key}"`, path: [index] });
      seen.add(key);
    });
  };
}
