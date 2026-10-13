import { z } from 'zod';
import { SlugSchema, uniqueKeys } from './primitives';

export const StageCategorySchema = z.enum(['todo', 'in_progress', 'done']);
export type StageCategory = z.infer<typeof StageCategorySchema>;

export const StageSchema = z.object({
  key: SlugSchema,
  name: z.string().min(1).max(60),
  category: StageCategorySchema,
});
export type Stage = z.infer<typeof StageSchema>;

/** An ordered Stage list: at least one Stage, unique keys. */
export const StageListSchema = z
  .array(StageSchema)
  .min(1)
  .superRefine(uniqueKeys<Stage>('stage key', (stage) => stage.key));

/** Used when no Configuration Cascade level defines `stages`; also written by `init`. */
export const DEFAULT_STAGES: readonly Stage[] = Object.freeze([
  { key: 'backlog', name: 'Backlog', category: 'todo' },
  { key: 'todo', name: 'Todo', category: 'todo' },
  { key: 'in-progress', name: 'In Progress', category: 'in_progress' },
  { key: 'done', name: 'Done', category: 'done' },
]);
