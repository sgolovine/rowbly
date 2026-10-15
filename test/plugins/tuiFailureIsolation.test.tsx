// One Plugin's failing form or filter callbacks leave the core form, the filters and the other
// Plugins usable, never change its stored data, and are named by Plugin and stage (DX-31, RES-12).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reservedNames } from '../../src/main';
import { type AnyPluginDefinition, definePlugin, type PluginTui } from '../../src/plugin-api';
import { epics } from '../../src/plugins/epics';
import { specs } from '../../src/plugins/specs';
import { createServices, loadPlugins, type RowblyContext } from '../../src/services';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { loadTuiPlugins } from '../../src/tui/loadPlugins';
import { fixedClock, fixedIds, makeStory, type TempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from '../tui/helpers';
import { notes } from './fixtures';
import { pluginRoot, readJsonFile, storyFile } from './helpers';

/** Every `input` call of the `flaky` Plugin, which must never happen while its fields fail. */
const inputs: unknown[] = [];

/** A Plugin whose callbacks fail in the ways `how` names; its input would clear its bag on absent values. */
function flaky(how: { fields?: boolean; input?: boolean; filter?: boolean; describe?: boolean }): AnyPluginDefinition {
  const tui: PluginTui<unknown> = {
    storyForm: {
      async fields() {
        if (how.fields) throw new Error('cannot read the flaky data');
        return [{ name: 'x', label: 'Flaky', kind: 'text', value: '' }];
      },
      input({ values }) {
        inputs.push(values);
        if (how.input) throw new Error('cannot convert');
        return { x: values.x || null };
      },
    },
    storyFilter: {
      async fields() {
        if (how.fields) throw new Error('cannot read the flaky data');
        return [{ name: 'only', label: 'Flaky only', kind: 'boolean' }];
      },
      filter(values) {
        if (how.filter) throw new Error('cannot filter');
        return values.only === true ? true : undefined;
      },
      describe(values) {
        if (how.describe) throw new Error('cannot describe');
        return values.only === true ? 'flaky only' : '';
      },
    },
  };
  return definePlugin({
    id: 'flaky',
    name: 'Flaky',
    description: 'Fails in its TUI callbacks',
    filterStories: (story, filter) => (story.plugins?.flaky !== undefined) === filter,
    tui: async () => tui,
  });
}

async function seed(on: Record<string, true>) {
  const t = await pluginRoot(on);
  await makeStory(t.path, {
    boardId: 'web',
    key: 'WEB-1',
    name: 'Login',
    plugins: { notes: { note: 'hello' }, flaky: { x: 1 } },
  });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-2', name: 'Signup', rank: 'a1' });
  return t;
}

async function open(
  t: TempRoot,
  registry: readonly AnyPluginDefinition[],
  screen: string,
  params: Record<string, unknown> = {},
) {
  const toasts = createToastStore();
  const host = await loadPlugins({ root: t.root, registry, reserved: reservedNames() });
  const ctx: RowblyContext = {
    root: t.root,
    local: { version: 1, board: 'web' },
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    plugins: host,
    warn: (message) => toasts.push('warning', message),
  };
  const app = renderTui(
    <App
      ctx={ctx}
      services={createServices(ctx)}
      initial={{ screen, params }}
      toasts={toasts}
      plugins={await loadTuiPlugins(host)}
    />,
  );
  return { app, toasts };
}

describe('Plugin field isolation', () => {
  it('a throwing field provider leaves the form usable and its data kept', async () => {
    inputs.length = 0;
    const t = await seed({ notes: true, flaky: true });
    const { app, toasts } = await open(t, [notes, flaky({ fields: true })], 'story-form', { key: 'WEB-1' });
    const frame = await waitForFrame(app, 'Edit WEB-1');
    expect(frame).toContain('Plugin "flaky" failed in the field stage: cannot read the flaky data');
    expect(frame).toContain('stored data kept');
    expect(frame).toContain('Note');
    // Change the name and the healthy Plugin's note.
    await app.press(KEYS.end, ' again', ...Array(7).fill(KEYS.tab), KEYS.end, '!', KEYS.ctrlS);
    await waitForFrame(app, 'Updated WEB-1');
    const saved = await readJsonFile(t, storyFile('WEB-1'));
    expect(saved.name).toBe('Login again');
    expect(saved.plugins).toEqual({ notes: { note: 'hello!' }, flaky: { x: 1 } });
    expect(inputs).toEqual([]);
    expect(toasts.list().filter((toast) => toast.kind !== 'info')).toEqual([]);
    app.unmount();
  });

  it('an unchanged provider contributes nothing, even one that clears on absent values', async () => {
    inputs.length = 0;
    const t = await seed({ notes: true, flaky: true });
    const { app } = await open(t, [notes, flaky({})], 'story-form', { key: 'WEB-1' });
    await waitForFrame(app, 'Flaky');
    await app.press(KEYS.end, ' again', KEYS.ctrlS);
    await waitForFrame(app, 'Updated WEB-1');
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({ notes: { note: 'hello' }, flaky: { x: 1 } });
    expect(inputs).toEqual([]);
    app.unmount();
  });

  it('a failing input conversion blocks the save, once, named by Plugin and stage', async () => {
    inputs.length = 0;
    const t = await seed({ notes: true, flaky: true });
    const { app, toasts } = await open(t, [notes, flaky({ input: true })], 'story-form', { key: 'WEB-1' });
    await waitForFrame(app, 'Flaky');
    await app.press(KEYS.end, ' again', ...Array(8).fill(KEYS.tab), 'y', KEYS.ctrlS);
    await waitForFrame(app, 'Plugin "flaky" failed in the input stage: cannot convert');
    const saved = await readJsonFile(t, storyFile('WEB-1'));
    expect(saved.name).toBe('Login');
    expect(toasts.list().filter((toast) => toast.kind === 'error')).toHaveLength(1);
    app.unmount();
  });

  it.each([
    { screen: 'stories', tabs: 9 },
    { screen: 'board', tabs: 5 },
  ])('filters on $screen work without a Plugin whose filter fields fail', async ({ screen, tabs }) => {
    const t = await seed({ notes: true, flaky: true });
    const { app, toasts } = await open(t, [notes, flaky({ fields: true })], screen, { boardId: 'web' });
    await waitForFrame(app, 'WEB-2');
    await app.press('/');
    await waitForFrame(app, 'Plugin "flaky" failed in the field stage');
    await app.press(...Array(tabs).fill(KEYS.tab), ' ', KEYS.ctrlS);
    const frame = await waitForFrame(app, (f) => f.includes('filters: noted') && !f.includes('WEB-2'));
    expect(frame).toContain('WEB-1');
    expect(toasts.list()).toEqual([]);
    app.unmount();
  });

  it.each([
    { how: { filter: true }, stage: 'filter', message: 'cannot filter' },
    { how: { describe: true }, stage: 'filter-summary', message: 'cannot describe' },
  ])('a throwing $stage callback is named and leaves the other criteria working', async ({ how, stage, message }) => {
    const t = await seed({ notes: true, flaky: true });
    const { app, toasts } = await open(t, [notes, flaky(how)], 'stories', { boardId: 'web' });
    await waitForFrame(app, 'WEB-2');
    // Notes' "With a note", then Flaky's "Flaky only".
    await app.press('/', ...Array(9).fill(KEYS.tab), ' ', KEYS.tab, ' ', KEYS.ctrlS);
    const frame = await waitForFrame(app, `Plugin "flaky" failed in the ${stage} stage: ${message}`);
    expect(frame).toContain('noted');
    await waitForFrame(app, (f) => f.includes('WEB-1') && !f.includes('WEB-2'));
    expect(toasts.list()).toEqual([]);
    app.unmount();
  });

  it('a corrupt Epic file keeps the Story form, Specs fields and filters usable (r07)', async () => {
    const t = await pluginRoot({ epics: true, specs: true });
    await mkdir(join(t.path, 'plugins/epics'), { recursive: true });
    await writeFile(join(t.path, 'plugins/epics/bad.json'), '<<<<<<< HEAD\n{"version":1}\n=======\n>>>>>>> other\n');
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login', plugins: { epics: { epic: 'bad' } } });
    const registry = [epics, specs];
    const form = await open(t, registry, 'story-form', { key: 'WEB-1' });
    const frame = await waitForFrame(form.app, 'Edit WEB-1');
    expect(frame).toContain('Plugin "epics" failed in the field stage');
    expect(frame).toContain('Specs');
    await form.app.press(KEYS.end, ' again', KEYS.ctrlS);
    await waitForFrame(form.app, 'Updated WEB-1');
    const saved = await readJsonFile(t, storyFile('WEB-1'));
    expect(saved).toMatchObject({ name: 'Login again', plugins: { epics: { epic: 'bad' } } });
    form.app.unmount();

    const board = await open(t, registry, 'board', { boardId: 'web' });
    await waitForFrame(board.app, 'WEB-1');
    await board.app.press('/');
    const filter = await waitForFrame(board.app, 'Plugin "epics" failed in the field stage');
    expect(filter).toContain('Spec');
    board.app.unmount();
  });
});
