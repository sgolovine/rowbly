import { describe, expect, it } from 'vitest';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import type { RouteParams } from '../../src/tui/router';
import {
  fixedClock,
  fixedIds,
  makeBoard,
  makeEpic,
  makeStory,
  makeWorkspace,
  type TempRoot,
  tempRoot,
} from '../helpers';
import { KEYS, renderTui, tick } from './helpers';

const web = { workspaceId: 'acme', boardId: 'web' };

async function setup() {
  const t = await tempRoot();
  await makeWorkspace(t.path, {
    id: 'acme',
    assignees: [
      { handle: 'alice', name: 'Alice' },
      { handle: 'bob', name: 'Bob' },
    ],
  });
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
  await waitFor(app, (frame) => !frame.includes('Loading'));
  return app;
}

async function waitFor(app: { lastFrame(): string | undefined }, ok: (frame: string) => boolean) {
  for (let i = 0; i < 50; i++) {
    if (ok(app.lastFrame() ?? '')) return;
    await tick(20);
  }
  throw new Error(`timed out; last frame:\n${app.lastFrame()}`);
}

const story = (t: TempRoot, key: string) => createRepositories(t.root).stories.findByKey(key);

describe('story form', () => {
  it('creates a Story with a select Custom Field from the list screen', async () => {
    const t = await setup();
    const app = await open(t, 'stories');
    expect(app.lastFrame()).toContain('No Stories yet. Press n to create one.');
    await app.press('n');
    await waitFor(app, (f) => f.includes('New Story on acme/web'));
    expect(app.lastFrame()).toContain('‹ backlog ›');
    // name, description, stage, assignees, epic, priority, labels, due, size
    await app.press(...'Login page', KEYS.down, KEYS.down, KEYS.right, KEYS.down, ' ', KEYS.down, KEYS.down);
    await app.press(KEYS.right, KEYS.right, KEYS.down, ...'ui,auth', KEYS.down, KEYS.down, KEYS.right);
    expect(app.lastFrame()).toContain('‹ s ›');
    await app.press(KEYS.enter);
    await waitFor(app, (f) => f.includes('WEB-1 Login page') && f.includes('Details'));

    expect(await story(t, 'WEB-1')).toMatchObject({
      name: 'Login page',
      stage: 'todo',
      assignees: ['alice'],
      priority: 'P1',
      labels: ['ui', 'auth'],
      customFields: { size: 's' },
    });
    expect(app.lastFrame()).toMatch(/Size +s/);
    app.unmount();
  });

  it('shows validation errors from the service inline', async () => {
    const t = await setup();
    const app = await open(t, 'story-form', { ref: web });
    await waitFor(app, (f) => f.includes('Name*'));
    await app.press(...'X', ...Array(6).fill(KEYS.down), ...'Bad Label', KEYS.enter);
    await waitFor(app, (f) => f.includes('must be lower-kebab-case'));
    expect(await createRepositories(t.root).stories.allInBoard(web)).toEqual([]);
    app.unmount();
  });

  it('edits a Story, including its Stage, and returns to the detail screen', async () => {
    const t = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', name: 'Old', customFields: { size: 'm' } });
    const app = await open(t, 'story', { key: 'WEB-1' });
    await app.press('e');
    await waitFor(app, (f) => f.includes('Name*'));
    await app.press(KEYS.backspace, KEYS.backspace, KEYS.backspace, ...'New');
    // stage → todo; size: (none) s m l → back to (none) unsets it
    await app.press(KEYS.down, KEYS.down, KEYS.right);
    await app.press(KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.left, KEYS.left);
    await app.press(KEYS.enter);
    await waitFor(app, (f) => f.includes('WEB-1 New') && f.includes('Updated WEB-1'));
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
    await waitFor(app, (f) => f.includes('Moved WEB-1 to done') && f.includes('● Done'));
    expect((await story(t, 'WEB-1')).stage).toBe('done');
    app.unmount();
  });

  it('switches tabs and deletes the Story after confirming', async () => {
    const t = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1' });
    const app = await open(t, 'stories');
    await app.press(KEYS.enter);
    await waitFor(app, (f) => f.includes('Details'));
    await app.press(KEYS.tab);
    await waitFor(app, (f) => f.includes('No Tasks yet'));
    await app.press(KEYS.tab);
    await waitFor(app, (f) => f.includes('No Comments yet'));
    await app.press(KEYS.tab, 'd');
    expect(app.lastFrame()).toContain('Delete WEB-1');
    await app.press('y');
    await waitFor(app, (f) => f.includes('Deleted WEB-1') && f.includes('No Stories yet'));
    await expect(story(t, 'WEB-1')).rejects.toThrow('not found');
    app.unmount();
  });
});

describe('story list', () => {
  it('filters by me, label and search, and clears filters', async () => {
    const t = await setup();
    await makeEpic(t.path, { id: 'launch', workspaceId: 'acme' });
    await makeStory(t.path, { ...web, key: 'WEB-1', name: 'Mine', assignees: ['alice'], labels: ['ui'] });
    await makeStory(t.path, { ...web, key: 'WEB-2', name: 'Theirs', assignees: ['bob'], epicId: 'launch' });
    const app = await open(t, 'stories', {}, 'alice');
    expect(app.lastFrame()).toContain('WEB-1 Mine ● Backlog @alice #ui');
    expect(app.lastFrame()).toContain('WEB-2 Theirs');

    // stage, assignee, me, label, priority, epic, search
    await app.press('f', KEYS.down, KEYS.down, ' ', KEYS.enter);
    await waitFor(app, (f) => f.includes('filters: mine') && !f.includes('WEB-2'));
    await app.press('c');
    await waitFor(app, (f) => f.includes('WEB-2'));

    await app.press('f', ...Array(5).fill(KEYS.down), KEYS.right, KEYS.right, KEYS.enter);
    await waitFor(app, (f) => f.includes('filters: Epic launch') && !f.includes('WEB-1'));
    await app.press('c', 'f', ...Array(6).fill(KEYS.down), ...'nothing', KEYS.enter);
    await waitFor(app, (f) => f.includes('No Stories match.'));
    app.unmount();
  });
});
