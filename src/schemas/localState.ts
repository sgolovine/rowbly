import { z } from 'zod';
import { PluginBagsSchema, SlugSchema, VersionSchema } from './primitives';

/** `local.json`: per-developer, never committed. A missing file means `{ version: 1 }`. */
export const LocalStateSchema = z.object({
  version: VersionSchema,
  board: SlugSchema.optional(),
  me: SlugSchema.optional(),
  plugins: PluginBagsSchema.optional(),
});
export type LocalState = z.infer<typeof LocalStateSchema>;
