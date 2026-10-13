import { z } from 'zod';
import { SlugSchema, TimestampSchema, VersionSchema } from './primitives';

/** `epics/<id>.json`. Its Stories are found by scanning for `epicId` (ADR-0004). */
export const EpicSchema = z.object({
  version: VersionSchema,
  id: SlugSchema,
  name: z.string().min(1),
  description: z.string(),
  closed: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Epic = z.infer<typeof EpicSchema>;
