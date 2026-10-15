// The TUI slots that Plugins fill, with the Notes fixture Plugin on.

import { Text } from 'ink';
import { describe, expect, it } from 'vitest';
import { reservedNames } from '../../src/main';
import { definePlugin, type PluginTui } from '../../src/plugin-api';
import type { LocalState } from '../../src/schemas';
import { createServices, loadPlugins, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore, type ToastStore } from '../../src/tui/hooks';
import { loadTuiPlugins, type PluginLoader, withPlugins } from '../../src/tui/loadPlugins';
import type { RouteParams } from '../../src/tui/router';
import { fixedClock, fixedIds, makeBoard, makeRootConfig, makeStory, type TempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from '../tui/helpers';
import { fixturePlugins, notes, strict } from './fixtures';
import { type Entries, entries, pluginRoot, readJsonFile, storyFile } from './helpers';
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

describe('TUI activation (RES-20, RES-23)', () => {
  const broken = definePlugin({
    id: 'broken',
    name: 'Broken',
    description: '',
    tui: async () => {
      throw new Error('no TUI');
    },
  });
  const registry = [notes, strict, broken];
  const on = { notes: true, strict: true, broken: true } as const;

  function contextOf(t: TempRoot, warnings: string[] = []): RowblyContext {
    return {
      root: t.root,
      local: { version: 1, board: 'web' },
      me: null,
      now: fixedClock().now,
      newId: fixedIds(),
      warn: (message) => warnings.push(message),
    };
  }

  const loader: PluginLoader = (root) => loadPlugins({ root, registry, reserved: reservedNames() });

  /** A toast store that also keeps every warning pushed to it, which the shown list caps. */
  function countingToasts() {
    const shown = createToastStore();
    const warnings: string[] = [];
    const toasts: ToastStore = {
      ...shown,
      push(kind, message) {
        if (kind === 'warning') warnings.push(message);
        shown.push(kind, message);
      },
    };
    return { toasts, warnings };
  }

  it.each([
    { path: 'an injected host without a loader', loaded: true },
    { path: 'the loader', loaded: false },
  ])('$path: background reactions, failure toasts and healthy slots', async ({ loaded }) => {
    const t = await seed(on);
    const ctx = contextOf(t);
    if (loaded) ctx.plugins = await loader(t.root);
    const { toasts, warnings } = countingToasts();
    const plugins = await withPlugins(ctx, loaded ? undefined : loader, toasts);
    expect(ctx.backgroundReactions).toBe(true);
    expect(plugins.map((p) => p.id)).toEqual(['notes']);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('Plugin "strict" failed to load');
    expect(warnings[1]).toContain('Plugin "broken" failed to load (its TUI part failed: no TUI)');
  });

  it('an injected host without a loader runs reactions in the background and keeps Plugin slots', async () => {
    const t = await seed(on);
    const toasts = createToastStore();
    const ctx = { ...contextOf(t), warn: (message: string) => toasts.push('warning', message) };
    ctx.plugins = await loader(t.root);
    const plugins = await withPlugins(ctx, undefined, toasts);
    const app = renderTui(
      <App
        ctx={ctx}
        services={createServices(ctx)}
        initial={{ screen: 'story-form', params: { boardId: 'web' } }}
        toasts={toasts}
        plugins={plugins}
      />,
    );
    await waitForFrame(app, 'Note');
    await app.press('N', 'e', 'w', KEYS.ctrlS);
    await waitForFrame(app, 'notes saw WEB-3 created');
    app.unmount();
  });

  it('loading again warns once per failure, per Data Root, while the status still shows it', async () => {
    const t = await seed(on);
    const other = await seed(on);
    const { toasts, warnings } = countingToasts();
    const ctx = contextOf(t);
    await withPlugins(ctx, loader, toasts);
    await withPlugins({ ...ctx }, loader, toasts);
    await withPlugins({ ...ctx }, loader, toasts);
    expect(warnings).toHaveLength(2);
    expect(ctx.plugins?.failures().map((f) => f.id)).toEqual(['strict', 'broken']);
    // Another Data Root's failures warn too.
    await withPlugins(contextOf(other), loader, toasts);
    expect(warnings.filter((w) => w.includes('"strict"'))).toHaveLength(2);
  });

  it('a failure that went away warns again when it comes back', async () => {
    const t = await seed({ notes: true, strict: true });
    const { toasts: counting, warnings: pushed } = countingToasts();
    await withPlugins(contextOf(t), loader, counting);
    await makeRootConfig(t.path, configWith({ notes: true, strict: { level: 1 } }));
    await withPlugins(contextOf(t), loader, counting);
    await makeRootConfig(t.path, configWith({ notes: true, strict: true }));
    await withPlugins(contextOf(t), loader, counting);
    await withPlugins(contextOf(t), loader, counting);
    expect(pushed.filter((w) => w.includes('"strict"'))).toHaveLength(2);
  });
});

/** The root config `pluginRoot` writes, with `plugins` as given. */
function configWith(on: Entries) {
  return { assignees: [{ handle: 'alice', name: 'Alice' }], plugins: entries(on) };
}

describe('Plugin UI identity (ARCH-40)', () => {
  /** A Plugin with the TUI part `tui`, a screen `mine` and nothing else. */
  function withTui(id: string, tui: PluginTui<unknown>) {
    return definePlugin({
      id,
      name: id,
      description: '',
      tui: async () => ({ screens: { mine: () => <Text>{`${id} screen`}</Text> }, ...tui }),
    });
  }

  it('two Home entries with the same label open their own destinations', async () => {
    const twin = withTui('twin', { home: [{ label: 'Stories', screen: 'mine' }] });
    const t = await seed({ notes: true, twin: true });
    const { app } = await openPluginApp(t, [notes, twin], { screen: 'home', params: {} });
    await waitForFrame(app, 'Notes');
    await focusListItem(app, 'Notes');
    await app.press('j', KEYS.enter);
    await waitForFrame(app, 'twin screen');
    app.unmount();
  });

  it.each([
    {
      what: 'a Home entry to a missing screen',
      tui: { home: [{ label: 'Go', screen: 'nope' }] },
      reason: 'its Home entry "Go" opens screen "nope", which it does not have',
    },
    {
      what: 'a settings section to a missing screen',
      tui: { settings: [{ label: 'Set', screen: 'nope' }] },
      reason: 'its settings section "Set" opens screen "nope", which it does not have',
    },
    {
      what: 'two settings sections with one label',
      tui: {
        settings: [
          { label: 'Set', screen: 'mine' },
          { label: 'Set', screen: 'mine' },
        ],
      },
      reason: 'it has two settings sections labelled "Set"',
    },
    {
      what: 'two Story tabs with one label',
      tui: {
        storyTabs: [
          { label: 'Tab', component: () => null },
          { label: 'Tab', component: () => null },
        ],
      },
      reason: 'it has two Story tabs labelled "Tab"',
    },
    {
      what: 'two Task tabs with one label',
      tui: {
        taskTabs: [
          { label: 'Tab', component: () => null },
          { label: 'Tab', component: () => null },
        ],
      },
      reason: 'it has two Task tabs labelled "Tab"',
    },
  ])('$what fails that Plugin to load, and only it', async ({ tui, reason }) => {
    const odd = withTui('odd', tui as PluginTui<unknown>);
    const t = await seed({ notes: true, odd: true });
    const { app, host, warnings } = await openPluginApp(t, [notes, odd], { screen: 'home', params: {} });
    expect(host.failures()).toMatchObject([{ id: 'odd', reason: `its TUI part is invalid: ${reason}` }]);
    expect(warnings).toHaveLength(1);
    await waitForFrame(app, 'Notes');
    app.unmount();
  });

  it('a Plugin that names two of its fields alike fails in the field stage, the form still works', async () => {
    const twice = definePlugin({
      id: 'twice',
      name: 'Twice',
      description: '',
      tui: async (): Promise<PluginTui<unknown>> => ({
        storyForm: {
          fields: async () => [
            { name: 'x', label: 'One', kind: 'text' },
            { name: 'x', label: 'Two', kind: 'text' },
          ],
          input: () => undefined,
        },
      }),
    });
    const t = await seed({ notes: true, twice: true });
    const { app } = await openPluginApp(t, [notes, twice], { screen: 'story-form', params: { key: 'WEB-1' } });
    const frame = await waitForFrame(app, 'Plugin "twice" failed in the field stage: it names two fields "x"');
    expect(frame).toContain('Note');
    app.unmount();
  });
});
