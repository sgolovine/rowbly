// The Assignees Plugin in the TUI: its settings section, the Story form field, the Story filter and
// the `@handle` badges it shows on board cards and Story list rows (`PluginTui.storyBadges`).
import { describe, expect, it, vi } from 'vitest';
import { definePlugin } from '../../src/plugin-api';
import { assignees } from '../../src/plugins/assignees';
import { tasks } from '../../src/plugins/tasks';
import { createTask } from '../../src/plugins/tasks/tasks';
import type { LocalState } from '../../src/schemas';
import { assigned, makeRoster, makeStory, type TempRoot } from '../helpers';
import { KEYS, waitForFrame } from '../tui/helpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';
import { focusFormField, focusListItem, openPluginApp } from './tuiHelpers';

async function seed(on: Record<string, true> = {}) {
  const t = await pluginRoot({ assignees: true, ...on });
  await makeRoster(t.path, [
    { handle: 'sam', name: 'Sam' },
    { handle: 'ana', name: 'Ana' },
  ]);
  await makeStory(t.path, { key: 'WEB-1', boardId: 'web', name: 'Login', ...assigned('sam') });
  await makeStory(t.path, { key: 'WEB-2', boardId: 'web', name: 'Signup', rank: 'a1', ...assigned('ana') });
  await makeStory(t.path, { key: 'WEB-3', boardId: 'web', name: 'Logout', rank: 'a2' });
  return t;
}

function open(
  t: TempRoot,
  screen: string,
  params: Record<string, unknown> = {},
  opts: { me?: string; registry?: Parameters<typeof openPluginApp>[1] } = {},
) {
  const local: LocalState = { version: 1, board: 'web' };
  return openPluginApp(t, opts.registry ?? [assignees], { screen, params }, { local, me: opts.me ?? null });
}

const roster = async (t: TempRoot) =>
  ((await readJsonFile(t, 'plugins/assignees/roster.json')).assignees as { handle: string }[]).map((a) => a.handle);
const bag = async (t: TempRoot, key: string) =>
  ((await readJsonFile(t, storyFile(key))) as { plugins?: { assignees?: unknown } }).plugins?.assignees;

