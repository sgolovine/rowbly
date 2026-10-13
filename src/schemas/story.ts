import { z } from 'zod';
import { CustomFieldValueSchema } from './customField';
import {
  IsoDateSchema,
  LabelSchema,
  PluginBagsSchema,
  SlugSchema,
  StoryKeySchema,
  TaskIdSchema,
  TimestampSchema,
  VersionSchema,
} from './primitives';

export const PrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3', 'P4']);
export type Priority = z.infer<typeof PrioritySchema>;

export const TaskSchema = z.object({
  id: TaskIdSchema,
  name: z.string().min(1).max(200),
  description: z.string(),
  stage: SlugSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  plugins: PluginBagsSchema.optional(),
});
export type Task = z.infer<typeof TaskSchema>;

/** `stories/<KEY>/story.json`: one Story with its Tasks embedded. */
export const StorySchema = z.object({
  version: VersionSchema,
  key: StoryKeySchema,
  boardId: SlugSchema,
  name: z.string().min(1).max(200),
  description: z.string().default(''),
  stage: SlugSchema,
  rank: z.string().min(1),
  assignees: z.array(SlugSchema),
  priority: PrioritySchema.nullable(),
  labels: z.array(LabelSchema),
  dueDate: IsoDateSchema.nullable(),
  customFields: z.record(SlugSchema, CustomFieldValueSchema),
  createdBy: SlugSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  nextTaskNumber: z.int().min(1),
  tasks: z.array(TaskSchema),
  plugins: PluginBagsSchema.optional(),
});
export type Story = z.infer<typeof StorySchema>;
