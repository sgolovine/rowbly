import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProgram } from '../../src/main';
import type { AnyPluginDefinition } from '../../src/services';
import { failureWarning, invokePlugin, onOff } from '../../src/services';
import { coordinated } from '../../src/services/coordination';
import { createGitSync } from '../../src/services/plugins/gitSync';
import { withGitWorker } from '../../src/storage/gitRepository';
import { publishPublication, withPublication } from '../../src/storage/gitSyncJournal';
import { tempRoot } from '../helpers';
import { syncFixture } from '../storage/fixtures/syncFixture';
import { boom, notes, stamp, strict } from './fixtures';
import { pluginRoot, withPlugins } from './helpers';

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
    const sync = createGitSync(t.root, 'git', [], () => undefined);
    await invokePlugin({ plugin: 'notes', stage: 'status' }, async () => {
      const options = () => ({ enabled: true, intervalSeconds: 300 });
      await expect(sync.requestRebaseSync(options)).rejects.toThrow('live command or screen');
      await expect(sync.requestSync(options)).rejects.toThrow('command or screen');
      await expect(sync.resumeSync(options)).rejects.toThrow('live reaction');
    });
    // No repository exists: these reject before discovery, metadata, scheduling or network work.
    await expect(stat(join(t.dir, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });

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
  });
});
