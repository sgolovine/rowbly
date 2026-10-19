// One Plugin's failing form or filter callbacks leave the core form, the filters and the other
// Plugins usable, never change its stored data, and are named by Plugin and stage (DX-31, RES-12).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Text } from 'ink';
import { type ReactNode, useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/core';
import { reservedNames } from '../../src/main';
import { type AnyPluginDefinition, definePlugin, type PluginTui } from '../../src/plugin-api';
import { epics } from '../../src/plugins/epics';
import { specs } from '../../src/plugins/specs';
import { createServices, loadPlugins, type RowblyContext } from '../../src/services';
import { acquireLock, type LockHandle } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { loadTuiPlugins } from '../../src/tui/loadPlugins';
import { fixedClock, fixedIds, makeStory, type TempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from '../tui/helpers';
import { notes } from './fixtures';
import { pluginRoot, readJsonFile, storyFile } from './helpers';
import { focusListItem } from './tuiHelpers';

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
  beforeRender?: () => Promise<void>,
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
  const tuiPlugins = await loadTuiPlugins(host);
  await beforeRender?.();
  const app = renderTui(
    <App ctx={ctx} services={createServices(ctx)} initial={{ screen, params }} toasts={toasts} plugins={tuiPlugins} />,
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
    await waitForFrame(app, 'Plugin "flaky" failed in the field of stories.update: cannot convert');
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
    const frame = await waitForFrame(app, (f) => /filters?: noted/.test(f) && !f.includes('WEB-2'));
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
    // Since WP08A the Epic field itself loads: the Story's own Epic stays selected and kept.
    expect(frame).toContain('‹ bad ›');
    expect(frame).not.toContain('failed in the field stage');
    expect(frame).toContain('Specs');
    await form.app.press(KEYS.end, ' again', KEYS.ctrlS);
    await waitForFrame(form.app, 'Updated WEB-1');
    const saved = await readJsonFile(t, storyFile('WEB-1'));
    expect(saved).toMatchObject({ name: 'Login again', plugins: { epics: { epic: 'bad' } } });
    form.app.unmount();

    const board = await open(t, registry, 'board', { boardId: 'web' });
    await waitForFrame(board.app, 'WEB-1');
    await board.app.press('/');
    const filter = await waitForFrame(board.app, /Epic\s+‹/);
    expect(filter).toContain('Spec');
    expect(filter).not.toContain('failed in the field stage');
    board.app.unmount();
  });
});

type Crash = 'render' | 'effect' | 'expected';

/** What `crashy`'s components show, or how they fail. */
let crash: Crash | 'none' = 'none';

/** Fails as `crash` says: while rendering, in a synchronous effect, or with an expected Rowbly error. */
function Boom(): ReactNode {
  useEffect(() => {
    if (crash === 'effect') throw new Error('effect bug');
  }, []);
  if (crash === 'render') throw new TypeError('render bug');
  if (crash === 'expected') throw new ValidationError('crashy data is bad', { hint: 'fix the crashy file' });
  return <Text>crashy works</Text>;
}

/** A Plugin whose screen, tabs, Board section and settings section are all `Boom`. */
const crashy = definePlugin({
  id: 'crashy',
  name: 'Crashy',
  description: 'Fails while it renders',
  actions: [{ key: 'X', label: 'Boom', target: 'none', run: ({ ui }) => ui.open('boom') }],
  tui: async (): Promise<PluginTui<unknown>> => ({
    screens: { boom: Boom },
    home: [{ label: 'Crashy', screen: 'boom' }],
    settings: [{ label: 'Crashy', screen: 'boom' }],
    storyTabs: [{ label: 'Crash', component: Boom }],
    boardSections: [Boom],
  }),
});

async function seedCrashy() {
  const t = await pluginRoot({ notes: true, crashy: true });
  await makeStory(t.path, {
    boardId: 'web',
    key: 'WEB-1',
    name: 'Login',
    plugins: { notes: { note: 'hello' } },
  });
  return t;
}

const CRASHY = [notes, crashy];

/** The fallback each failure shows: an ordinary error names the Plugin, an expected one keeps its hint. */
const FALLBACK: Record<Crash, string[]> = {
  render: ['Plugin "crashy" failed in its screen: render bug', 'rowbly plugins disable crashy'],
  effect: ['Plugin "crashy" failed in its screen: effect bug', 'rowbly plugins disable crashy'],
  expected: ['crashy data is bad', 'fix the crashy file'],
};

