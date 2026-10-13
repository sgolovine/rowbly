import { describe, expect, it } from 'vitest';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { fixedClock, fixedIds, makeBoard, makeStory, makeWorkspace, type TempRoot, tempRoot } from '../helpers';
import { KEYS, renderTui, tick } from './helpers';

/** The real App over a temp Data Root; `ctx.warn` feeds the toasts as in `startTui`. */
function renderScreen(t: TempRoot, screen: string, params: Record<string, unknown> = {}) {
  const toasts = createToastStore();
  const ctx: RowblyContext = {
    root: t.root,
    local: { version: 1 },
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => toasts.push('warning', message),
  };
  const app = renderTui(<App ctx={ctx} services={createServices(ctx)} initial={{ screen, params }} toasts={toasts} />);
  return { app, ctx };
}

/** Waits for async service calls to settle and the frame to update. */
async function settle(app: { press(...keys: string[]): Promise<void> }) {
  await tick(50);
  await app.press();
}

describe('workspaces screen', () => {
  it('creates a Workspace through the form', async () => {
    const t = await tempRoot();
    const { app } = renderScreen(t, 'workspaces');
    await settle(app);
    expect(app.lastFrame()).toContain('No Workspaces yet. Press n to create one.');

    await app.press('n');
    await settle(app);
    expect(app.lastFrame()).toContain('New Workspace');
    await app.press(...'acme', KEYS.down, ...'Acme Corp', KEYS.enter);
    await settle(app);

    expect(app.lastFrame()).toContain('Created Workspace acme');
    expect(app.lastFrame()).toContain('acme Acme Corp');
    expect(await createRepositories(t.root).workspaces.get('acme')).toMatchObject({ name: 'Acme Corp' });
    app.unmount();
  });

  it('shows service validation errors inline in the form', async () => {
    const t = await tempRoot();
    const { app } = renderScreen(t, 'workspaces', { view: 'create' });
    await settle(app);
    await app.press(...'Bad Id', KEYS.down, ...'x', KEYS.enter);
    await settle(app);
    expect(app.lastFrame()).toContain('must be a lower-kebab-case slug');
    app.unmount();
  });

  it('selecting a Workspace makes it the current context', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme', name: 'Acme' });
    await makeWorkspace(t.path, { id: 'labs', name: 'Labs' });
    const { app, ctx } = renderScreen(t, 'workspaces');
    await settle(app);
    await app.press('j', KEYS.enter);
    await settle(app);
    expect(ctx.local.workspace).toBe('labs');
    expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, workspace: 'labs' });
    expect(app.lastFrame()).toContain('Now using Workspace labs');
    expect(app.lastFrame()).toMatch(/Boards\s+0/);
    app.unmount();
  });

  it('edits a Workspace', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme', name: 'Acme' });
    const { app } = renderScreen(t, 'workspaces', { view: 'edit', id: 'acme' });
    await settle(app);
    await app.press(KEYS.backspace, KEYS.backspace, KEYS.backspace, KEYS.backspace, ...'ACME', KEYS.enter);
    await settle(app);
    expect((await createRepositories(t.root).workspaces.get('acme')).name).toBe('ACME');
    app.unmount();
  });

  it('deletes a non-empty Workspace after confirming', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    const { app } = renderScreen(t, 'workspaces');
    await settle(app);
    await app.press(KEYS.enter);
    await settle(app);
    await app.press('j', 'j', KEYS.enter);
    expect(app.lastFrame()).toContain('Delete Workspace "acme" and everything in it (1 Board, 0 Epics)?');
    await app.press('n');
    expect(app.lastFrame()).not.toContain('Delete Workspace');
    await app.press('j', 'j', KEYS.enter, 'y');
    await settle(app);
    expect(app.lastFrame()).toContain('Deleted Workspace acme');
    expect(app.lastFrame()).toContain('No Workspaces yet');
    expect(await createRepositories(t.root).workspaces.list()).toEqual([]);
    app.unmount();
  });
});

describe('assignees screen', () => {
  it('removes an Assignee after confirming and shows the Story count warning', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, {
      id: 'acme',
      assignees: [
        { handle: 'ana', name: 'Ana' },
        { handle: 'sam', name: 'Sam', email: 'sam@example.com' },
      ],
    });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    await makeStory(t.path, { key: 'WEB-1', workspaceId: 'acme', boardId: 'web', assignees: ['sam'] });
    const { app } = renderScreen(t, 'assignees');
    await settle(app);
    expect(app.lastFrame()).toContain('Assignees in acme');
    expect(app.lastFrame()).toContain('sam Sam <sam@example.com>');

    await app.press('j', KEYS.enter);
    await settle(app);
    expect(app.lastFrame()).toMatch(/Email\s+sam@example\.com/);
    await app.press('j', KEYS.enter);
    expect(app.lastFrame()).toContain('Remove Assignee "sam"?');
    await app.press('y');
    await settle(app);

    expect(app.lastFrame()).toContain('Assignee "sam" removed from 1 story');
    expect(app.lastFrame()).toContain('Removed Assignee sam');
    const repos = createRepositories(t.root);
    expect((await repos.workspaces.get('acme')).assignees.map((a) => a.handle)).toEqual(['ana']);
    expect((await repos.stories.findByKey('WEB-1')).assignees).toEqual([]);
    app.unmount();
  });

  it('adds and edits an Assignee through the form', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    const { app } = renderScreen(t, 'assignees', { workspaceId: 'acme' });
    await settle(app);
    await app.press('n');
    await settle(app);
    await app.press(...'sam', KEYS.down, ...'Sam', KEYS.down, ...'nope', KEYS.enter);
    await settle(app);
    expect(app.lastFrame()).toContain('Invalid email address');
    await app.press(...Array(4).fill(KEYS.backspace), ...'sam@example.com', KEYS.enter);
    await settle(app);
    expect(app.lastFrame()).toContain('Added Assignee sam');

    await app.press(KEYS.enter);
    await settle(app);
    await app.press(KEYS.enter);
    await settle(app);
    await app.press(KEYS.down, ...Array(15).fill(KEYS.backspace), KEYS.enter);
    await settle(app);
    const [sam] = (await createRepositories(t.root).workspaces.get('acme')).assignees;
    expect(sam).toEqual({ handle: 'sam', name: 'Sam' });
    app.unmount();
  });
});
