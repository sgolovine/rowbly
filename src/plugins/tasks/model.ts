import { SlugSchema, TimestampSchema, z } from '../../plugin-api';

/** A Task as stored in its Story's bag. Its id is derived from the Story Key, so it follows a renumber. */
export const StoredTaskSchema = z.object({
  number: z.int().min(1),
  name: z.string().min(1).max(200),
  description: z.string(),
  stage: SlugSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type StoredTask = z.infer<typeof StoredTaskSchema>;

/** The bag on a Story: its Tasks in creation order, and the number the next Task gets (never reused). */
export const TasksBag = z.object({
  nextNumber: z.int().min(1),
  tasks: z.array(StoredTaskSchema),
});
export type TasksBag = z.infer<typeof TasksBag>;

/** A Task as commands, screens and operation results show it: the stored Task with its Task Id. */
export interface Task extends StoredTask {
  /** `<Story Key>.<number>`, e.g. `WEB-42.3`. */
  id: string;
}

/** The input of `tasks.create`. */
export interface TaskCreateInput {
  name: string;
  description?: string;
  /** Defaults to the first effective Stage. */
  stage?: string;
}

/** The input of `tasks.update`; `undefined` keeps a value. A new Stage is the change `move` makes. */
export interface TaskPatch {
  name?: string;
  description?: string;
  stage?: string;
}
