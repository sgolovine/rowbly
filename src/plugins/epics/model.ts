import { SlugSchema, TimestampSchema, ValidationError, z } from '../../plugin-api';

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
export const EpicCreate = z.object({
  id: SlugSchema,
  name: z.string().trim().min(1),
  description: z.string().default(''),
});
export const EpicPatch = z.object({ name: z.string().trim().min(1).optional(), description: z.string().optional() });

export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Invalid Epic data', { details: { issues: parsed.error.issues } });
  }
  return parsed.data;
}
