import {
  type Bagged,
  ConflictError,
  isTaskId,
  NotFoundError,
  type PluginChangeSet,
  type PluginChangeSetView,
  type PluginContext,
  type PluginReadContext,
  type Story,
  type Task,
  toTimestamp,
  ValidationError,
} from '../../plugin-api';
import { type Comment, CommentBody, CommentsBag } from './model';

/** What a Thread belongs to: a Story, or one of its Tasks. */
interface Owner {
  story: Story;
  task?: Task;
}

/** A Task id targets the Task's Thread; anything else is read as a Story Key. */
async function ownerOf(plugin: PluginContext, target: string): Promise<Owner> {
  if (isTaskId(target)) return plugin.services.tasks.get(target);
  return { story: await plugin.services.stories.get(target) };
}

/** The Story Key or Task id of a Thread's owner. */
function ownerId(owner: Owner): string {
  return owner.task?.id ?? owner.story.key;
}

/**
 * The Comments on a Story or Task, as stored, or `null` when the stored Thread is invalid. For
 * display only: an invalid Thread is never shown as empty (ARCH-36).
 */
export function storedComments(plugin: PluginReadContext, record: Bagged): Comment[] | null {
  const bag = plugin.inspectBag(record, CommentsBag);
  if (bag.kind === 'invalid') return null;
  return bag.kind === 'valid' ? bag.value.comments : [];
}

/**
 * The Comments on a Story or Task, to change them: an invalid stored Thread throws
 * `DataIntegrityError` instead of being replaced (ARCH-36).
 */
function requireComments(plugin: PluginReadContext, record: Bagged): Comment[] {
  return plugin.requireBag(record, CommentsBag)?.comments ?? [];
}

/** The Thread of `target`, oldest first; an invalid stored Thread throws `DataIntegrityError`. */
export async function listComments(plugin: PluginContext, target: string): Promise<Comment[]> {
  const owner = await ownerOf(plugin, target);
  return sortOldestFirst(requireComments(plugin, owner.task ?? owner.story));
}

/** The Thread of `target`, oldest first, or `null` when the stored Thread is invalid. For display. */
export async function readThread(plugin: PluginContext, target: string): Promise<Comment[] | null> {
  const owner = await ownerOf(plugin, target);
  const comments = storedComments(plugin, owner.task ?? owner.story);
  return comments && sortOldestFirst(comments);
}

export async function getComment(plugin: PluginContext, target: string, id: string): Promise<Comment> {
  const owner = await ownerOf(plugin, target);
  return find(requireComments(plugin, owner.task ?? owner.story), id, ownerId(owner));
}

export function addComment(plugin: PluginContext, target: string, body: string): Promise<Comment> {
  let owner: Owner | undefined;
  return plugin.operation(
    'add',
    { target, body },
    async (changes) => {
      checkBody(body);
      owner = await ownerOf(plugin, target);
      const now = toTimestamp(plugin.now());
      const comment: Comment = {
        id: plugin.newId(),
        // Me, read on each change and never cached (ARCH-18); no author when Me is unset.
        author: plugin.me,
        body,
        createdAt: now,
        updatedAt: now,
      };
      await updateThread(plugin, changes, owner, (comments) => [...comments, comment]);
      return comment;
    },
    { result: (changes, comment) => saved(plugin, changes, owner, comment.id) },
  );
}

export function editComment(plugin: PluginContext, target: string, id: string, body: string): Promise<Comment> {
  let owner: Owner | undefined;
  return plugin.operation(
    'update',
    { target, id, body },
    async (changes) => {
      checkBody(body);
      owner = await ownerOf(plugin, target);
      const updatedAt = toTimestamp(plugin.now());
      let next: Comment | undefined;
      await updateThread(plugin, changes, owner, (comments, thread) => {
        next = { ...find(comments, id, thread), body, updatedAt };
        return comments.map((c) => (c.id === id ? (next as Comment) : c));
      });
      return next as Comment;
    },
    { result: (changes) => saved(plugin, changes, owner, id) },
  );
}

export function deleteComment(plugin: PluginContext, target: string, id: string): Promise<{ deleted: string }> {
  return plugin.operation('remove', { target, id }, async (changes) => {
    const owner = await ownerOf(plugin, target);
    await updateThread(plugin, changes, owner, (comments, thread) => {
      find(comments, id, thread);
      return comments.filter((c) => c.id !== id);
    });
    return { deleted: id };
  });
}

/**
 * Changes the pending Thread of `owner` with `update`; an empty Thread removes the bag. The Thread is
 * read strictly, so an invalid one rejects the operation before anything is saved.
 */
async function updateThread(
  plugin: PluginContext,
  changes: PluginChangeSet,
  owner: Owner,
  update: (comments: Comment[], thread: string) => Comment[],
): Promise<void> {
  const updatedAt = toTimestamp(plugin.now());
  const thread = ownerId(owner);
  const write = <R extends Bagged>(record: R): Omit<R, 'plugins'> & Bagged => {
    const comments = update(requireComments(plugin, record), thread);
    return plugin.writeBag(record, comments.length ? { comments } : undefined);
  };
  await changes.updateStory(owner.story.key, (story): Story => {
    if (!owner.task) return { ...write(story), updatedAt };
    const taskId = owner.task.id;
    return { ...story, tasks: story.tasks.map((t) => (t.id === taskId ? { ...write(t), updatedAt } : t)), updatedAt };
  });
}

/**
 * Comment `id` of `owner` as the pending Change Set holds it after every transform (ARCH-42). A
 * transform that removed it fails the operation before the save (W11).
 */
function saved(plugin: PluginContext, changes: PluginChangeSetView, owner: Owner | undefined, id: string): Comment {
  const story = owner && changes.story(owner.story.key)?.after;
  const record = owner?.task ? story?.tasks.find((t) => t.id === owner.task?.id) : story;
  const comment = record && requireComments(plugin, record).find((c) => c.id === id);
  if (comment) return comment;
  throw new ConflictError(`Comment "${id}" was removed before it was saved`, {
    hint: 'a transform of another Plugin removed it; see `rowbly plugins list`',
  });
}

function find(comments: readonly Comment[], id: string, owner: string): Comment {
  const comment = comments.find((c) => c.id === id);
  if (comment) return comment;
  throw new NotFoundError(`Comment "${id}" not found on ${owner}`, { hint: `run \`rowbly comments list ${owner}\`` });
}

/** Throws `ValidationError` for a whitespace-only body; the body itself is kept exactly as given. */
function checkBody(body: string): void {
  const parsed = CommentBody.safeParse(body);
  if (parsed.success) return;
  throw new ValidationError('the Comment body is empty', {
    details: {
      issues: parsed.error.issues.map((issue) => ({ path: ['body', ...issue.path], message: issue.message })),
    },
  });
}

/** Comments are stored in the order they were added; sorting by `createdAt` also tolerates merged files. */
function sortOldestFirst(comments: readonly Comment[]): Comment[] {
  return [...comments].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}
