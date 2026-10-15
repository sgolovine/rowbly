// The dirty contract of Plugin form fields (ADR-0020 §3): an unrelated Story form edit never changes
// Plugin data, invalid bags are kept until an explicit reset, and clearing is a deliberate change.
// Includes the `r13-invalid-bag-dropped` reproduction.
import { describe, expect, it } from 'vitest';
import { reservedNames } from '../../src/main';
import { epics } from '../../src/plugins/epics';
import { createEpic } from '../../src/plugins/epics/service';
import { specs } from '../../src/plugins/specs';
import type { PluginFormField } from '../../src/plugin-api';
import { createServices, loadPlugins, type RowblyContext } from '../../src/services';
import { App } from '../../src/tui/app';
import { createToastStore, type TuiPlugin } from '../../src/tui/hooks';
import { loadTuiPlugins } from '../../src/tui/loadPlugins';
import { storyFormInput } from '../../src/tui/screens/stories/pluginFields';
import { fixedClock, fixedIds, makeStory, type TempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from '../tui/helpers';
import { notes } from './fixtures';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

const registry = [epics, specs, notes];

/** Epics, Specs and Notes on, an Epic `auth`,. */
async function seed() {
  const t = await pluginRoot({ epics: true, specs: true, notes: true });
  const { services } = await withPlugins(t, registry);
  await createEpic(services.plugins.context('epics'), { id: 'auth', name: 'Authentication' });
  return t;
}

async function open(t: TempRoot, screen: string, params: Record<string, unknown> = {}) {
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
  const services = createServices(ctx);
  const app = renderTui(
    <App
      ctx={ctx}
      services={services}
      initial={{ screen, params }}
      toasts={toasts}
      plugins={await loadTuiPlugins(host)}
    />,
  );
  return { app, services, toasts };
}

/** Tabs from the Name field to the first Plugin field: Description, Stage, Assignees, Priority, Labels, Due. */
const TO_PLUGIN_FIELDS = Array(7).fill(KEYS.tab);

const INVALID = {
  epics: { epic: 'Not A Slug', extra: 'v2 field' },
  specs: { specs: 'not-an-array' },
  future: { anything: [1, 2, 3] },
};

describe('Plugin form data preservation', () => {
  it('editing only the name keeps invalid and unknown bags, and doctor still reports them (r13)', async () => {
    const t = await seed();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login', plugins: INVALID });
    const { app, services } = await open(t, 'story-form', { key: 'WEB-1' });
    const frame = await waitForFrame(app, 'Edit WEB-1');
    expect(frame).toContain('stored value is invalid; kept unchanged');
    await app.press(KEYS.end, ' again', KEYS.ctrlS);
    await waitForFrame(app, 'Updated WEB-1');
    const saved = await readJsonFile(t, storyFile('WEB-1'));
    expect(saved.name).toBe('Login again');
    expect(saved.plugins).toEqual(INVALID);
    const codes = (await services.doctor.check()).findings.map((f) => `${f.code} ${f.message}`).join('\n');
    expect(codes).toMatch(/epics/);
    expect(codes).toMatch(/specs/);
    app.unmount();
  });

  it('resetting an invalid field is an explicit clear that keeps the other bags', async () => {
    const t = await seed();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login', plugins: INVALID });
    const { app } = await open(t, 'story-form', { key: 'WEB-1' });
    await waitForFrame(app, 'Edit WEB-1');
    await app.press(...TO_PLUGIN_FIELDS, KEYS.right);
    await waitForFrame(app, '‹ reset ›');
    await app.press(KEYS.ctrlS);
    await waitForFrame(app, 'Updated WEB-1');
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({
      specs: INVALID.specs,
      future: INVALID.future,
    });
    app.unmount();
  });

  it('editing only the name leaves valid bags, with unknown keys, untouched', async () => {
    const t = await seed();
    const bags = {
      epics: { epic: 'auth' },
      specs: { specs: ['login'] },
      notes: { note: 'hello', later: true },
      future: { x: 1 },
    };
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login', plugins: bags });
    const { app } = await open(t, 'story-form', { key: 'WEB-1' });
    await waitForFrame(app, '‹ auth ›');
    await app.press(KEYS.end, '!', KEYS.ctrlS);
    await waitForFrame(app, 'Updated WEB-1');
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual(bags);
    app.unmount();
  });

  it('changing one Plugin field to empty clears only that bag', async () => {
    const t = await seed();
    const bags = { epics: { epic: 'auth' }, notes: { note: 'hello' }, future: { x: 1 } };
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login', plugins: bags });
    const { app } = await open(t, 'story-form', { key: 'WEB-1' });
    await waitForFrame(app, '‹ auth ›');
    await app.press(...TO_PLUGIN_FIELDS, KEYS.left);
    await waitForFrame(app, '‹ No Epic ›');
    await app.press(KEYS.ctrlS);
    await waitForFrame(app, 'Updated WEB-1');
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({ notes: { note: 'hello' }, future: { x: 1 } });
    app.unmount();
  });

  it('creating a Story with empty Plugin fields writes no bag', async () => {
    const t = await seed();
    const { app } = await open(t, 'story-form', { boardId: 'web' });
    await waitForFrame(app, 'No Epic');
    await app.press('Plain', KEYS.ctrlS);
    await waitForFrame(app, 'Created WEB-1');
    expect(await readJsonFile(t, storyFile('WEB-1'))).not.toHaveProperty('plugins');
    app.unmount();
  });
});

describe('storyFormInput', () => {
  const calls: unknown[] = [];
  const probe: TuiPlugin = {
    id: 'probe',
    actions: [],
    tui: {
      storyForm: {
        fields: async () => [],
        input(args) {
          calls.push(args);
          return { x: null };
        },
      },
    },
  };
  const fields: PluginFormField[] = [
    { name: 'count', label: 'Count', kind: 'number', value: 0 },
    { name: 'raw', label: 'Raw', kind: 'number', value: '5' },
    { name: 'flag', label: 'Flag', kind: 'boolean' },
    { name: 'tags', label: 'Tags', kind: 'multiselect', options: ['a', 'b'], value: [] },
    { name: 'picks', label: 'Picks', kind: 'multiselect', options: ['a', 'b'], value: ['a', 'b'] },
    { name: 'text', label: 'Text', kind: 'text' },
  ];
  const set = { loaded: new Map([['probe', fields]]) };
  const submitted = {
    'plugin:probe:count': 0,
    'plugin:probe:raw': 5,
    'plugin:probe:flag': false,
    'plugin:probe:tags': [],
    'plugin:probe:picks': ['b', 'a'],
    'plugin:probe:text': '',
  };

  it('does not call a Plugin whose normalized values are unchanged (0, false, [], "5" → 5)', () => {
    calls.length = 0;
    expect(storyFormInput([probe], set, submitted, null)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('passes the values, initial values and changed fields of a changed Plugin', () => {
    calls.length = 0;
    const input = storyFormInput([probe], set, { ...submitted, 'plugin:probe:count': null }, null);
    expect(input).toEqual({ probe: { x: null } });
    expect(calls).toEqual([
      expect.objectContaining({
        changedFields: ['count'],
        values: expect.objectContaining({ count: null, raw: 5 }),
        initialValues: expect.objectContaining({ count: 0, raw: 5, flag: false, tags: [] }),
        story: null,
      }),
    ]);
  });

  it('never calls a Plugin whose fields did not load', () => {
    calls.length = 0;
    const input = storyFormInput([probe], { loaded: new Map() }, { 'plugin:probe:count': 3 }, null);
    expect(input).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
