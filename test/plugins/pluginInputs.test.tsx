// DX-07, DX-11, DX-12, CQ-03, DX-35: typed Plugin input and filters, checked before anything runs,
// with one absent / clear / value convention on the CLI, the TUI and service calls.
import { stripVTControlCharacters } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginError, ValidationError } from '../../src/core';
import { main } from '../../src/main';
import { type AnyPluginDefinition, definePlugin, z } from '../../src/plugin-api';
import { makeStory } from '../helpers';
import { KEYS, waitForFrame } from '../tui/helpers';
import { points } from './fixtures/points';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';
import { focusFormField, openPluginApp } from './tuiHelpers';

let stderr: string[];
beforeEach(() => {
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function run(root: string, registry: readonly AnyPluginDefinition[], ...args: string[]): Promise<number> {
  return main(['--root', root, '--json', ...args], registry);
}

/** The `--json` error the last command printed. */
function jsonError(): { code: string; message: string; details: Record<string, unknown> } {
  return JSON.parse(stderr.join('').trim().split('\n').at(-1) ?? '').error;
}

describe('typed Plugin input (DX-07)', () => {
  it('a service call with invalid input is VALIDATION, names the Plugin, keeps the issues and saves nothing', async () => {
    const t = await pluginRoot({ points: true });
    const { services } = await withPlugins(t, [points]);
    const err = await services.stories
      .create('web', { name: 'A', plugins: { points: { points: -1 } } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({
      code: 'VALIDATION',
      message: expect.stringContaining('Plugin "points" input of stories.create is not valid: points: '),
      details: {
        plugin: 'points',
        operation: 'stories.create',
        issues: [expect.objectContaining({ path: ['points'] })],
      },
    });
    expect(await services.stories.list('web', {})).toEqual([]);
  });

  it('no input changes nothing, null clears, a value sets, and zero is kept', async () => {
    const t = await pluginRoot({ points: true });
    const { services } = await withPlugins(t, [points]);
    const story = await services.stories.create('web', { name: 'A', plugins: { points: { points: 0 } } });
    expect(story.plugins).toEqual({ points: { points: 0 } });
    expect((await services.stories.update('WEB-1', { name: 'B' })).plugins).toEqual({ points: { points: 0 } });
    expect((await services.stories.update('WEB-1', { plugins: { points: { points: 5 } } })).plugins).toEqual({
      points: { points: 5 },
    });
    expect(await services.stories.update('WEB-1', { plugins: { points: { points: null } } })).not.toHaveProperty(
      'plugins',
    );
  });

  it('hooks get the parsed input, defaults included; a thrown transform bug stays INTERNAL', async () => {
    const seen: unknown[] = [];
    const defaults = definePlugin({
      id: 'defaults',
      name: 'Defaults',
      description: '',
      inputs: { 'stories.create': z.object({ size: z.number().default(3) }) },
      hooks: {
        'stories.create': {
          transform({ pluginInput }) {
            seen.push(pluginInput);
            if (pluginInput?.size === 13) throw new TypeError('transform bug');
          },
        },
      },
    });
    const t = await pluginRoot({ defaults: true });
    const { services } = await withPlugins(t, [defaults]);
    await services.stories.create('web', { name: 'A', plugins: { defaults: {} } });
    await services.stories.create('web', { name: 'B' });
    expect(seen).toEqual([{ size: 3 }, undefined]);
    const err = await services.stories
      .create('web', { name: 'C', plugins: { defaults: { size: 13 } } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginError);
    expect(err).toMatchObject({ code: 'INTERNAL', details: { plugin: 'defaults', stage: 'transform' } });
    expect(await services.stories.list('web', {})).toHaveLength(2);
  });

  it('a filter is parsed once per list, before any Story is checked, and an invalid one is VALIDATION', async () => {
    let parses = 0;
    let checks = 0;
    const counted = definePlugin({
      id: 'counted',
      name: 'Counted',
      description: '',
      storyFilterSchema: z.number().transform((value) => {
        parses += 1;
        return value;
      }),
      filterStories(_story, filter) {
        checks += 1;
        return filter === 1;
      },
    });
    const t = await pluginRoot({ counted: true });
    for (const key of ['WEB-1', 'WEB-2', 'WEB-3']) await makeStory(t.path, { boardId: 'web', key });
    const { services } = await withPlugins(t, [counted]);
    expect(await services.stories.list('web', { plugins: { counted: 1 } })).toHaveLength(3);
    expect({ parses, checks }).toEqual({ parses: 1, checks: 3 });
    await expect(services.stories.list('web', { plugins: { counted: 'one' } })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { plugin: 'counted', issues: expect.any(Array) },
    });
    expect(checks).toBe(3);
  });
});

describe('the CLI (DX-07, DX-11, DX-12)', () => {
  it('invalid input exits 2 with the Plugin and issues; nothing is saved', async () => {
    const t = await pluginRoot({ points: true });
    expect(await run(t.path, [points], 'stories', 'create', '--name', 'A', '--points', 'many')).toBe(2);
    expect(jsonError()).toMatchObject({
      code: 'VALIDATION',
      details: {
        plugin: 'points',
        operation: 'stories.create',
        issues: [expect.objectContaining({ path: ['points'] })],
      },
    });
    await expect(readJsonFile(t, storyFile('WEB-1'))).rejects.toThrow();
  });

  it('no flag changes nothing, --no-x clears, a value sets, 0 is kept; the list filter uses the same schema', async () => {
    const t = await pluginRoot({ points: true });
    expect(await run(t.path, [points], 'stories', 'create', '--name', 'A', '--points', '0')).toBe(0);
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({ points: { points: 0 } });
    expect(await run(t.path, [points], 'stories', 'edit', 'WEB-1', '--name', 'B')).toBe(0);
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({ points: { points: 0 } });
    expect(await run(t.path, [points], 'stories', 'edit', 'WEB-1', '--points', '3')).toBe(0);
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({ points: { points: 3 } });
    expect(await run(t.path, [points], 'stories', 'list', '--points', 'x')).toBe(2);
    expect(jsonError()).toMatchObject({ code: 'VALIDATION', details: { plugin: 'points' } });
    expect(await run(t.path, [points], 'stories', 'edit', 'WEB-1', '--no-points')).toBe(0);
    expect(await readJsonFile(t, storyFile('WEB-1'))).not.toHaveProperty('plugins');
  });

  it('a repeatable option keeps commas literal unless the Plugin opts in to parseRepeatable (CQ-03)', async () => {
    const seen: unknown[] = [];
    const tags = definePlugin({
      id: 'tags',
      name: 'Tags',
      description: '',
      options: {
        'stories create': {
          options: [{ flags: '--tag <text>', description: 'a tag (repeatable)', repeatable: true }],
          input: ({ tag }) => (tag === undefined ? undefined : { tag }),
        },
      },
      hooks: { 'stories.create': { guard: ({ pluginInput }) => void seen.push(pluginInput) } },
    });
    const t = await pluginRoot({ tags: true, specs: true });
    expect(await run(t.path, [tags], 'stories', 'create', '--name', 'A', '--tag', 'a, b', '--tag', 'c')).toBe(0);
    expect(seen).toEqual([{ tag: ['a, b', 'c'] }]);
  });

  it('a Plugin option on stories list must be a filter, and on other commands an input (DX-12)', async () => {
    const wrong = definePlugin({
      id: 'wrong',
      name: 'Wrong',
      description: '',
      // A JavaScript Plugin can get this wrong; the types reject it.
      options: { 'stories list': { options: [{ flags: '--wrong', description: '' }], input: () => true } as never },
    });
    const t = await pluginRoot({ wrong: true });
    expect(await run(t.path, [wrong], 'stories', 'list')).toBe(0);
    expect(stderr.join('')).toContain('its options on \\"rowbly stories list\\" need filter(values)');
  });
});

describe('the TUI (DX-07)', () => {
  it('a Plugin input the schema rejects shows under its field, and nothing is saved', async () => {
    const t = await pluginRoot({ points: true });
    const { app } = await openPluginApp(
      t,
      [points],
      { screen: 'story-form', params: { boardId: 'web' } },
      {
        local: { version: 1, board: 'web' },
      },
    );
    await waitForFrame(app, 'Points');
    await app.press('N', 'e', 'w');
    await focusFormField(app, 'Points');
    await app.press('-', '1', KEYS.ctrlS);
    const frame = stripVTControlCharacters(await waitForFrame(app, '>=0'));
    // Inline under the Points field, not a form-level message naming the Plugin.
    expect(frame).not.toContain('Plugin "points"');
    expect(frame).not.toContain('Created');
    await expect(readJsonFile(t, storyFile('WEB-1'))).rejects.toThrow();
    app.unmount();
  });
});

describe('settings (DX-35, CQ-53)', () => {
  it('a strict schema fails the load on a typo; without a schema the raw entry passes through', async () => {
    const t = await pluginRoot({ points: { lable: 'Size' }, raw: { anything: [1] } });
    const raw = definePlugin({ id: 'raw', name: 'Raw', description: '' });
    const { host, services } = await withPlugins(t, [points, raw]);
    expect(host.failures().map((f) => [f.id, f.reason])).toEqual([['points', expect.stringContaining('lable')]]);
    expect(services.plugins.context('raw').settings).toEqual({ anything: [1] });
  });
});
