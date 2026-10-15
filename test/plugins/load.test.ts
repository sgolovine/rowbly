import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../../src/core';
import { reservedNames } from '../../src/main';
import { definePlugin } from '../../src/plugin-api';
import { failureWarning, loadPlugins, onOff } from '../../src/services';
import { makeBoard } from '../helpers';
import { boom, clash, notes, rival, stamp, storiesPlugin, strict } from './fixtures';
import { pluginRoot, readJsonFile, withPlugins } from './helpers';

const reserved = reservedNames();

describe('loading Plugins (ADR-0010)', () => {
  it('turns on only the Plugins that rowbly.config.json enables, in registry order', async () => {
    const t = await pluginRoot({ stamp: true, notes: true });
    const { host } = await withPlugins(t, [notes, stamp, boom]);
    expect(host.active().map((p) => p.definition.id)).toEqual(['notes', 'stamp']);
    expect(host.status().map((s) => [s.id, onOff(s)])).toEqual([
      ['notes', 'on'],
      ['stamp', 'on'],
      ['boom', 'off'],
    ]);
    expect(host.failures()).toEqual([]);
  });

  it('turns nothing on without a Data Root', async () => {
    const host = await loadPlugins({ root: null, registry: [notes], reserved });
    expect(host.active()).toEqual([]);
    expect(host.status()[0]).toMatchObject({ id: 'notes', enabled: false, loaded: false });
  });

  it('skips a Plugin that throws while it starts, whose settings are invalid, or that it does not have', async () => {
    const t = await pluginRoot(
      {},
      {
        plugins: {
          notes: { enabled: true },
          boom: { enabled: true },
          strict: { enabled: true, level: 'high' },
          ghost: { enabled: true },
          // Off and unknown: listed, but no failure.
          later: { enabled: false, kept: 1 },
        },
      },
    );
    const { host } = await withPlugins(t, [notes, boom, strict]);
    expect(host.active().map((p) => p.definition.id)).toEqual(['notes']);
    expect(host.failures().map((f) => [f.id, f.reason])).toEqual([
      ['boom', 'boom at start'],
      ['strict', 'invalid settings: level: Invalid input: expected number, received string'],
      ['ghost', 'this version of Rowbly does not have it'],
    ]);
    expect(host.status().find((s) => s.id === 'later')).toMatchObject({ known: false, enabled: false });
    expect(host.status().find((s) => s.id === 'ghost')).toMatchObject({ known: false, enabled: true });
    expect(host.failures().map(failureWarning)[0]).toBe(
      'Plugin "boom" failed to load (boom at start); Rowbly runs without it and keeps its data. ' +
        'Turn it off with `rowbly plugins disable boom`',
    );
  });

  it('applies the settings schema, with its defaults', async () => {
    const t = await pluginRoot({ notes: { blocked: ['x'] } });
    const { host, services } = await withPlugins(t, [notes]);
    expect(host.active()[0]?.settings).toEqual({ marker: 'note', blocked: ['x'] });
    expect(services.plugins.context('notes').settings).toEqual({ marker: 'note', blocked: ['x'] });
  });

  it('deep-merges a Board bag over the Data Root settings, and refuses an invalid one (ADR-0005)', async () => {
    const t = await pluginRoot({ notes: { marker: 'n', blocked: ['a', 'b'] } });
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API', plugins: { notes: { blocked: ['c'], enabled: false } } });
    await makeBoard(t.path, { id: 'bad', keyPrefix: 'BAD', plugins: { notes: { marker: 7 } } });
    const plugin = (await withPlugins(t, [notes])).services.plugins.context('notes');
    // A list replaces the inherited one; `enabled` in a Board bag means nothing.
    expect(await plugin.boardSettings('api')).toEqual({ marker: 'n', blocked: ['c'] });
    expect(await plugin.boardSettings('web')).toEqual({ marker: 'n', blocked: ['a', 'b'] });
    await expect(plugin.boardSettings('bad')).rejects.toThrow(ValidationError);
  });

  describe('a clash makes the later Plugin fail to load (ADR-0012)', () => {
    it('with a core command name', async () => {
      const t = await pluginRoot({ stories: true });
      const { host } = await withPlugins(t, [storiesPlugin]);
      expect(host.failures()[0]?.reason).toBe('"rowbly stories" is already a command');
    });

    it('with a core option or an earlier Plugin option', async () => {
      const again = definePlugin({
        id: 'again',
        name: 'Again',
        description: '',
        options: { 'stories edit': { options: [{ flags: '--no-note', description: '' }], input: () => undefined } },
      });
      const t = await pluginRoot({ clash: true, notes: true, again: true });
      const { host } = await withPlugins(t, [clash, notes, again]);
      expect(host.active().map((p) => p.definition.id)).toEqual(['notes']);
      expect(host.failures().map((f) => f.reason)).toEqual([
        '--name is already an option of "rowbly stories create"',
        '--no-note is already an option of "rowbly stories edit"',
      ]);
    });

    it('with an earlier replacement of the same operation', async () => {
      const t = await pluginRoot({ stamp: true, rival: true });
      const { host } = await withPlugins(t, [stamp, rival]);
      expect(host.failures().map((f) => [f.id, f.reason])).toEqual([
        ['rival', 'another Plugin already replaces tasks.create'],
      ]);
    });

    it('with a core key or an earlier Action key', async () => {
      const action = (id: string, key: string) =>
        definePlugin({
          id,
          name: id,
          description: '',
          actions: [{ key, label: id, target: 'story', run: () => {} }],
        });
      const t = await pluginRoot({ edits: true, first: true, second: true });
      const { host } = await withPlugins(t, [action('edits', 'e'), action('first', 'X'), action('second', 'X')]);
      expect(host.active().map((p) => p.definition.id)).toEqual(['first']);
      expect(host.failures().map((f) => f.reason)).toEqual([
        'the key "e" is already in use',
        'the key "X" is already in use',
      ]);
    });

    it('with options on a command that takes none, or short flags', async () => {
      const bad = (id: string, command: string, flags: string) =>
        definePlugin({
          id,
          name: id,
          description: '',
          options: { [command]: { options: [{ flags, description: '' }], input: () => undefined } },
        });
      const t = await pluginRoot({ one: true, two: true });
      const { host } = await withPlugins(t, [bad('one', 'doctor', '--deep'), bad('two', 'stories create', '-e, --e')]);
      expect(host.failures().map((f) => f.reason)).toEqual([
        '"rowbly doctor" does not take Plugin options',
        'option "-e, --e" on "rowbly stories create" must be one long flag',
      ]);
    });
  });

  it('markFailed skips a loaded Plugin for the rest of the run', async () => {
    const t = await pluginRoot({ notes: true });
    const { host, services } = await withPlugins(t, [notes]);
    host.markFailed('notes', 'its TUI part failed: no');
    expect(host.active()).toEqual([]);
    expect(host.failures()[0]).toMatchObject({ id: 'notes', reason: 'its TUI part failed: no' });
    expect(() => services.plugins.context('notes')).toThrow(NotFoundError);
  });
});

