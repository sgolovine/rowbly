import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { comments } from '../../src/plugins/comments';
import { createRepositories } from '../../src/storage';
import { pluginRoute } from '../../src/tui/hooks';
import type { RouteParams } from '../../src/tui/router';
import { FIXED_NOW, fixedClock, makeStory } from '../helpers';
import { KEYS, waitForFrame } from '../tui/helpers';
import { readCommentThread, WHITESPACE_BODIES } from './commentsHelpers';
import { pluginRoot, readJsonFile, storyFile } from './helpers';
import { openPluginApp } from './tuiHelpers';

const TASK = {
  id: 'WEB-1.1',
  name: 'Old',
  description: '',
  stage: 'backlog',
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

/** The App over a Data Root with the Comments Plugin on and Me set to alice, opened on `screen`. */
async function open(screen: string, params: RouteParams, plugins?: Record<string, Record<string, unknown>>) {
  const t = await pluginRoot({ comments: true });
  await makeStory(t.path, {
    boardId: 'web',
    key: 'WEB-1',
    name: 'Login',
    assignees: ['alice'],
    nextTaskNumber: 2,
    tasks: [{ ...TASK, plugins }],
    plugins,
  });
  const clock = fixedClock();
  const { app, services } = await openPluginApp(t, [comments], { screen, params }, { me: 'alice', now: clock.now });
  await waitForFrame(app, (frame) => !frame.includes('Loading'));
  const story = () => createRepositories(t.root).stories.findByKey('WEB-1');
  const thread = (task?: number) => readCommentThread(t, 'WEB-1', task);
  return { t, app, services, clock, story, thread };
}

/** The keys that type `text` into a multiline field: `enter` for each line break. */
const typed = (text: string) => [...text].map((char) => (char === '\n' ? KEYS.enter : char));

describe('Comments TUI', () => {
  it('adds, edits and deletes a Comment on the Story screen tab', async () => {
    const { app, clock, story, thread } = await open('story', { key: 'WEB-1' });
    await app.press(KEYS.tab, KEYS.tab);
    await waitForFrame(app, (f) => f.includes('No Comments yet'));

    await app.press('c');
    await waitForFrame(app, (f) => f.includes('New Comment on WEB-1') && f.includes('Comment*'));
    // An empty Comment is refused in the form.
    await app.press(KEYS.ctrlEnter);
    await waitForFrame(app, 'required');
    await app.press(...'first line', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Added Comment') && f.includes('alice · just now'));
    expect(app.lastFrame()).toContain('first line');
    expect(await thread()).toMatchObject([{ id: 'id000001', author: 'alice', body: 'first line' }]);

    clock.advance(5 * 60_000);
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Edit Comment on WEB-1') && f.includes('first line'));
    // `enter` starts a new line in the Comment.
    await app.press(KEYS.enter, ...'second line', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Updated Comment') && f.includes('alice · 5m ago (edited)'));
    expect((await thread())[0]?.body).toBe('first line\nsecond line');

    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete the Comment by alice?'));
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted Comment') && f.includes('No Comments yet'));
    expect(await thread()).toEqual([]);
    expect((await story()).name).toBe('Login');
    app.unmount();
  });

  it('keeps a Task’s Comments on a tab of the Task screen, with a count on Details', async () => {
    const { app, thread } = await open('story', { key: 'WEB-1' });
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('WEB-1.1 Old'));
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('alice (from the Story)') && /Comments\s+0/.test(f));
    // Comments are on their own tab, so `e` and `d` on Details act on the Task.
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('No Comments yet. Press c to add one.'));
    await app.press('c');
    await waitForFrame(app, (f) => f.includes('New Comment on WEB-1.1') && f.includes('Comment*'));
    await app.press(...'Looks good', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Added Comment'));
    expect(await thread(0)).toMatchObject([{ author: 'alice', body: 'Looks good' }]);
    expect(await thread()).toEqual([]);

    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Edit Comment on WEB-1.1') && f.includes('Looks good'));
    await app.press(...' to me', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Updated Comment') && f.includes('Looks good to me'));
    expect(await thread(0)).toMatchObject([{ body: 'Looks good to me' }]);
    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete the Comment by alice?'));
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted Comment') && f.includes('No Comments yet'));
    expect(await thread(0)).toEqual([]);
    app.unmount();
  });

  it('shows only add on an empty Thread, and no fixed key line', async () => {
    const { app } = await open('story', { key: 'WEB-1' });
    await app.press(KEYS.tab, KEYS.tab);
    const frame = await waitForFrame(app, (f) => f.includes('No Comments yet') && f.includes('add Comment'));
    expect(frame).not.toContain('edit Comment');
    expect(frame).not.toContain('delete Comment');
    expect(frame).not.toContain('c add · e edit · d delete');
    app.unmount();
  });

  it.each([
    { on: 'Story', screen: 'story', params: { key: 'WEB-1' }, tabs: 2 },
    { on: 'Task', screen: 'task', params: { id: 'WEB-1.1' }, tabs: 1 },
  ])('shows an invalid $on Thread as unavailable, with no Comment actions', async ({ screen, params, tabs }) => {
    const invalid = { comments: { comments: [{ id: 'old', body: 'old', createdAt: 'bad date' }], future: 'keep' } };
    const { t, app } = await open(screen, params, invalid);
    const before = await readJsonFile(t, storyFile('WEB-1'));
    await app.press(...Array(tabs).fill(KEYS.tab));
    const frame = await waitForFrame(app, 'Comments unavailable: stored Thread is invalid; run `rowbly doctor`.');
    expect(frame).not.toContain('No Comments yet');
    expect(frame).not.toContain('add Comment');
    await app.press('c');
    expect(app.lastFrame()).not.toContain('New Comment');
    expect(await readJsonFile(t, storyFile('WEB-1'))).toEqual(before);
    app.unmount();
  });

  it('shows a failed load as a failure, with no Comment actions', async () => {
    const { t, app } = await open('story', { key: 'WEB-1' });
    await rm(join(t.path, 'boards/web/stories/WEB-1'), { recursive: true });
    await app.press(KEYS.tab, KEYS.tab);
    const frame = await waitForFrame(app, 'Could not load Comments.');
    expect(frame).not.toContain('add Comment');
    await app.press('c');
    expect(app.lastFrame()).not.toContain('New Comment');
    app.unmount();
  });

  // UI-02: the CLI stores these exactly as given (commentsCli.test.ts); the TUI must store the same.
  it.each([
    { on: 'Story', screen: 'story', params: { key: 'WEB-1' }, tabs: 2, target: 'WEB-1', task: undefined },
    { on: 'Task', screen: 'task', params: { id: 'WEB-1.1' }, tabs: 1, target: 'WEB-1.1', task: 0 },
  ])('stores $on Comment bodies exactly as typed, and refuses a whitespace-only one', async (row) => {
    const { app, thread } = await open(row.screen, row.params);
    await app.press(...Array(row.tabs).fill(KEYS.tab));
    await waitForFrame(app, 'No Comments yet');
    for (const body of WHITESPACE_BODIES) {
      await app.press('c');
      await waitForFrame(app, (f) => f.includes(`New Comment on ${row.target}`) && f.includes('Comment*'));
      await app.press(...typed(body), KEYS.ctrlEnter);
      await waitForFrame(app, (f) => f.includes('Added Comment') && !f.includes('New Comment'));
    }
    expect((await thread(row.task)).map((c) => c.body)).toEqual(WHITESPACE_BODIES);

    await app.press('c');
    await waitForFrame(app, (f) => f.includes(`New Comment on ${row.target}`) && f.includes('Comment*'));
    await app.press(...typed(' \n  '), KEYS.ctrlEnter);
    await waitForFrame(app, 'must not be empty');
    expect(await thread(row.task)).toHaveLength(WHITESPACE_BODIES.length);
    app.unmount();
  });

  // CQ-134: a malformed route shows an error and never adds or edits a Comment.
  it.each([
    { params: {}, error: 'the Comment form needs a Story Key or Task id as its target' },
    { params: { target: 42 }, error: 'the Comment form needs a Story Key or Task id as its target' },
    { params: { target: 'WEB-1', id: 7 }, error: 'the Comment id must be a string' },
  ])('refuses the Comment form with params $params', async ({ params, error }) => {
    const route = pluginRoute('comments', 'form', params);
    const { app, thread } = await open(route.screen, route.params);
    const frame = await waitForFrame(app, error);
    expect(frame).toContain('Could not open the Comment form');
    expect(frame).not.toContain('New Comment');
    await app.press(...'text', KEYS.ctrlEnter);
    expect(await thread()).toEqual([]);
    app.unmount();
  });

  it('opens the Comment form on a lowercase Story Key', async () => {
    const route = pluginRoute('comments', 'form', { target: 'web-1' });
    const { app, thread } = await open(route.screen, route.params);
    await waitForFrame(app, (f) => f.includes('New Comment on web-1') && f.includes('Comment*'));
    await app.press(...'hi', KEYS.ctrlEnter);
    await waitForFrame(app, 'Added Comment');
    expect((await thread()).map((c) => c.body)).toEqual(['hi']);
    app.unmount();
  });
});
