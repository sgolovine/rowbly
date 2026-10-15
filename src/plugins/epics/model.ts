import { type BoardConfig, SlugSchema, type Story, TimestampSchema, ValidationError, z } from '../../plugin-api';

export const EpicSchema = z.object({
  version: z.literal(1),
  id: SlugSchema,
  name: z.string().trim().min(1),
  description: z.string(),
  closed: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Epic = z.infer<typeof EpicSchema>;
export const EpicBag = z.object({ epic: SlugSchema });
export const EpicInput = z.object({ epic: SlugSchema.nullable() });
/** A Story filter: Stories of one Epic, or `false` for Stories without an Epic. */
export const EpicFilter = z.union([SlugSchema, z.literal(false)]);
export const EpicCreate = z.object({
  id: SlugSchema,
  name: z.string().trim().min(1),
  description: z.string().default(''),
});
export const EpicPatch = z.object({ name: z.string().trim().min(1).optional(), description: z.string().optional() });

export type EpicMode = 'open' | 'closed' | 'all';

/** Epic Progress: derived from the Stage Categories of the Epic's Stories, never stored. */
export interface EpicProgress {
  done: number;
  total: number;
  percent: number;
}

/** An Epic with its Epic Progress, as the Epic list shows it. */
export type EpicSummary = Epic & { progress: EpicProgress };

/** An Epic's Stories on one Board. */
export interface EpicBoardStories {
  board: BoardConfig;
  stories: Story[];
}

/** An Epic with its Stories by Board and its Epic Progress, as `epics show` and the Epic screen show it. */
export type EpicDetails = EpicSummary & { boards: EpicBoardStories[] };

/** `value` parsed by `schema`; otherwise a `ValidationError` naming `what` and each field's problem. */
export function validate<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`Invalid ${what}: ${formatIssues(parsed.error.issues)}`, {
      details: { issues: parsed.error.issues },
    });
  }
  return parsed.data;
}

/** `name: problem; …`, one entry per issue. */
export function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.length ? issue.path.join('.') : 'value'}: ${issue.message}`).join('; ');
}
