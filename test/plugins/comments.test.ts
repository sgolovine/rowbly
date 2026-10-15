import { describe, expect, it } from 'vitest';
import { ConflictError, DataIntegrityError, NotFoundError, ValidationError } from '../../src/core';
import { definePlugin, type PluginChangeSet, type Story, type Task } from '../../src/plugin-api';
import { comments } from '../../src/plugins/comments';
import { addComment, deleteComment, editComment, listComments, readThread } from '../../src/plugins/comments/comments';
import { CommentsBag } from '../../src/plugins/comments/model';
import { pluginStoryRows, pluginTaskRows } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { FIXED_NOW, fixedClock, makeStory } from '../helpers';
import { readCommentThread } from './commentsHelpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

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

// ARCH-36, VER-02, RES-11 (`crosscheck.ts`): a mutation never replaces a Thread it could not read.
describe('Comments on an invalid Thread', () => {
  // An old Comment with invalid timestamps, plus a field from a future version.
  const invalidThread = {
    comments: [{ id: 'old', body: 'old', author: null, createdAt: 'bad date', updatedAt: 'bad date' }],
    future: 'keep',
  };
  const task = {
    id: 'WEB-1.1',
    name: 'Task',
    description: '',
    stage: 'backlog',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };

  async function invalidSetup() {
    const t = await pluginRoot({ comments: true });
    await makeStory(t.path, {
      boardId: 'web',
      key: 'WEB-1',
      nextTaskNumber: 2,
      plugins: { comments: invalidThread, other: { invalid: 17 } },
      tasks: [{ ...task, plugins: { comments: invalidThread, other: { kept: true } } }],
    });
    const raw = () => readJsonFile(t, storyFile('WEB-1'));
    const before = await raw();
    const loaded = await withPlugins(t, [comments], { me: 'alice' });
    return { ...loaded, raw, before, plugin: loaded.services.plugins.context('comments') };
  }

  it.each([
    { target: 'WEB-1', record: 'Story WEB-1' },
    { target: 'WEB-1.1', record: 'Task WEB-1.1' },
  ])('rejects add, edit and delete on the $record Thread and saves nothing', async ({ target, record }) => {
    const { plugin, raw, before } = await invalidSetup();
    for (const attempt of [
      () => addComment(plugin, target, 'new'),
      () => editComment(plugin, target, 'old', 'changed'),
      () => deleteComment(plugin, target, 'old'),
    ]) {
      const err = await attempt().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DataIntegrityError);
      expect(err).toMatchObject({
        message: `Plugin "comments" data on ${record} is not valid`,
        details: { plugin: 'comments', path: 'plugins.comments', record },
      });
    }
    expect(await raw()).toEqual(before);
  });

  it('lists an invalid Thread as an error, not as an empty Thread', async () => {
    const { plugin } = await invalidSetup();
    await expect(listComments(plugin, 'WEB-1')).rejects.toBeInstanceOf(DataIntegrityError);
    expect(await readThread(plugin, 'WEB-1.1')).toBeNull();
  });

  it('shows an invalid Thread as unavailable in the Story and Task rows', async () => {
    const { ctx, services } = await invalidSetup();
    const story = await services.stories.get('WEB-1');
    const unavailable = [{ label: 'Comments', value: 'unavailable (invalid)' }];
    expect(await pluginStoryRows(ctx, services, story)).toEqual(unavailable);
    expect(await pluginTaskRows(ctx, services, story.tasks[0] as Task, story)).toEqual(unavailable);
  });
});

/** `record` with the bodies of its Comments in capitals, as another Plugin's transform might leave them. */
function capitalized<R extends Story | Task>(record: R): R {
  const thread = CommentsBag.parse(record.plugins?.comments);
  const loud = thread.comments.map((c) => ({ ...c, body: c.body.toUpperCase() }));
  return { ...record, plugins: { ...record.plugins, comments: { comments: loud } } };
}

