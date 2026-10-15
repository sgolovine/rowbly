// The TUI slots that Plugins fill, with the Notes fixture Plugin on.
import { describe, expect, it } from 'vitest';
import { reservedNames } from '../../src/main';
import { definePlugin } from '../../src/plugin-api';
import type { LocalState } from '../../src/schemas';
import { loadPlugins } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { loadTuiPlugins } from '../../src/tui/loadPlugins';
import type { RouteParams } from '../../src/tui/router';
import { makeBoard, makeStory, type TempRoot } from '../helpers';
import { KEYS, waitForFrame } from '../tui/helpers';
import { fixturePlugins, notes } from './fixtures';
import { type Entries, pluginRoot, readJsonFile, storyFile } from './helpers';
import { focusFormField, focusListItem, openPluginApp } from './tuiHelpers';

async function seed(on: Entries = { notes: true }) {
  const t = await pluginRoot(on);
  await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login', plugins: { notes: { note: 'hello' } } });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-2', name: 'Signup', rank: 'a1' });
  return t;
}

function open(t: TempRoot, screen: string, params: RouteParams = {}, local: LocalState = { version: 1 }) {
  return openPluginApp(t, fixturePlugins, { screen, params }, { local });
}

describe('Plugin slots in the TUI', () => {
  it('the home menu lists Plugin entries, which open Plugin screens', async () => {
    const t = await seed();
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    const { app } = await open(t, 'home');
    let frame = await waitForFrame(app, 'Notes');
    expect(frame).toContain('Doctor');
    await focusListItem(app, 'Notes');
    await app.press(KEYS.enter);
    frame = await waitForFrame(app, 'All notes');
    expect(frame).toContain('Home › Notes');
    app.unmount();
  });

  it('the Story screen shows Plugin rows and tabs, and Story Actions in the footer, help and header', async () => {
    const t = await seed();
    const { app } = await open(t, 'story', { key: 'WEB-1' });
    // The footer shows the Action once the Story is in focus.
    let frame = await waitForFrame(app, 'Z Note');
    expect(frame).toMatch(/Note\s+note: hello/);
    expect(frame).toMatch(/Note\s+Z/);
    await app.press('?');
    expect(await waitForFrame(app, 'Keys')).toMatch(/Z\s+Note/);
    await app.press(KEYS.escape);
    await app.press(KEYS.tab, KEYS.tab);
    await waitForFrame(app, 'Tab note: hello');
    await app.press('Z');
    frame = await waitForFrame(app, 'Note of WEB-1: hello');
    expect(frame).toContain('Story › Note');
    app.unmount();
  });

  it('Story Actions show on the board for the selected Story', async () => {
    const t = await seed();
    const { app } = await open(t, 'board', {}, { version: 1, board: 'web' });
    const frame = await waitForFrame(app, 'Z Note');
    expect(frame).toContain('WEB-1');
    await app.press('Z');
    await waitForFrame(app, 'Note of WEB-1: hello');
    // And in a modal: the Story screen opened from the board.
    await app.press(KEYS.escape, KEYS.enter);
    const modal = await waitForFrame(app, (f) => f.includes('Board › WEB-1') && f.includes('d delete · Z Note'));
    expect(modal).toContain('Note Z');
    app.unmount();
  });

  it('the Story form has Plugin fields, whose values reach the operation as Plugin input', async () => {
    const t = await seed();
    const { app } = await open(t, 'story-form', { boardId: 'web' }, { version: 1, board: 'web' });
    await waitForFrame(app, 'Note');
    await app.press('N', 'e', 'w');
    await focusFormField(app, 'Note');
    await app.press('f', 'r', 'o', 'm', KEYS.ctrlS);
    await waitForFrame(app, 'Created WEB-3');
    expect((await readJsonFile(t, storyFile('WEB-3'))).plugins).toEqual({ notes: { note: 'from' } });
    app.unmount();
  });

  it('a Plugin warning shows as a toast and is collected, from a reaction run in the background', async () => {
    const t = await seed();
    const { app, ctx, warnings } = await open(t, 'story-form', { boardId: 'web' }, { version: 1, board: 'web' });
    expect(ctx.backgroundReactions).toBe(true);
    await waitForFrame(app, 'Note');
    await app.press('N', 'e', 'w', KEYS.ctrlS);
    await waitForFrame(app, 'notes saw WEB-3 created');
    expect(warnings).toEqual(['notes saw WEB-3 created']);
    app.unmount();
  });

  it('the Stories list filter has Plugin fields', async () => {
    const t = await seed();
    const { app } = await open(t, 'stories', { boardId: 'web' });
    await waitForFrame(app, 'WEB-2');
    await app.press('/');
    await focusFormField(app, 'With a note');
    await app.press(' ', KEYS.ctrlS);
    const frame = await waitForFrame(app, (f) => f.includes('filters: noted') && !f.includes('WEB-2'));
    expect(frame).toContain('WEB-1');
    app.unmount();
  });

  it('the Board detail shows Plugin sections', async () => {
    const t = await seed({ notes: { marker: '✎' } });
    const { app } = await open(t, 'board-detail', { boardId: 'web' });
    await waitForFrame(app, 'Notes marker on web: ✎');
    app.unmount();
  });

  it('the settings have a Plugins section, which turns Plugins on and off, and Plugin sections', async () => {
    const t = await seed();
    const { app, toasts } = await open(t, 'settings');
    let frame = await waitForFrame(app, 'Plugins');
    expect(frame).toMatch(/Plugins\s.*\n.*Notes/);
    await focusListItem(app, 'Plugins');
    await app.press(KEYS.tab);
    frame = await waitForFrame(app, '● Notes');
    expect(frame).toContain('○ Stamp');
    await app.press(KEYS.enter);
    await waitForFrame(app, '○ Notes');
    expect(toasts.list().map((toast) => toast.message)).toContain('Turned off Plugin Notes');
    expect((await readJsonFile(t, 'rowbly.config.json')).plugins).toEqual({ notes: { enabled: false } });
    // Loaded again: the Notes section is gone.
    frame = await waitForFrame(app, (f) => !/Plugins\s.*\n.*Notes/.test(f));
    // And on again: loaded once more, with its section back.
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('● Notes') && /Plugins\s.*\n.*Notes/.test(f));
    expect(toasts.list().map((toast) => toast.message)).toContain('Turned on Plugin Notes');
    expect((await readJsonFile(t, 'rowbly.config.json')).plugins).toEqual({ notes: { enabled: true } });
    app.unmount();
  });

  it('a Plugin whose TUI part throws fails to load', async () => {
    const broken = definePlugin({
      id: 'broken',
      name: 'Broken',
      description: '',
      tui: async () => {
        throw new Error('no TUI');
      },
    });
    const t = await pluginRoot({ notes: true, broken: true });
    const host = await loadPlugins({ root: t.root, registry: [notes, broken], reserved: reservedNames() });
    const loaded = await loadTuiPlugins(host);
    expect(loaded.map((p) => p.id)).toEqual(['notes']);
    expect(host.failures()).toMatchObject([{ id: 'broken', reason: 'its TUI part failed: no TUI' }]);
    expect(await createRepositories(t.root).rootConfig.get()).toMatchObject({ plugins: { broken: { enabled: true } } });
  });
});
