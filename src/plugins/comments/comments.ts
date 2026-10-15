import {
  type Bagged,
  isTaskId,
  NotFoundError,
  type PluginContext,
  type Story,
  type Task,
  toTimestamp,
  ValidationError,
} from '../../plugin-api';
import { type Comment, CommentsBag } from './model';

/** What a Thread belongs to: a Story, or one of its Tasks. */
export interface Owner {
  story: Story;
  task?: Task;
}

/** A Task id targets the Task's Thread; anything else is read as a Story Key. */
export async function ownerOf(plugin: PluginContext, target: string): Promise<Owner> {
  if (isTaskId(target)) return plugin.services.tasks.get(target);
  return { story: await plugin.services.stories.get(target) };
}

/** The Story Key or Task id of a Thread's owner. */
export function ownerId(owner: Owner): string {
  return owner.task?.id ?? owner.story.key;
}

/** The Comments on a Story or Task, as stored. */
export function commentsOn(plugin: PluginContext, record: Bagged): Comment[] {
  return plugin.readBag(record, CommentsBag)?.comments ?? [];
}

/** The Thread of `target`, oldest first. */
export async function listComments(plugin: PluginContext, target: string): Promise<Comment[]> {
  const owner = await ownerOf(plugin, target);
  return sortOldestFirst(commentsOn(plugin, owner.task ?? owner.story));
}

export async function getComment(plugin: PluginContext, target: string, id: string): Promise<Comment> {
  const owner = await ownerOf(plugin, target);
  return find(commentsOn(plugin, owner.task ?? owner.story), id, ownerId(owner));
}

export function addComment(plugin: PluginContext, target: string, body: string): Promise<Comment> {
  return plugin.operation('add', { target, body }, async (changes) => {
    checkBody(body);
    const owner = await ownerOf(plugin, target);
    const now = toTimestamp(plugin.now());
    const comment: Comment = { id: plugin.newId(), author: await author(plugin), body, createdAt: now, updatedAt: now };
    await changes.updateStory(owner.story.key, (story) =>
      updateThread(plugin, story, owner, (comments) => [...comments, comment]),
    );
    return comment;
  });
}

export function editComment(plugin: PluginContext, target: string, id: string, body: string): Promise<Comment> {
  return plugin.operation('update', { target, id, body }, async (changes) => {
    checkBody(body);
    const owner = await ownerOf(plugin, target);
    const next = {
      ...find(commentsOn(plugin, owner.task ?? owner.story), id, ownerId(owner)),
      body,
      updatedAt: toTimestamp(plugin.now()),
    };
    await changes.updateStory(owner.story.key, (story) =>
      updateThread(plugin, story, owner, (comments) => comments.map((c) => (c.id === id ? next : c))),
    );
    return next;
  });
}

export function deleteComment(plugin: PluginContext, target: string, id: string): Promise<{ deleted: string }> {
  return plugin.operation('remove', { target, id }, async (changes) => {
    const owner = await ownerOf(plugin, target);
    find(commentsOn(plugin, owner.task ?? owner.story), id, ownerId(owner));
    await changes.updateStory(owner.story.key, (story) =>
      updateThread(plugin, story, owner, (comments) => comments.filter((c) => c.id !== id)),
    );
    return { deleted: id };
  });
}

/** `story` with the Thread of `owner` changed by `update`; an empty Thread removes the bag. */
function updateThread(plugin: PluginContext, story: Story, owner: Owner, update: (comments: Comment[]) => Comment[]) {
  const updatedAt = toTimestamp(plugin.now());
  const write = <R extends Bagged>(record: R): Omit<R, 'plugins'> & Bagged => {
    const comments = update(commentsOn(plugin, record));
    return plugin.writeBag(record, comments.length ? { comments } : undefined);
  };
  if (!owner.task) return { ...write(story), updatedAt };
  const tasks = story.tasks.map((t) => (t.id === owner.task?.id ? { ...write(t), updatedAt } : t));
  return { ...story, tasks, updatedAt };
}

function find(comments: readonly Comment[], id: string, owner: string): Comment {
  const comment = comments.find((c) => c.id === id);
  if (comment) return comment;
  throw new NotFoundError(`Comment "${id}" not found on ${owner}`, { hint: `run \`rowbly comments list ${owner}\`` });
}

/** Me, when Me is in the roster; otherwise no author. */
async function author(plugin: PluginContext): Promise<string | null> {
  if (!plugin.me) return null;
  const roster = await plugin.services.assignees.list();
  return roster.some((a) => a.handle === plugin.me) ? plugin.me : null;
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
