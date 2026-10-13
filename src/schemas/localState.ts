import { z } from 'zod';
import { SlugSchema, VersionSchema } from './primitives';

/** `local.json`: per-developer, never committed. A missing file means `{ version: 1 }`. */
export const LocalStateSchema = z.object({
  version: VersionSchema,
  workspace: SlugSchema.optional(),
  board: SlugSchema.optional(),
  me: SlugSchema.optional(),
});
export type LocalState = z.infer<typeof LocalStateSchema>;
