import { describe, expect, it } from 'vitest';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import type { RouteParams } from '../../src/tui/router';
import { fixedClock, fixedIds, makeBoard, makeStory, type TempRoot, tempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from './helpers';

const web = { boardId: 'web' };

async function setup() {
  const t = await tempRoot();
  await makeBoard(t.path, {
    ...web,
    id: 'web',
    keyPrefix: 'WEB',
    customFields: [{ key: 'size', name: 'Size', type: 'select', options: ['s', 'm', 'l'], required: false }],
  });
  return t;
}

/** The real App over a temp Data Root, opened on `screen`. */
async function open(t: TempRoot, screen: string, params: RouteParams = {}, me: string | null = null) {
  const toasts = createToastStore();
  const ctx: RowblyContext = {
    root: t.root,
    local: { version: 1 },
    me,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => toasts.push('warning', message),
  };
  const app = renderTui(<App ctx={ctx} services={createServices(ctx)} initial={{ screen, params }} toasts={toasts} />);
  await waitForFrame(app, (frame) => !frame.includes('Loading'));
  return app;
}

const story = (t: TempRoot, key: string) => createRepositories(t.root).stories.findByKey(key);

describe('story form', () => {
  it('creates a Story with a select Custom Field from the list screen', async () => {
    const t = await setup();
    const app = await open(t, 'stories');
    expect(app.lastFrame()).toContain('No Stories yet. Press n to create one.');
    await app.press('n');
    await waitForFrame(app, (f) => f.includes('New Story on web'));
    expect(app.lastFrame()).toContain('‹ backlog ›');
    // name, description, stage, priority, labels, due, size
    await app.press(...'Login page', KEYS.down, KEYS.down, KEYS.right, KEYS.down);
    await app.press(KEYS.right, KEYS.right, KEYS.down, ...'ui,auth', KEYS.down, KEYS.down, KEYS.right);
    expect(app.lastFrame()).toContain('‹ s ›');
    await app.press(KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('WEB-1 Login page') && f.includes('Details'));

    expect(await story(t, 'WEB-1')).toMatchObject({
      name: 'Login page',
      stage: 'todo',
      priority: 'P1',
      labels: ['ui', 'auth'],
      customFields: { size: 's' },
    });
    expect(app.lastFrame()).toMatch(/Size +s/);
    app.unmount();
  });

  it('shows validation errors from the service inline', async () => {
    const t = await setup();
    const app = await open(t, 'story-form', web);
    await waitForFrame(app, (f) => f.includes('Name*'));
    await app.press(...'X', ...Array(4).fill(KEYS.down), ...'Bad Label', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('must be lower-kebab-case'));
    expect(await createRepositories(t.root).stories.allInBoard('web')).toEqual([]);
    app.unmount();
  });

  it('edits a Story, including its Stage, and returns to the detail screen', async () => {
    const t = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', name: 'Old', customFields: { size: 'm' } });
    const app = await open(t, 'story', { key: 'WEB-1' });
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Name*'));
    await app.press(KEYS.backspace, KEYS.backspace, KEYS.backspace, ...'New');
    // stage → todo; size: (none) s m l → back to (none) unsets it
    await app.press(KEYS.down, KEYS.down, KEYS.right);
    await app.press(KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.left, KEYS.left);
    await app.press(KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('WEB-1 New') && f.includes('Updated WEB-1'));
    expect(await story(t, 'WEB-1')).toMatchObject({ name: 'New', stage: 'todo', customFields: {} });
    app.unmount();
  });
});

describe('story detail', () => {
  it('moves a Story to another Stage', async () => {
    const t = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', name: 'Ship it', description: '# Notes\nsome **bold** text' });
    const app = await open(t, 'story', { key: 'WEB-1' });
    expect(app.lastFrame()).toContain('● Backlog');
    expect(app.lastFrame()).toContain('some bold text');
    await app.press('m');
    expect(app.lastFrame()).toContain('Move WEB-1 to');
    await app.press(KEYS.down, KEYS.down, KEYS.down, KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Moved WEB-1 to done') && f.includes('● Done'));
    expect((await story(t, 'WEB-1')).stage).toBe('done');
    app.unmount();
  });

  it('deletes the Story after confirming', async () => {
    const t = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1' });
    const app = await open(t, 'stories');
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Details'));
    expect(app.lastFrame()).toMatch(/Updated\s+2026-/);
    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete WEB-1'));
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted WEB-1') && f.includes('No Stories yet'));
    await expect(story(t, 'WEB-1')).rejects.toThrow('not found');
    app.unmount();
  });
});

describe('story list', () => {
  it('filters by label and search, and clears filters', async () => {
    const t = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', name: 'Mine', labels: ['ui'] });
    await makeStory(t.path, { ...web, key: 'WEB-2', name: 'Theirs' });
    const app = await open(t, 'stories');
    expect(app.lastFrame()).toContain('WEB-1 Mine ● Backlog #ui');
    expect(app.lastFrame()).toContain('WEB-2 Theirs');
    expect(app.lastFrame()).toContain('/ filter · c clear filter');
    // The help lists the screen's `/` instead of the global "filter lists".
    await app.press('?');
    expect(app.lastFrame()).toMatch(/│\s+\/\s+filter\s+│/);
    expect(app.lastFrame()).not.toContain('filter lists');
    await app.press('?');

    // stage, label, priority, search
    await app.press('/', KEYS.down, ' ', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('filters: #ui') && !f.includes('WEB-2'));
    await app.press('c');
    await waitForFrame(app, (f) => f.includes('WEB-2'));

    await app.press('/', ...Array(3).fill(KEYS.down), ...'nothing', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('No Stories match.'));
    app.unmount();
  });

  it('filters open Stories and sorts them, like --open and --sort', async () => {
    const t = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', name: 'Low', stage: 'backlog', rank: 'a0', priority: 'P3' });
    await makeStory(t.path, { ...web, key: 'WEB-2', name: 'High', stage: 'backlog', rank: 'a1', priority: 'P0' });
    await makeStory(t.path, { ...web, key: 'WEB-3', name: 'Shipped', stage: 'done', rank: 'a0', priority: 'P1' });
    const app = await open(t, 'stories');
    expect(app.lastFrame()).toContain('WEB-3 Shipped');
    // stages, labels, priorities, search, category, open, sort
    await app.press('/', ...Array(5).fill(KEYS.down), ' ', KEYS.down, KEYS.right, KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('filters: open · sorted by priority') && !f.includes('WEB-3'));
    const frame = app.lastFrame() ?? '';
    expect(frame.indexOf('WEB-2 High')).toBeLessThan(frame.indexOf('WEB-1 Low'));
    // Several priorities at once, like a repeated --priority.
    await app.press(
      'c',
      '/',
      ...Array(2).fill(KEYS.down),
      ' ',
      KEYS.right,
      KEYS.right,
      KEYS.right,
      ' ',
      KEYS.ctrlEnter,
    );
    await waitForFrame(app, (f) => f.includes('filters: P0 P3') && !f.includes('WEB-3'));
    expect(app.lastFrame()).toContain('WEB-1 Low');
    app.unmount();
  });
});
