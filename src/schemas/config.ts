import { z } from 'zod';
import { CustomFieldListSchema } from './customField';
import { KeyPrefixSchema, SlugSchema, TimestampSchema, uniqueKeys, VersionSchema } from './primitives';
import { StageListSchema } from './stage';

export const AssigneeSchema = z.object({
  handle: SlugSchema,
  name: z.string().min(1),
  email: z.email().optional(),
});
export type Assignee = z.infer<typeof AssigneeSchema>;

/** `rowbly.config.json`: the Assignee roster and the global level of the Configuration Cascade. */
export const RowblyConfigSchema = z.object({
  version: VersionSchema,
  assignees: z
    .array(AssigneeSchema)
    .superRefine(uniqueKeys<{ handle: string }>('assignee handle', (a) => a.handle))
    .default([]),
  stages: StageListSchema.optional(),
  customFields: CustomFieldListSchema.optional(),
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
});
export type BoardConfig = z.infer<typeof BoardConfigSchema>;
