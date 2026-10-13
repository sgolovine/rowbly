import { z } from 'zod';
import { SlugSchema, uniqueKeys } from './primitives';

const baseShape = {
  key: SlugSchema,
  name: z.string().min(1).max(60),
  description: z.string().optional(),
  required: z.boolean().default(false),
};

const optionsSchema = z
  .array(z.string().min(1))
  .min(1)
  .superRefine(uniqueKeys<string>('option', (option) => option));

export const CustomFieldTypeSchema = z.enum(['text', 'number', 'boolean', 'date', 'url', 'select', 'multiselect']);
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

export const CustomFieldDefSchema = z.discriminatedUnion('type', [
  z.object({ ...baseShape, type: z.literal('text') }),
  z.object({
    ...baseShape,
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
  }),
  z.object({ ...baseShape, type: z.literal('boolean') }),
  z.object({ ...baseShape, type: z.literal('date') }),
  z.object({ ...baseShape, type: z.literal('url') }),
  z.object({ ...baseShape, type: z.literal('select'), options: optionsSchema }),
  z.object({ ...baseShape, type: z.literal('multiselect'), options: optionsSchema }),
]);
export type CustomFieldDef = z.infer<typeof CustomFieldDefSchema>;
/** A Custom Field definition as given on input: `required` may be omitted (defaults to `false`). */
export type CustomFieldInput = z.input<typeof CustomFieldDefSchema>;

/** An ordered Custom Field list with unique keys. */
export const CustomFieldListSchema = z
  .array(CustomFieldDefSchema)
  .superRefine(uniqueKeys<CustomFieldDef>('custom field key', (field) => field.key));

/**
 * Shape-level value check only. Whether a value matches its field's type and options is a
 * referential rule enforced by services (contracts §2).
 */
export const CustomFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export type CustomFieldValue = z.infer<typeof CustomFieldValueSchema>;