describe('Assignees TUI', () => {
  it('shows Assignees and Task progress together on the board', async () => {
    const t = await seed({ tasks: true });
    const { services } = await withPlugins(t, [assignees, tasks]);
    const plugin = services.plugins.context('tasks');
    await createTask(plugin, 'WEB-1', { name: 'Done', stage: 'done' });
    await createTask(plugin, 'WEB-1', { name: 'Next', stage: 'todo' });
    const { app } = await open(t, 'board', { boardId: 'web' }, { registry: [assignees, tasks] });
    try {
      await waitForFrame(app, (frame) => frame.includes('@sam · ✓ 1/2'));
    } finally {
      app.unmount();
    }
  });

  it('adds, edits and removes Assignees from the settings section', async () => {
    const t = await seed();
    const { app, toasts } = await open(t, 'home', {}, { me: 'ana' });
    await waitForFrame(app, (f) => f.includes('WEB-1') && f.includes('● Backlog'));
    await app.press(',');
    await waitForFrame(app, 'Board: Website');
    await focusListItem(app, 'Assignees');
    await waitForFrame(app, (f) => f.includes('ana (me)') && f.includes('sam'));
    await app.press(KEYS.tab);
    await waitForFrame(app, 'n add assignee');

    await app.press('n');
    await waitForFrame(app, (f) => f.includes('New Assignee') && f.includes('Handle*'));
    await app.press(...'bob', KEYS.tab, ...'Bob', KEYS.tab, ...'bob@example.com', KEYS.ctrlS);
    await waitForFrame(app, (f) => f.includes('Added Assignee bob') && f.includes('Bob <bob@example.com>'));
    expect(await roster(t)).toEqual(['sam', 'ana', 'bob']);

    // Open sam, edit the name, then remove sam from the roster and from WEB-1.
    await focusListItem(app, 'sam');
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => /Handle\s+sam/.test(f) && f.includes('Remove'));
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Edit Assignee sam') && f.includes('Name*'));
    await app.press(KEYS.end, ...' S', KEYS.ctrlS);
    await waitForFrame(app, (f) => f.includes('Updated Assignee sam') && /Name\s+Sam S/.test(f));
    await focusListItem(app, 'Remove');
    await app.press(KEYS.enter);
    await waitForFrame(app, 'Remove Assignee "sam"? They are also removed from every Story.');
    await app.press('y');
    await waitForFrame(
      app,
      (f) => f.includes('Removed Assignee sam') && f.includes('ana (me)') && !f.includes('Sam S'),
    );
    expect(await roster(t)).toEqual(['ana', 'bob']);
    expect(await bag(t, 'WEB-1')).toBeUndefined();
    expect(toasts.list().map((toast) => toast.message)).toContain('Assignee "sam" removed from 1 story');
    app.unmount();
  });

  it('assigns from the Story form and shows the Assignees row', async () => {
    const t = await seed();
    const { app } = await open(t, 'story', { key: 'WEB-3' });
    await waitForFrame(app, (f) => /Assignees\s+none/.test(f) && f.includes('Details'));
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Edit WEB-3') && f.includes('Assignees'));
    await focusFormField(app, 'Assignees');
    // sam, then ana.
    await app.press(' ', KEYS.right, ' ', KEYS.ctrlS);
    await waitForFrame(app, (f) => f.includes('Updated WEB-3') && /Assignees\s+sam, ana/.test(f));
    expect(await bag(t, 'WEB-3')).toEqual({ assignees: ['sam', 'ana'] });

    // Untoggling both clears the bag.
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Edit WEB-3') && f.includes('Assignees'));
    await focusFormField(app, 'Assignees');
    await app.press(' ', KEYS.right, ' ', KEYS.ctrlS);
    await waitForFrame(app, (f) => f.includes('Updated WEB-3') && /Assignees\s+none/.test(f));
    expect(await bag(t, 'WEB-3')).toBeUndefined();
    app.unmount();
  });

  it.each(['stories', 'board'])('filters %s by Assignee and by "Assigned to me"', async (screen) => {
    const t = await seed();
    const { app } = await open(t, screen, { boardId: 'web' }, { me: 'ana' });
    // The board shows two cards of the Backlog at this size; WEB-3 is below them.
    await waitForFrame(app, (f) => f.includes('WEB-1') && f.includes('WEB-2'));
    await app.press('/');
    await focusFormField(app, 'Assignees');
    await app.press(' ', KEYS.ctrlS);
    await waitForFrame(app, (f) => f.includes('@sam') && f.includes('WEB-1') && !f.includes('WEB-2'));
    await app.press('c');
    await waitForFrame(app, (f) => f.includes('WEB-1') && f.includes('WEB-2') && !f.includes('@sam ·'));

    await app.press('/');
    await focusFormField(app, 'Assigned to me');
    await app.press(' ', KEYS.ctrlS);
    await waitForFrame(app, (f) => f.includes('mine') && f.includes('WEB-2') && !f.includes('WEB-1'));
    app.unmount();
  });

  it.each([
    { screen: 'board', row: /WEB-1[\s\S]*@sam/ },
    { screen: 'stories', row: /WEB-1 Login ● Backlog @sam/ },
  ])('shows @handle badges on the $screen', async ({ screen, row }) => {
    const t = await seed();
    const { app } = await open(t, screen, { boardId: 'web' });
    const frame = await waitForFrame(app, (f) => f.includes('WEB-2') && f.includes('@ana'));
    expect(frame).toMatch(row);
    expect(frame).not.toContain('@WEB');
    app.unmount();
  });

  describe('a Plugin whose badges throw', () => {
    const broken = definePlugin({
      id: 'broken',
      name: 'Broken',
      description: '',
      tui: async () => ({
        storyBadges: () => {
          throw new Error('badge bug');
        },
      }),
    });

    it('shows none in the Story list, whose rows and Stories still open', async () => {
      const t = await seed({ broken: true });
      const { app } = await open(t, 'stories', { boardId: 'web' }, { registry: [assignees, broken] });
      let frame = await waitForFrame(app, (f) => f.includes('WEB-1 Login ● Backlog @sam') && f.includes('WEB-3'));
      expect(frame).not.toContain('badge bug');
      await app.press(KEYS.enter);
      frame = await waitForFrame(app, (f) => /Assignees\s+sam/.test(f) && f.includes('Details'));
      expect(frame).not.toContain('badge bug');
      app.unmount();
    });

    it('shows none on board cards, and the board still moves cards', async () => {
      const t = await seed({ broken: true });
      const { app } = await open(t, 'board', { boardId: 'web' }, { registry: [assignees, broken] });
      const frame = await waitForFrame(app, (f) => f.includes('@sam') && f.includes('@ana'));
      expect(frame).not.toContain('badge bug');
      await app.press('L');
      await waitForFrame(app, (f) => f.includes('● Backlog (2)') && f.includes('● Todo (1)'));
      await vi.waitFor(async () => expect((await readJsonFile(t, storyFile('WEB-1'))).stage).toBe('todo'));
      app.unmount();
    });
  });
});
