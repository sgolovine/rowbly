import { SlugSchema, TimestampSchema, z } from '../../plugin-api';

export const CommentSchema = z.object({
  id: z.string().min(1),
  author: SlugSchema.nullable(),
  body: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Comment = z.infer<typeof CommentSchema>;

/** The bag on a Story or Task: its Thread, in the order the Comments were added. */
export const CommentsBag = z.object({ comments: z.array(CommentSchema) });
