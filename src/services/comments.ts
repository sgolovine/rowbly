import { isTaskId, NotFoundError, toTimestamp, ValidationError } from '../core';
import type { Comment, Slug, Story } from '../schemas';
import type { Repositories } from '../storage';
import { findTask } from './tasks';
import type { CommentsService, RowblyContext } from './types';

/** The Comments of a Story or one of its Tasks, and how to write a changed list back. */
interface Thread {
  story: Story;
  comments: Comment[];
  save(comments: Comment[]): Promise<void>;
}

export function createCommentsService(ctx: RowblyContext, repos: Repositories): CommentsService {
  /** A Task id targets the Task's Comments; anything else is parsed as a Story Key. */
  async function thread(target: string): Promise<Thread> {
    if (isTaskId(target)) {
      const { story, task } = await findTask(repos, target);
      return {
        story,
        comments: task.comments,
        async save(comments) {
          const now = toTimestamp(ctx.now());
          const tasks = story.tasks.map((t) => (t.id === task.id ? { ...t, comments, updatedAt: now } : t));
          await repos.stories.put({ ...story, tasks, updatedAt: now });
        },
      };
    }
    const story = await repos.stories.findByKey(target);
    return {
      story,
      comments: story.comments,
      save: (comments) => repos.stories.put({ ...story, comments, updatedAt: toTimestamp(ctx.now()) }),
    };
  }

  function find(comments: readonly Comment[], id: string, target: string): Comment {
    const comment = comments.find((c) => c.id === id);
    if (!comment) {
      throw new NotFoundError(`Comment "${id}" not found on ${target.toUpperCase()}`, {
        hint: `run \`rowbly comments list ${target.toUpperCase()}\``,
      });
    }
    return comment;
  }

  async function author(): Promise<Slug | null> {
    if (!ctx.me) return null;
    const roster = (await repos.rootConfig.get()).assignees;
    return roster.some((a) => a.handle === ctx.me) ? ctx.me : null;
  }

  return {
    list: async (target) => sortOldestFirst((await thread(target)).comments),

    async add(target, body) {
      checkBody(body);
      const { comments, save } = await thread(target);
      const now = toTimestamp(ctx.now());
      const comment: Comment = {
        id: ctx.newId(),
        author: await author(),
        body,
        createdAt: now,
        updatedAt: now,
      };
      await save([...comments, comment]);
      return comment;
    },

    async update(target, id, body) {
      checkBody(body);
      const { comments, save } = await thread(target);
      const next = { ...find(comments, id, target), body, updatedAt: toTimestamp(ctx.now()) };
      await save(comments.map((c) => (c.id === id ? next : c)));
      return next;
    },

    async remove(target, id) {
      const { comments, save } = await thread(target);
      find(comments, id, target);
      await save(comments.filter((c) => c.id !== id));
    },
  };
}

function checkBody(body: string): void {
  if (body.trim() !== '') return;
  throw new ValidationError('the Comment body is empty', {
    details: { issues: [{ path: ['body'], message: 'must not be empty' }] },
  });
}

/** Comments are stored in the order they were added; sorting by `createdAt` also tolerates merged files. */
function sortOldestFirst(comments: readonly Comment[]): Comment[] {
  return [...comments].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}
