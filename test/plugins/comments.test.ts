import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../../src/core';
import { comments } from '../../src/plugins/comments';
import { addComment, deleteComment, editComment, listComments } from '../../src/plugins/comments/comments';
import { createRepositories } from '../../src/storage';
import { FIXED_NOW, fixedClock, makeStory } from '../helpers';
import { pluginRoot, withPlugins } from './helpers';

async function setup(me: string | null = 'alice') {
  const t = await pluginRoot({ comments: true });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
  const clock = fixedClock();
  const loaded = await withPlugins(t, [comments], { me, now: clock.now });
  await loaded.services.tasks.create('WEB-1', { name: 'Task' });
  const plugin = loaded.services.plugins.context('comments');
  return { ...loaded, clock, plugin, story: () => createRepositories(t.root).stories.findByKey('WEB-1') };
}

describe('Comments operations', () => {
  it('adds to the Story or to a Task by target, authored by Me, in the Plugin bag', async () => {
    const { plugin, story } = await setup();
    const onStory = await addComment(plugin, 'web-1', 'on the story');
    const onTask = await addComment(plugin, 'web-1.1', 'on the task');
    expect(onStory).toEqual({
      id: 'id000001',
      author: 'alice',
      body: 'on the story',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    const saved = await story();
    expect(saved.plugins).toEqual({ comments: { comments: [onStory] } });
    expect(saved.tasks[0]?.plugins).toEqual({ comments: { comments: [onTask] } });
  });

  it.each([
    { me: null, when: 'Me is unset' },
    { me: 'stranger', when: 'Me is not in the roster' },
  ])('has no author when $when', async ({ me }) => {
    const { plugin } = await setup(me);
    expect((await addComment(plugin, 'WEB-1', 'hi')).author).toBeNull();
  });

  it('rejects an empty body', async () => {
    const { plugin } = await setup();
    await expect(addComment(plugin, 'WEB-1', '  \n')).rejects.toBeInstanceOf(ValidationError);
    const comment = await addComment(plugin, 'WEB-1', 'hi');
    await expect(editComment(plugin, 'WEB-1', comment.id, '')).rejects.toBeInstanceOf(ValidationError);
  });

  it('lists oldest first, edits with a new updatedAt, and deletes the bag with the last Comment', async () => {
    const { plugin, clock, story } = await setup();
    const first = await addComment(plugin, 'WEB-1.1', 'first');
    clock.advance(1000);
    const second = await addComment(plugin, 'WEB-1.1', 'second');
    expect((await listComments(plugin, 'WEB-1.1')).map((c) => c.body)).toEqual(['first', 'second']);
    clock.advance(1000);
    const edited = await editComment(plugin, 'WEB-1.1', first.id, 'changed');
    expect(edited).toMatchObject({
      body: 'changed',
      createdAt: '2026-10-12T17:21:07.000Z',
      updatedAt: '2026-10-12T17:21:09.000Z',
    });
    await deleteComment(plugin, 'WEB-1.1', second.id);
    expect(await listComments(plugin, 'WEB-1.1')).toEqual([edited]);
    expect(await listComments(plugin, 'WEB-1')).toEqual([]);
    await deleteComment(plugin, 'WEB-1.1', first.id);
    expect((await story()).tasks[0]?.plugins).toBeUndefined();
  });

  it('throws NotFoundError for an unknown Comment, Task or Story', async () => {
    const { plugin } = await setup();
    await expect(deleteComment(plugin, 'WEB-1', 'nope0000')).rejects.toBeInstanceOf(NotFoundError);
    await expect(addComment(plugin, 'WEB-1.9', 'x')).rejects.toBeInstanceOf(NotFoundError);
    await expect(listComments(plugin, 'WEB-9')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('runs as comments.add, comments.update and comments.remove, which other Plugins can hook', async () => {
    const seen: string[] = [];
    const t = await pluginRoot({ comments: true, watcher: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [
      comments,
      {
        id: 'watcher',
        name: 'Watcher',
        description: 'Records Comment operations',
        hooks: Object.fromEntries(
          ['comments.add', 'comments.update', 'comments.remove'].map((name) => [
            name,
            { react: ({ name }: { name: string }) => void seen.push(name) },
          ]),
        ),
      },
    ]);
    const plugin = services.plugins.context('comments');
    const comment = await addComment(plugin, 'WEB-1', 'hi');
    await editComment(plugin, 'WEB-1', comment.id, 'hello');
    await deleteComment(plugin, 'WEB-1', comment.id);
    expect(seen).toEqual(['comments.add', 'comments.update', 'comments.remove']);
  });
});