describe('plugins service', () => {
  it('enable and disable change only `enabled`, keeping settings and data', async () => {
    const t = await pluginRoot({}, { plugins: { notes: { enabled: false, marker: 'm' } } });
    const { services } = await withPlugins(t, [notes, strict]);
    expect(await services.plugins.enable('notes')).toEqual({ id: 'notes', enabled: true });
    expect((await readJsonFile(t, 'rowbly.config.json')).plugins).toEqual({ notes: { enabled: true, marker: 'm' } });
    await services.plugins.disable('notes');
    expect((await readJsonFile(t, 'rowbly.config.json')).plugins).toEqual({ notes: { enabled: false, marker: 'm' } });
    expect(await services.plugins.get('notes')).toMatchObject({ id: 'notes', settings: { marker: 'm' } });
  });

  it('refuses to enable a Plugin with invalid settings or one it does not have', async () => {
    const t = await pluginRoot({}, { plugins: { strict: { enabled: false, level: 'x' }, ghost: { enabled: true } } });
    const { services } = await withPlugins(t, [strict]);
    await expect(services.plugins.enable('strict')).rejects.toThrow(ValidationError);
    await expect(services.plugins.enable('nope')).rejects.toThrow(NotFoundError);
    // A Plugin this version does not have can still be turned off.
    await services.plugins.disable('ghost');
    expect((await readJsonFile(t, 'rowbly.config.json')).plugins).toMatchObject({ ghost: { enabled: false } });
    await expect(services.plugins.disable('nope')).rejects.toThrow(NotFoundError);
  });
});
