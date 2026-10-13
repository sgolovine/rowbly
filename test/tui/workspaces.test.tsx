import { describe, expect, it } from 'vitest';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { fixedClock, fixedIds, makeBoard, makeStory, makeWorkspace, type TempRoot, tempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from './helpers';

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

describe('workspaces screen', () => {
  it('creates a Workspace through the form', async () => {
    const t = await tempRoot();
    const { app } = renderScreen(t, 'workspaces');
    await waitForFrame(app, 'No Workspaces yet. Press n to create one.');

    await app.press('n');
    await waitForFrame(app, 'Id*');
    expect(app.lastFrame()).toContain('New Workspace');
    await app.press(...'acme', KEYS.down, ...'Acme Corp', KEYS.enter);
    await waitForFrame(app, 'acme Acme Corp');

    expect(app.lastFrame()).toContain('Created Workspace acme');
    expect(await createRepositories(t.root).workspaces.get('acme')).toMatchObject({ name: 'Acme Corp' });
    app.unmount();
  });

  it('shows service validation errors inline in the form', async () => {
    const t = await tempRoot();
    const { app } = renderScreen(t, 'workspaces', { view: 'create' });
    await waitForFrame(app, 'Id*');
    await app.press(...'Bad Id', KEYS.down, ...'x', KEYS.enter);
    await waitForFrame(app, 'must be a lower-kebab-case slug');
    app.unmount();
  });

  it('selecting a Workspace makes it the current context', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme', name: 'Acme' });
    await makeWorkspace(t.path, { id: 'labs', name: 'Labs' });
    const { app, ctx } = renderScreen(t, 'workspaces');
    await waitForFrame(app, 'labs Labs');
    await app.press('j', KEYS.enter);
    await waitForFrame(app, /Boards\s+0/);
    expect(ctx.local.workspace).toBe('labs');
    expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, workspace: 'labs' });
    expect(app.lastFrame()).toContain('Now using Workspace labs');
    expect(app.lastFrame()).toMatch(/Boards\s+0/);
    expect(app.lastFrame()).toMatch(/Stages\s+built-in defaults/);
    expect(app.lastFrame()).toMatch(/Custom Fields\s+none/);
    app.unmount();
  });

  it('edits a Workspace', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme', name: 'Acme' });
    const { app } = renderScreen(t, 'workspaces', { view: 'edit', id: 'acme' });
    await waitForFrame(app, 'Edit Workspace acme');
    await app.press(KEYS.backspace, KEYS.backspace, KEYS.backspace, KEYS.backspace, ...'ACME', KEYS.enter);
    await waitForFrame(app, 'Updated Workspace acme');
    expect((await createRepositories(t.root).workspaces.get('acme')).name).toBe('ACME');
    app.unmount();
  });

  it('deletes a non-empty Workspace after confirming', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    const { app } = renderScreen(t, 'workspaces');
    await waitForFrame(app, 'acme');
    await app.press(KEYS.enter);
    await waitForFrame(app, /Boards\s+1/);
    // Boards, Epics, Assignees, Edit, Delete
    await app.press('j', 'j', 'j', 'j', KEYS.enter);
    await waitForFrame(app, 'Delete Workspace "acme" and everything in it (1 Board, 0 Epics)?');
    await app.press('n');
    expect(app.lastFrame()).not.toContain('Delete Workspace');
    await app.press('j', 'j', 'j', 'j', KEYS.enter, 'y');
    await waitForFrame(app, 'No Workspaces yet');
    expect(app.lastFrame()).toContain('Deleted Workspace acme');
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
    await waitForFrame(app, 'sam Sam <sam@example.com>');
    expect(app.lastFrame()).toContain('Assignees in acme');

    await app.press('j', KEYS.enter);
    await waitForFrame(app, /Email\s+sam@example\.com/);
    await app.press('j', KEYS.enter);
    expect(app.lastFrame()).toContain('Remove Assignee "sam"?');
    await app.press('y');
    await waitForFrame(app, 'Assignee "sam" removed from 1 story');

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
    await waitForFrame(app, 'No Assignees yet');
    await app.press('n');
    await waitForFrame(app, 'Handle*');
    await app.press(...'sam', KEYS.down, ...'Sam', KEYS.down, ...'nope', KEYS.enter);
    await waitForFrame(app, 'Invalid email address');
    await app.press(...Array(4).fill(KEYS.backspace), ...'sam@example.com', KEYS.enter);
    await waitForFrame(app, 'sam Sam <sam@example.com>');
    expect(app.lastFrame()).toContain('Added Assignee sam');

    await app.press(KEYS.enter);
    await waitForFrame(app, /Email\s+sam@example\.com/);
    await app.press(KEYS.enter);
    await waitForFrame(app, 'Edit Assignee sam');
    await app.press(KEYS.down, ...Array(15).fill(KEYS.backspace), KEYS.enter);
    await waitForFrame(app, 'Updated Assignee sam');
    const [sam] = (await createRepositories(t.root).workspaces.get('acme')).assignees;
    expect(sam).toEqual({ handle: 'sam', name: 'Sam' });
    app.unmount();
  });
});
