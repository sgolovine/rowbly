import { describe, expect, it } from 'vitest';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import type { RouteParams } from '../../src/tui/router';
import { relativeTime } from '../../src/tui/screens/comments/CommentsPanel';
import { fixedClock, fixedIds, makeBoard, makeRootConfig, makeStory, type TempRoot, tempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from './helpers';

const web = { boardId: 'web' };

async function setup() {
  const t = await tempRoot();
  await makeRootConfig(t.path, { assignees: [{ handle: 'alice', name: 'Alice' }] });
  await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
  await makeStory(t.path, { ...web, key: 'WEB-1', name: 'Login', assignees: ['alice'] });
  return t;
}

/** The real App over a temp Data Root, opened on `screen`, with Me set to alice. */
async function open(t: TempRoot, screen: string, params: RouteParams = {}) {
  const toasts = createToastStore();
  const clock = fixedClock();
  const ctx: RowblyContext = {
    root: t.root,
    local: { version: 1 },
    me: 'alice',
    now: clock.now,
    newId: fixedIds(),
    warn: (message) => toasts.push('warning', message),
  };
  const services = createServices(ctx);
  const app = renderTui(<App ctx={ctx} services={services} initial={{ screen, params }} toasts={toasts} />);
  await waitForFrame(app, (frame) => !frame.includes('Loading'));
  return { app, services, clock };
}

const story = (t: TempRoot) => createRepositories(t.root).stories.findByKey('WEB-1');

describe('story detail Tasks tab', () => {
  it('adds a Task, moves its Stage and deletes it', async () => {
    const t = await setup();
    const { app } = await open(t, 'story', { key: 'WEB-1' });
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('No Tasks yet. Press n to create one.'));

    await app.press('n');
    // The breadcrumb shows the title while the form loads; wait for the form itself.
    await waitForFrame(app, (f) => f.includes('New Task on WEB-1') && f.includes('Name*'));
    await app.press(...'Write tests', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('WEB-1.1 Write tests ● Backlog'));
    expect((await story(t)).tasks).toMatchObject([{ id: 'WEB-1.1', name: 'Write tests', stage: 'backlog' }]);

    await app.press('m');
    await waitForFrame(app, (f) => f.includes('Move WEB-1.1 to'));
    await app.press(KEYS.down, KEYS.down, KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Moved WEB-1.1 to in-progress') && f.includes('● In Progress'));
    const moved = await story(t);
    expect(moved.tasks[0]?.stage).toBe('in-progress');
    expect(moved.stage).toBe('backlog');

    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete WEB-1.1'));
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted WEB-1.1') && f.includes('No Tasks yet'));
    expect(await createRepositories(t.root).stories.findByKey('WEB-1')).toMatchObject({ tasks: [], nextTaskNumber: 2 });
    app.unmount();
  });

  it('edits a Task and opens its detail with inherited Assignees and Comments', async () => {
    const t = await setup();
    const { app, services } = await open(t, 'story', { key: 'WEB-1' });
    await services.tasks.create('WEB-1', { name: 'Old' });
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('WEB-1.1 Old'));
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Edit WEB-1.1') && f.includes('Name*'));
    await app.press(KEYS.backspace, KEYS.backspace, KEYS.backspace, ...'New', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('WEB-1.1 New') && f.includes('Updated WEB-1.1'));

    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('alice (from the Story)'));
    // Comments are on their own tab, so `e` and `d` on Details act on the Task.
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('No Comments yet. Press c to add one.'));
    await app.press('c');
    await waitForFrame(app, (f) => f.includes('New Comment on WEB-1.1') && f.includes('Comment*'));
    await app.press(...'Looks good', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Added Comment'));
    expect((await story(t)).tasks[0]?.comments).toMatchObject([{ author: 'alice', body: 'Looks good' }]);
    expect((await story(t)).comments).toEqual([]);
    app.unmount();
  });
});

describe('task detail', () => {
  it('edits, moves and deletes the Task with e, m and d, like the Tasks tab', async () => {
    const t = await setup();
    const { app, services } = await open(t, 'story', { key: 'WEB-1' });
    await services.tasks.create('WEB-1', { name: 'Old' });
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('WEB-1.1 Old'));
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('alice (from the Story)'));
    expect(app.lastFrame()).toContain('e edit · m move Stage · d delete');

    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Edit WEB-1.1') && f.includes('Name*'));
    await app.press(KEYS.backspace, KEYS.backspace, KEYS.backspace, ...'New', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('WEB-1.1 New') && f.includes('Updated WEB-1.1'));
    expect((await story(t)).tasks[0]?.name).toBe('New');

    await app.press('m');
    await waitForFrame(app, (f) => f.includes('Move WEB-1.1 to'));
    await app.press(KEYS.down, KEYS.down, KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Moved WEB-1.1 to in-progress') && f.includes('● In Progress'));
    expect((await story(t)).tasks[0]?.stage).toBe('in-progress');

    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete WEB-1.1 "New" with its Comments?'));
    await app.press('n');
    await waitForFrame(app, (f) => !f.includes('Delete WEB-1.1'));
    expect((await story(t)).tasks).toHaveLength(1);
    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete WEB-1.1'));
    await app.press('y');
    // Back on the Story's Tasks tab.
    await waitForFrame(app, (f) => f.includes('Deleted WEB-1.1') && f.includes('No Tasks yet'));
    expect((await story(t)).tasks).toEqual([]);
    app.unmount();
  });
});

describe('CommentsPanel', () => {
  it('adds, edits and deletes a Comment from the story detail tabs', async () => {
    const t = await setup();
    const { app, clock } = await open(t, 'story', { key: 'WEB-1' });
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
    expect((await story(t)).comments).toMatchObject([{ id: 'id000001', author: 'alice', body: 'first line' }]);

    clock.advance(5 * 60_000);
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Edit Comment on WEB-1') && f.includes('first line'));
    // `enter` starts a new line in the Comment.
    await app.press(KEYS.enter, ...'second line', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Updated Comment') && f.includes('alice · 5m ago (edited)'));
    expect((await story(t)).comments[0]?.body).toBe('first line\nsecond line');

    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete the Comment by alice?'));
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted Comment') && f.includes('No Comments yet'));
    const after = await story(t);
    expect(after.comments).toEqual([]);
    expect(after.name).toBe('Login');
    app.unmount();
  });

  it('formats relative times', () => {
    const now = new Date('2026-10-12T17:21:07.000Z');
    expect(relativeTime('2026-10-12T17:21:00.000Z', now)).toBe('just now');
    expect(relativeTime('2026-10-12T14:21:07.000Z', now)).toBe('3h ago');
    expect(relativeTime('2026-10-10T17:21:07.000Z', now)).toBe('2d ago');
    expect(relativeTime('2025-10-12T17:21:07.000Z', now)).toBe('1y ago');
  });
});
