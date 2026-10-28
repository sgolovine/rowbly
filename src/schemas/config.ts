import { z } from 'zod';
import { CustomFieldListSchema } from './customField';
import { KeyPrefixSchema, PluginBagsSchema, SlugSchema, TimestampSchema, VersionSchema } from './primitives';
import { StageListSchema } from './stage';

/**
 * A Plugin's entry in `rowbly.config.json`: `enabled` turns it on (ADR-0010) and is the only key core
 * reserves; the Plugin's settings sit beside it.
 */
export const PluginEntrySchema = z.object({ enabled: z.boolean().optional() }).catchall(z.unknown());
export type PluginEntry = z.infer<typeof PluginEntrySchema>;

/** `rowbly.config.json`: the global level of the Configuration Cascade, and the Plugin entries. */
export const RowblyConfigSchema = z.object({
  version: VersionSchema,
  stages: StageListSchema.optional(),
  customFields: CustomFieldListSchema.optional(),
  /** Experimental feature overrides, shared by every Board in this Data Root. */
  featureFlags: z.record(z.string(), z.boolean()).optional(),
  /** The Data Root's Plugin entries, which are also its bags. */
  plugins: z.record(z.string(), PluginEntrySchema).optional(),
});
export type RowblyConfig = z.infer<typeof RowblyConfigSchema>;

/** `board.config.json`: Board metadata, key prefix and optional overrides. */
export const BoardConfigSchema = z.object({
  version: VersionSchema,
  id: SlugSchema,
  name: z.string().min(1),
  description: z.string(),
  keyPrefix: KeyPrefixSchema,
  stages: StageListSchema.optional(),
  customFields: CustomFieldListSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  /** Board bags: Plugin settings that cascade over the Data Root's (ADR-0010). */
  plugins: PluginBagsSchema.optional(),
});
export type BoardConfig = z.infer<typeof BoardConfigSchema>;
