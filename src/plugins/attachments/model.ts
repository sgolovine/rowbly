import { SlugSchema, TimestampSchema, z } from '../../plugin-api';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const AttachmentSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]*$/),
  name: z
    .string()
    .min(1)
    .refine(
      (name) =>
        [...name].every(
          (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127 && char !== '/' && char !== '\\',
        ),
      'must be a basename',
    ),
  type: z.literal('image/png'),
  size: z.number().int().min(8).max(MAX_ATTACHMENT_BYTES),
  createdAt: TimestampSchema,
  createdBy: SlugSchema.nullable(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/** Attachments stay in insertion order, with one file per unique id. */
export const AttachmentsBag = z
  .object({ attachments: z.array(AttachmentSchema) })
  .superRefine(({ attachments }, ctx) => {
    const seen = new Set<string>();
    for (const [index, { id }] of attachments.entries()) {
      if (seen.has(id))
        ctx.addIssue({ code: 'custom', path: ['attachments', index, 'id'], message: 'duplicate Attachment id' });
      seen.add(id);
    }
  });

/** Strings survive the operation input's deep freeze; decoding is deferred until the transform. */
export const AttachmentsInput = z.object({
  images: z
    .array(
      z.object({
        name: AttachmentSchema.shape.name,
        png: z
          .string()
          .min(12)
          .max(4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3))
          .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
      }),
    )
    .min(1)
    .refine(
      (images) => images.reduce((size, image) => size + image.png.length, 0) <= 4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3),
      'pending images exceed 10 MiB',
    ),
});
