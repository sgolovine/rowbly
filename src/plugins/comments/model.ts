import { SlugSchema, TimestampSchema, z } from '../../plugin-api';

const CommentSchema = z.object({
  id: z.string().min(1),
  author: SlugSchema.nullable(),
  body: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Comment = z.infer<typeof CommentSchema>;

/** The bag on a Story: its Thread, in the order the Comments were added. */
export const CommentsBag = z.object({ comments: z.array(CommentSchema) });

/**
 * A new or edited Comment body: anything but whitespace only, kept exactly as given (W9). Stored
 * Comments are read with the looser `.min(1)`, so older bodies stay valid.
 */
export const CommentBody = z.string().refine((value) => value.trim().length > 0, 'must not be empty');
