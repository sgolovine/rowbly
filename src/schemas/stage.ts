import { z } from 'zod';
import { SlugSchema, uniqueKeys } from './primitives';

export const StageCategorySchema = z.enum(['backlog', 'board', 'done']);
export type StageCategory = z.infer<typeof StageCategorySchema>;

/** A Stage of a Board as Rowbly uses it: the fixed Backlog and Done Stages and the configured ones between them. */
export const StageSchema = z.object({
  key: SlugSchema,
  name: z.string().min(1).max(60),
  category: StageCategorySchema,
});
export type Stage = z.infer<typeof StageSchema>;

/** Every Board starts with Backlog and ends with Done; neither is configured, edited, moved or removed (ADR-0024). */
export const BACKLOG_STAGE: Readonly<Stage> = Object.freeze({ key: 'backlog', name: 'Backlog', category: 'backlog' });
export const DONE_STAGE: Readonly<Stage> = Object.freeze({ key: 'done', name: 'Done', category: 'done' });
export const FIXED_STAGE_KEYS: readonly string[] = Object.freeze([BACKLOG_STAGE.key, DONE_STAGE.key]);

export function isFixedStage(key: string): boolean {
  return FIXED_STAGE_KEYS.includes(key);
}

/** A configured Stage: one between Backlog and Done, always in the `board` Stage Category. */
export const StageConfigSchema = z.object({
  key: SlugSchema.refine((key) => !isFixedStage(key), { message: 'backlog and done are fixed Stages' }),
  name: z.string().min(1).max(60),
});
export type StageConfig = z.infer<typeof StageConfigSchema>;

/** An ordered list of configured Stages, with unique keys. It may be empty. */
export const StageListSchema = z
  .array(StageConfigSchema)
  .superRefine(uniqueKeys<StageConfig>('stage key', (stage) => stage.key));

/** Used when no Configuration Cascade level defines `stages`; also written by `init`. */
export const DEFAULT_STAGES: readonly StageConfig[] = Object.freeze([
  { key: 'todo', name: 'Todo' },
  { key: 'in-progress', name: 'In Progress' },
]);

/** The Board's Stages in order: Backlog, the configured Stages, then Done. */
export function withFixedStages(stages: readonly StageConfig[]): Stage[] {
  return [
    { ...BACKLOG_STAGE },
    ...stages.map((stage) => ({ key: stage.key, name: stage.name, category: 'board' as const })),
    { ...DONE_STAGE },
  ];
}