describe('Plugin render containment (RES-13)', () => {
  afterEach(() => {
    crash = 'none';
  });

  it.each(['render', 'effect', 'expected'] as const)(
    'a Plugin screen that fails (%s) shows a fallback; esc goes back',
    async (how) => {
      crash = how;
      const t = await seedCrashy();
      const { app } = await open(t, CRASHY, 'board');
      await waitForFrame(app, 'X Boom');
      await app.press('X');
      const frame = await waitForFrame(app, FALLBACK[how][0] as string);
      for (const text of FALLBACK[how]) expect(frame).toContain(text);
      expect(frame).toContain('Board › Boom');
      await app.press(KEYS.escape);
      // Back on the Board, whose footer shows its keys again.
      await waitForFrame(app, (f) => !f.includes('Board › Boom') && f.includes('· Z Note'));
      // Another Plugin's screen still opens.
      await app.press('Z');
      await waitForFrame(app, 'Note of WEB-1: hello', 10_000);
      app.unmount();
    },
  );

  it.each(['render', 'effect', 'expected'] as const)(
    'a Story tab that fails (%s) leaves the other tabs working',
    async (how) => {
      crash = how;
      const t = await seedCrashy();
      const { app } = await open(t, CRASHY, 'story', { key: 'WEB-1' });
      await waitForFrame(app, 'Crash');
      await app.press(KEYS.tab);
      await waitForFrame(app, 'Tab note: hello');
      await app.press(KEYS.tab);
      const frame = await waitForFrame(app, FALLBACK[how][0] as string);
      for (const text of FALLBACK[how]) expect(frame).toContain(text);
      // Back to Details, whose keys still work.
      await app.press(KEYS.tab);
      await waitForFrame(app, 'Updated');
      await app.press('e');
      await waitForFrame(app, 'Edit WEB-1');
      app.unmount();
    },
  );

  it.each(['render', 'effect', 'expected'] as const)(
    'a Board section that fails (%s) leaves the Board and other sections',
    async (how) => {
      crash = how;
      const t = await seedCrashy();
      const { app } = await open(t, CRASHY, 'board-detail', { boardId: 'web' });
      const frame = await waitForFrame(app, FALLBACK[how][0] as string);
      for (const text of FALLBACK[how]) expect(frame).toContain(text);
      expect(frame).toContain('Notes marker on web');
      expect(frame).toContain('Website');
      app.unmount();
    },
  );

  it.each(['render', 'effect'] as const)(
    'a settings section that fails (%s) leaves the other sections',
    async (how) => {
      crash = how;
      const t = await seedCrashy();
      const { app } = await open(t, CRASHY, 'settings');
      await waitForFrame(app, 'Crashy');
      await focusListItem(app, 'Crashy');
      await waitForFrame(app, FALLBACK[how][0] as string);
      await focusListItem(app, 'Notes');
      await waitForFrame(app, 'All notes');
      app.unmount();
    },
  );

  it('shows the fallback once, without repeating a warning, as the screen renders again', async () => {
    crash = 'render';
    const t = await seedCrashy();
    const { app, toasts } = await open(t, CRASHY, 'board-detail', { boardId: 'web' });
    await waitForFrame(app, FALLBACK.render[0] as string);
    // The Board in context changes, which renders the screen again.
    await app.press('?');
    await waitForFrame(app, 'Keys');
    await app.press(KEYS.escape);
    await waitForFrame(app, (f) => !f.includes('Keys'));
    expect(app.lastFrame()).toContain(FALLBACK.render[0]);
    expect(toasts.list()).toEqual([]);
    app.unmount();
  });
});

describe('Plugin Action failures (DX-39)', () => {
  const grumpy = definePlugin({
    id: 'grumpy',
    name: 'Grumpy',
    description: 'Its Actions fail',
    actions: [
      {
        key: 'X',
        label: 'Throw',
        target: 'none',
        run: () => {
          throw new TypeError('action bug');
        },
      },
      {
        key: 'Y',
        label: 'Reject',
        target: 'none',
        run: async () => {
          throw new ValidationError('not now', { hint: 'try later' });
        },
      },
    ],
  });

  it('a throwing or rejecting Action shows one attributed toast and leaves the TUI usable', async () => {
    const t = await seed({ notes: true, grumpy: true });
    const { app, toasts } = await open(t, [notes, grumpy], 'board');
    await waitForFrame(app, 'X Throw');
    await app.press('X');
    await waitForFrame(app, 'action bug');
    await app.press('Y');
    await waitForFrame(app, 'not now');
    expect(toasts.list().map((toast) => toast.message)).toEqual([
      'Plugin "grumpy" failed in its screen: action bug (turn it off with `rowbly plugins disable grumpy`)',
      'not now (try later)',
    ]);
    // Z targets a Story: it is offered only once the Board has loaded and focused WEB-1.
    await waitForFrame(app, '· Z Note');
    await app.press('Z');
    await waitForFrame(app, 'Note of WEB-1: hello');
    app.unmount();
  });

  it('a Story Action is offered only once the Board has loaded, also while another holder has the lock', async () => {
    const t = await seed({ notes: true, grumpy: true });
    // Another holder keeps the Data Root busy, so the Board's reads wait in the lock queue.
    let lock: LockHandle | undefined;
    const { app } = await open(t, [notes, grumpy], 'board', {}, async () => {
      lock = await acquireLock(t.path, { operation: 'test.hold' });
    });
    await waitForFrame(app, 'X Throw');
    await app.press('Z');
    const waiting = app.lastFrame() ?? '';
    expect(waiting).not.toContain('Z Note');
    expect(waiting).not.toContain('Note of WEB-1');
    await lock?.release();
    // Once the lock is free the queued reads run at once, and Z works.
    await waitForFrame(app, '· Z Note');
    await app.press('Z');
    await waitForFrame(app, 'Note of WEB-1: hello');
    app.unmount();
  });
});
