import { SlugSchema, TimestampSchema, z } from '../../plugin-api';

const CommentSchema = z.object({
  id: z.string().min(1),
  author: SlugSchema.nullable(),
  body: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Comment = z.infer<typeof CommentSchema>;

/** Recognizes the current structure before reconciliation checks identity validity. */
export const CommentsBagShape = z.object({ comments: z.array(CommentSchema) });
/** The bag on a Story: its Thread, with unique ids in the order the Comments were added. */
export const CommentsBag = CommentsBagShape.superRefine(({ comments }, ctx) => {
  const seen = new Set<string>();
  for (const [index, { id }] of comments.entries()) {
    if (seen.has(id))
      ctx.addIssue({
        code: 'custom',
        path: ['comments', index, 'id'],
        message: `duplicate Comment id ${JSON.stringify(id)}`,
      });
    seen.add(id);
  }
});

/**
 * A new or edited Comment body: anything but whitespace only, kept exactly as given (W9). Stored
 * Comments are read with the looser `.min(1)`, so older bodies stay valid.
 */
export const CommentBody = z.string().refine((value) => value.trim().length > 0, 'must not be empty');
