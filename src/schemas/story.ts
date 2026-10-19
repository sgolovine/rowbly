import { z } from 'zod';
import { CustomFieldValueSchema } from './customField';
import {
  IsoDateSchema,
  LabelSchema,
  PluginBagsSchema,
  SlugSchema,
  StoryKeySchema,
  TimestampSchema,
  VersionSchema,
} from './primitives';

export const PrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3', 'P4']);
export type Priority = z.infer<typeof PrioritySchema>;

/** `stories/<KEY>/story.json`: one Story. */
export const StorySchema = z.object({
  version: VersionSchema,
  key: StoryKeySchema,
  boardId: SlugSchema,
  name: z.string().min(1).max(200),
  description: z.string().default(''),
  stage: SlugSchema,
  rank: z.string().min(1),
  priority: PrioritySchema.nullable(),
  labels: z.array(LabelSchema),
  dueDate: IsoDateSchema.nullable(),
  customFields: z.record(SlugSchema, CustomFieldValueSchema),
  createdBy: SlugSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  plugins: PluginBagsSchema.optional(),
});
export type Story = z.infer<typeof StorySchema>;
