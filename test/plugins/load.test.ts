import { readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProgram, reservedNames } from '../../src/main';
import type { AnyPluginDefinition } from '../../src/services';
import { failureWarning, loadPlugins, onOff, validatePluginDefinition } from '../../src/services';
import { coordinated } from '../../src/services/coordination';
import { withGitWorker } from '../../src/storage/gitRepository';
import { publishPublication, withPublication } from '../../src/storage/gitSyncJournal';
import { createToastStore } from '../../src/tui/hooks';
import { loadTuiPlugins, withPlugins as withTuiPlugins } from '../../src/tui/loadPlugins';
import { settingsGroups } from '../../src/tui/screens/settings/sections';
import { makeStory, tempRoot } from '../helpers';
import { syncFixture } from '../storage/fixtures/syncFixture';
import { boom, notes, stamp, strict } from './fixtures';
import { paste } from './fixtures/paste';
import { pluginRoot, withPlugins } from './helpers';

describe('loading Plugins (ADR-0010)', () => {
  it('turns on only the Plugins that rowbly.config.json enables, in registry order', async () => {
    const t = await pluginRoot({ stamp: true, notes: true });
    const { host, services } = await withPlugins(t, [notes, stamp, boom]);
    expect(host.active().map((p) => p.definition.id)).toEqual(['notes', 'stamp']);
    expect(host.status().map((s) => [s.id, onOff(s)])).toEqual([
      ['notes', 'on'],
      ['stamp', 'on'],
      ['boom', 'off'],
    ]);
    expect(host.failures()).toEqual([]);
    const plugins = await loadTuiPlugins(host);
    const board = await services.boards.get('web');
    const groups = settingsGroups(board, plugins);
    expect(groups[0]?.sections.find((s) => s.label === 'Scoped Notes')?.params).toMatchObject({
      plugin: 'notes',
      screen: 'note',
      scope: 'global',
      boardId: undefined,
      marker: 'kept',
    });
    expect(groups[1]?.sections.find((s) => s.label === 'Scoped Notes')?.params).toMatchObject({
      plugin: 'notes',
      screen: 'note',
      scope: 'board',
      boardId: 'web',
      marker: 'kept',
    });
    expect(groups.find((g) => g.title === 'Plugins: notes')?.sections.map((s) => s.label)).toEqual(['Notes']);
    const noBoard = settingsGroups(null, plugins);
    expect(noBoard[1]?.sections).toEqual([]);
    expect(noBoard[0]?.sections.some((s) => s.label === 'Scoped Notes')).toBe(true);

    // The real program loader registers only the recovered configuration, before createContext.
    for (const enabled of [false, true]) {
      const t = await tempRoot();
      await writeFile(
        join(t.path, 'rowbly.config.json'),
        JSON.stringify({ version: 1, plugins: { future: { enabled: !enabled } } }),
      );
      await writeFile(
        join(t.path, 'local.json'),
        JSON.stringify({ version: 1, plugins: { future: { snapshot: 'initial' } } }),
      );
      const f = await syncFixture(t.dir, t.path, JSON.stringify({ version: 1, plugins: { future: { enabled } } }));
      await withGitWorker(f.repo, () =>
        withPublication(f.repo, async (hold) => {
          await expect(
            publishPublication(hold, f.plan, {
              checkpoint(point) {
                if (point === 'ref-effect') throw new Error('interrupted before config installation');
              },
            }),
          ).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
        }),
      );
      const events: string[] = [];
      const probe: AnyPluginDefinition = {
        id: 'future',
        name: 'Future',
        description: 'Recovered startup probe',
        commands(group) {
          events.push('register');
          group.command('inspect').action(() => {
            events.push('command');
          });
        },
        async start({ localData }) {
          events.push('start');
          await expect(stat(join(t.path, '.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
          await expect(stat(f.repo.journal)).rejects.toMatchObject({ code: 'ENOENT' });
          const value = (await localData()) as { snapshot: string };
          expect(value).toEqual({ snapshot: 'initial' });
          value.snapshot = 'mutated callback copy';
          // A callback can coordinate its own effects: no root lock or gate spans start.
          await coordinated(t.root, 'later Local State save', () =>
            writeFile(
              join(t.path, 'local.json'),
              JSON.stringify({ version: 1, plugins: { future: { snapshot: 'later' } } }),
            ),
          );
          expect(await localData()).toEqual({ snapshot: 'initial' });
        },
      };
      const { program, host } = await loadProgram(t.root, [probe]);
      expect(host.failures()).toEqual([]);
      expect(host.status()[0]).toMatchObject({ enabled, loaded: enabled });
      expect(program.commands.some((command) => command.name() === 'future')).toBe(enabled);
      if (enabled) {
        await program.parseAsync(['future', 'inspect'], { from: 'user' });
        expect(events).toEqual(['register', 'start', 'command']);
      } else expect(events).toEqual([]);
      host.dispose?.();
      await t.cleanup();
    }

    const broken = await tempRoot();
    await writeFile(
      join(broken.path, 'rowbly.config.json'),
      JSON.stringify({ version: 1, plugins: { future: { enabled: true } } }),
    );
    const f = await syncFixture(broken.dir, broken.path);
    await withGitWorker(f.repo, () =>
      withPublication(f.repo, async (hold) => {
        await expect(
          publishPublication(hold, f.plan, {
            checkpoint: async (point) => {
              if (point === 'ref') {
                await writeFile(join(broken.path, 'rowbly.config.json'), '{"version":1,"external":"preserve me"}');
              }
            },
          }),
        ).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
      }),
    );
    const events: string[] = [];
    await expect(
      loadProgram(broken.root, [
        {
          id: 'future',
          name: 'Future',
          description: 'Must not register or start',
          commands() {
            events.push('register');
          },
          start() {
            events.push('start');
          },
        },
      ]),
    ).rejects.toMatchObject({
      code: 'DATA_INTEGRITY',
      exitCode: 6,
      details: { path: f.repo.journal, paths: expect.arrayContaining(['.rowbly/rowbly.config.json']) },
    });
    expect(events).toEqual([]);
    expect(await readFile(join(broken.path, 'rowbly.config.json'), 'utf8')).toContain('preserve me');
    expect(await readFile(f.repo.journal, 'utf8')).toContain(f.plan.candidate);
  });

  it('skips a Plugin that throws while it starts, whose settings are invalid, or that it does not have', async () => {
    expect(
      validatePluginDefinition({ ...notes, externalReads: ['gh-pr-view', 'gh-pr-commits'] }, reservedNames()),
    ).toEqual([]);
    expect(
      validatePluginDefinition(
        {
          ...notes,
          boardStats: {
            metrics: [
              { key: 'count', label: 'Count' },
              { key: 'count', label: 'Duplicate' },
            ],
            collect: async () => ({}),
          },
        },
        reservedNames(),
      ),
    ).toContainEqual(expect.objectContaining({ path: 'boardStats' }));
    for (const reads of [['arbitrary-executable'], ['gh-pr-view', 'gh-pr-view']]) {
      const definition = { ...notes, externalReads: reads } as unknown as AnyPluginDefinition;
      expect(validatePluginDefinition(definition, reservedNames())).toContainEqual(
        expect.objectContaining({ path: 'externalReads' }),
      );
      const invalid = await pluginRoot({ notes: true });
      const setup = await withPlugins(invalid, [definition]);
      expect(setup.host.active()).toEqual([]);
      expect(setup.host.failures()[0]?.reason).toContain('externalReads');
    }
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
    const images = await pluginRoot({ paste: true, second: true, stamp: true });
    const second = { ...paste, id: 'second', name: 'Second' };
    for (const staged of [false, true]) {
      const setup = await withPlugins(images, [paste, second, stamp]);
      const loaded = staged
        ? await withTuiPlugins(
            setup.ctx,
            (root, stage) => loadPlugins({ root, stage, registry: [paste, second, stamp], reserved: reservedNames() }),
            createToastStore(),
          )
        : await loadTuiPlugins(setup.host);
      expect(loaded.map((p) => p.id)).toEqual(['paste', 'stamp']);
      expect(setup.ctx.plugins?.failures()).toEqual([
        expect.objectContaining({ id: 'second', reason: 'storyPaste is already claimed by Plugin "paste"' }),
      ]);
    }
    const setup = await withPlugins(images, []);
    const loaded = await withTuiPlugins(
      setup.ctx,
      (root, stage) =>
        loadPlugins({
          root,
          stage,
          reserved: reservedNames(),
          registry: [
            {
              ...paste,
              start() {
                throw new Error('failed startup');
              },
            },
            second,
            stamp,
          ],
        }),
      createToastStore(),
    );
    expect(loaded.map((p) => p.id)).toEqual(['second', 'stamp']);
    expect(setup.ctx.plugins?.failures()).toEqual([expect.objectContaining({ id: 'paste', reason: 'failed startup' })]);

    const noRoot = await loadProgram(null, [notes, boom]);
    expect(noRoot.host.active()).toEqual([]);
    const malformed = await tempRoot();
    await writeFile(join(malformed.path, 'rowbly.config.json'), 'broken config');
    expect((await loadProgram(malformed.root, [notes])).host.active()).toEqual([]);
    await writeFile(
      join(malformed.path, 'rowbly.config.json'),
      JSON.stringify({ version: 1, plugins: { notes: { enabled: true }, probe: { enabled: true } } }),
    );
    await writeFile(join(malformed.path, 'local.json'), 'broken Local State');
    const isolated = await loadProgram(malformed.root, [
      notes,
      {
        id: 'probe',
        name: 'Probe',
        description: 'Needs Local State',
        async start({ localData }) {
          await localData();
        },
      },
    ]);
    expect(isolated.host.active().map((plugin) => plugin.definition.id)).toEqual(['notes']);
    expect(isolated.host.failures().map((plugin) => plugin.id)).toEqual(['probe']);

    // A Story Context keeps the sections it could read and lists every gap: a Plugin that did not
    // load and one whose section throws. An off Plugin is no gap. It saves nothing (ADR-0044, ADR-0011).
    // `ROWBLY.md` is read as stored text, or `null` without one; a linked one is refused (ADR-0047).
    const lens: AnyPluginDefinition = {
      id: 'lens',
      name: 'Lens',
      description: 'Fails to give its section',
      async storyContext() {
        throw new Error('lens failed');
      },
    };
    const read = await pluginRoot({ notes: true, lens: true, boom: true });
    await makeStory(read.path, {
      key: 'WEB-1',
      boardId: 'web',
      plugins: { notes: { note: 'read me' }, later: { kept: 1 } },
    });
    await writeFile(join(read.path, 'ROWBLY.md'), '# How we work\n\nAsk before moving to Done.\n');
    const files = async () => {
      const names = (await readdir(read.path, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .sort();
      return Promise.all(names.map(async (name) => [name, await readFile(name, 'utf8')]));
    };
    const before = await files();
    const reader = await withPlugins(read, [notes, lens, boom]);
    const notesContext = reader.services.plugins.context('notes');
    const context = await notesContext.storyContext('WEB-1');
    expect(await notesContext.readRowblyMd()).toBe('# How we work\n\nAsk before moving to Done.\n');
    expect(context.plugins).toEqual(['notes', 'lens']);
    expect(context.sections).toEqual([{ plugin: 'notes', title: 'Note', text: 'read me', data: { note: 'read me' } }]);
    expect(context.incomplete).toEqual([
      { plugin: 'boom', reason: 'failed to load: boom at start' },
      { plugin: 'lens', reason: 'lens failed' },
    ]);
    expect(await files()).toEqual(before);
    await rm(join(read.path, 'ROWBLY.md'));
    expect(await notesContext.readRowblyMd()).toBeNull();
    await symlink(join(read.path, 'rowbly.config.json'), join(read.path, 'ROWBLY.md'));
    await expect(notesContext.readRowblyMd()).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
