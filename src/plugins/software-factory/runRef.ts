import { SlugSchema, TimestampSchema, z } from '../../plugin-api';

/** Names one Stage Run: its Stage, attempt and start (ADR-0045 §2, ADR-0046 §2). */
export const RunRef = z.strictObject({
  stage: SlugSchema,
  attempt: z.number().int().min(1),
  startedAt: TimestampSchema,
});
export type RunRef = z.infer<typeof RunRef>;