describe('Comments results and failures', () => {
  it('saves nothing when a guard rejects', async () => {
    const t = await pluginRoot({ comments: true, gate: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const gate = definePlugin({
      id: 'gate',
      name: 'Gate',
      description: '',
      hooks: { 'comments.add': { guard: () => ({ reject: 'closed' }) } },
    });
    const { services } = await withPlugins(t, [comments, gate]);
    const before = await readJsonFile(t, storyFile('WEB-1'));
    await expect(addComment(services.plugins.context('comments'), 'WEB-1', 'x')).rejects.toBeInstanceOf(ConflictError);
    expect(await readJsonFile(t, storyFile('WEB-1'))).toEqual(before);
  });

  it.each(['WEB-1', 'WEB-1.1'])(
    'gives the caller and reactions the Comment on %s as transforms left it (ARCH-42)',
    async (target) => {
      const reacted: unknown[] = [];
      const shout = definePlugin({
        id: 'shout',
        name: 'Shout',
        description: '',
        hooks: Object.fromEntries(
          ['comments.add', 'comments.update'].map((name) => [
            name,
            {
              async transform({ changes }: { changes: PluginChangeSet }) {
                await changes.updateStory('WEB-1', (s) =>
                  target === 'WEB-1' ? capitalized(s) : { ...s, tasks: s.tasks.map(capitalized) },
                );
              },
              react: ({ result }: { result: unknown }) => void reacted.push(result),
            },
          ]),
        ),
      });
      const t = await pluginRoot({ comments: true, shout: true });
      await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
      const { services } = await withPlugins(t, [comments, shout], { me: 'alice' });
      await services.tasks.create('WEB-1', { name: 'Task' });
      const plugin = services.plugins.context('comments');

      const added = await addComment(plugin, target, 'quiet');
      const edited = await editComment(plugin, target, added.id, 'still quiet');
      const thread = await readCommentThread(t, 'WEB-1', target === 'WEB-1' ? undefined : 0);
      expect(added.body).toBe('QUIET');
      expect(edited.body).toBe('STILL QUIET');
      expect(thread).toEqual([edited]);
      expect(reacted).toEqual([added, edited]);
    },
  );

  it('fails before the save when a transform removes the new Comment (W11)', async () => {
    const t = await pluginRoot({ comments: true, eraser: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const eraser = definePlugin({
      id: 'eraser',
      name: 'Eraser',
      description: '',
      hooks: {
        'comments.add': {
          async transform({ changes }) {
            await changes.updateStory('WEB-1', ({ plugins: _, ...s }) => s);
          },
        },
      },
    });
    const { services } = await withPlugins(t, [comments, eraser]);
    const before = await readJsonFile(t, storyFile('WEB-1'));
    const err = await addComment(services.plugins.context('comments'), 'WEB-1', 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(await readJsonFile(t, storyFile('WEB-1'))).toEqual(before);
  });
});

// UI-02, W9, CQ-125: the body is stored as given; only a whitespace-only body is refused.
describe('Comment bodies', () => {
  const bodies = [
    '  indented first line\nnext',
    '\n\nblank edges\n\n',
    '# Title\n\n- item\n  - nested\n\n```\ncode\n```',
  ];

  it.each(['WEB-1', 'WEB-1.1'])('stores bodies on %s exactly as given', async (target) => {
    const { plugin } = await setup();
    for (const body of bodies) {
      const comment = await addComment(plugin, target, body);
      expect(comment.body).toBe(body);
      expect((await editComment(plugin, target, comment.id, `${body} `)).body).toBe(`${body} `);
    }
  });

  it.each(['WEB-1', 'WEB-1.1'])('refuses a whitespace-only body on %s without changing the Thread', async (target) => {
    const { plugin, story } = await setup();
    const comment = await addComment(plugin, target, 'kept');
    const before = await story();
    for (const attempt of [
      () => addComment(plugin, target, ' \t\n '),
      () => editComment(plugin, target, comment.id, '\n  '),
    ]) {
      const err = await attempt().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err).toMatchObject({ details: { issues: [{ path: ['body'], message: 'must not be empty' }] } });
    }
    expect(await story()).toEqual(before);
  });
});
