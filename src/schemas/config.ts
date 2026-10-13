import { z } from 'zod';
import { CustomFieldListSchema } from './customField';
import { KeyPrefixSchema, SlugSchema, TimestampSchema, uniqueKeys, VersionSchema } from './primitives';
import { StageListSchema } from './stage';

/** `rowbly.config.json`: the global level of the Configuration Cascade. */
export const RowblyConfigSchema = z.object({
  version: VersionSchema,
  stages: StageListSchema.optional(),
  customFields: CustomFieldListSchema.optional(),
});
export type RowblyConfig = z.infer<typeof RowblyConfigSchema>;

export const AssigneeSchema = z.object({
  handle: SlugSchema,
  name: z.string().min(1),
  email: z.email().optional(),
});
export type Assignee = z.infer<typeof AssigneeSchema>;

/** `workspace.config.json`: Workspace metadata, its Assignee roster and optional overrides. */
export const WorkspaceConfigSchema = z.object({
  version: VersionSchema,
  id: SlugSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  assignees: z.array(AssigneeSchema).superRefine(uniqueKeys<{ handle: string }>('assignee handle', (a) => a.handle)),
  stages: StageListSchema.optional(),
  customFields: CustomFieldListSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

/** `board.config.json`: Board metadata, key prefix and optional overrides. */
export const BoardConfigSchema = z.object({
  version: VersionSchema,
  id: SlugSchema,
  workspaceId: SlugSchema,
  name: z.string().min(1),
  description: z.string(),
  keyPrefix: KeyPrefixSchema,
  stages: StageListSchema.optional(),
  customFields: CustomFieldListSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type BoardConfig = z.infer<typeof BoardConfigSchema>;
