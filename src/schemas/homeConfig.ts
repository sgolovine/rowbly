import { z } from 'zod';
import { SlugSchema, VersionSchema } from './primitives';

/**
 * One Data Root that the Home Config knows (ADR-0031 §2). `path` is the Data Root folder itself
 * (the `.rowbly/` folder). Several entries may claim `default`; the schema keeps them, so that the
 * tools that read the list can report the conflict rather than lose an entry.
 */
export const KnownDataRootSchema = z.looseObject({
  label: z.string().min(1).optional(),
  path: z.string().min(1),
  default: z.boolean().optional(),
});
export type KnownDataRoot = z.infer<typeof KnownDataRootSchema>;

/**
 * `~/.rowblyrc.json`, the Home Config (ADR-0031): per-user settings shared by every Data Root on
 * the machine. A missing file, or one without `version`, means `{ version: 1 }`. Keys Rowbly does
 * not know are kept as they are, here and in each `dataRoots` entry.
 */
export const HomeConfigSchema = z.looseObject({
  version: VersionSchema.default(1),
  /** Me for every Data Root, a handle (the same form as Local State's `me`). */
  me: SlugSchema.optional(),
  dataRoots: z.array(KnownDataRootSchema).optional(),
});
export type HomeConfig = z.infer<typeof HomeConfigSchema>;
