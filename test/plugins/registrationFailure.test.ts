// A Plugin whose registration fails is skipped as a whole and leaves nothing behind (RES-14, RES-22,
// ARCH-24, ARCH-40, ADR-0020 §8).
import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { pluginCliStager } from '../../src/commands';
import { pluginsOf } from '../../src/commands/_shared';
import { createProgram, loadProgram, reservedNames } from '../../src/main';
import { type AnyPluginDefinition, definePlugin } from '../../src/plugin-api';
import { loadPlugins } from '../../src/services';
import { loadTuiPlugins } from '../../src/tui/loadPlugins';
import { notes } from './fixtures';
import { pluginRoot } from './helpers';

type Flags = string[];

/** A Plugin with the given flags on `stories create`, and a command group unless `commands` is false. */
function flagged(id: string, flags: Flags, opts: { commands?: boolean; throws?: boolean } = {}) {
  return definePlugin({
    id,
    name: id,
    description: `${id} plugin`,
    options: {
      'stories create': { options: flags.map((f) => ({ flags: f, description: '' })), input: () => undefined },
    },
    ...(opts.commands === false
      ? {}
      : {
          commands(group) {
            group.command('hello').action(() => {});
            if (opts.throws) throw new Error('commands bug');
          },
        }),
  });
}

function command(program: Command, path: string): Command | undefined {
  let at: Command | undefined = program;
  for (const name of path.split(' ')) at = at?.commands.find((c) => c.name() === name);
  return at;
}

const longs = (program: Command, path: string) => (command(program, path)?.options ?? []).map((o) => o.long);
const groups = (program: Command) => program.commands.map((c) => c.name());
const attachedIds = (program: Command, path: string) =>
  (pluginsOf(program)?.options.get(path) ?? []).map((o) => o.id);

async function load(registry: AnyPluginDefinition[]) {
  const t = await pluginRoot(Object.fromEntries(registry.map((d) => [d.id, true])));
  return { t, ...(await loadProgram(t.root, registry)) };
}

describe('duplicate and malformed option declarations (RES-14, ARCH-40)', () => {
  it('fail only their own Plugin, before anything is attached', async () => {
    const { program, host } = await load([
      flagged('dupe', ['--foo <x>', '--foo <y>']),
      flagged('twice', ['--bar', '--bar']),
      flagged('negs', ['--no-baz', '--no-baz']),
      flagged('same', ['--foo-1-bar', '--foo1-bar']),
      flagged('mixed', ['--qux-1-x <v>', '--no-qux1-x']),
      flagged('double', ['--foo--bar']),
      flagged('trailing', ['--foo-bar-']),
      notes,
    ]);
    expect(host.failures().map((f) => [f.id, f.reason])).toEqual([
      ['dupe', '--foo is declared twice on "rowbly stories create"'],
      ['twice', '--bar is declared twice on "rowbly stories create"'],
      ['negs', '--no-baz is declared twice on "rowbly stories create"'],
      ['same', '--foo-1-bar and --foo1-bar on "rowbly stories create" are the same option (foo1Bar)'],
      ['mixed', '--qux-1-x and --no-qux1-x on "rowbly stories create" are the same option (qux1X)'],
      ['double', 'option "--foo--bar" on "rowbly stories create" must be one long lower-kebab-case flag'],
      ['trailing', 'option "--foo-bar-" on "rowbly stories create" must be one long lower-kebab-case flag'],
    ]);
    expect(host.active().map((p) => p.definition.id)).toEqual(['notes']);
    // Nothing of the failed Plugins: no command group, no option, no input adapter.
    for (const id of ['dupe', 'twice', 'negs', 'same', 'mixed', 'double', 'trailing']) {
      expect(groups(program)).not.toContain(id);
    }
    expect(longs(program, 'stories create')).toEqual([...longs(createProgram(), 'stories create'), '--note']);
    expect(attachedIds(program, 'stories create')).toEqual(['notes']);
    expect(groups(program)).toContain('notes');
  });

  it('allow the intentional --x / --no-x pair', async () => {
    const { program, host } = await load([flagged('pair', ['--x <v>', '--no-x'])]);
    expect(host.failures()).toEqual([]);
    expect(longs(program, 'stories create')).toEqual(expect.arrayContaining(['--x', '--no-x']));
  });

  it('core commands still construct and run', async () => {
    const { t, program } = await load([flagged('dupe', ['--foo <x>', '--foo <y>'])]);
    await program.parseAsync(['--root', t.path, '--json', 'stories', 'list'], { from: 'user' });
  });
});

describe('a Plugin whose CLI fails while it is staged (ARCH-24, RES-22)', () => {
  it('a throwing commands() attaches no group and no option, and releases its claims for later Plugins', async () => {
    const { program, host } = await load([
      flagged('fails', ['--shared'], { throws: true }),
      flagged('later', ['--shared']),
    ]);
    expect(host.failures().map((f) => [f.id, f.reason])).toEqual([['fails', 'its commands failed: commands bug']]);
    expect(host.active().map((p) => p.definition.id)).toEqual(['later']);
    expect(groups(program)).not.toContain('fails');
    expect(groups(program)).toContain('later');
    expect(attachedIds(program, 'stories create')).toEqual(['later']);
    expect(longs(program, 'stories create').filter((l) => l === '--shared')).toHaveLength(1);
  });

  it('a missing core command for its options is a contract error: no group, no option', async () => {
    const t = await pluginRoot({ tasked: true });
    const program = createProgram();
    // A deliberately inconsistent program: the reserved names say `tasks create` takes options.
    program.commands.splice(
      program.commands.findIndex((c) => c.name() === 'tasks'),
      1,
    );
    const tasked = definePlugin({
      id: 'tasked',
      name: 'Tasked',
      description: '',
      commands(group) {
        group.command('hello');
      },
      options: {
        'stories create': { options: [{ flags: '--tag <t>', description: '' }], input: () => undefined },
        'tasks create': { options: [{ flags: '--tag <t>', description: '' }], input: () => undefined },
      },
    });
    const cli = pluginCliStager(program);
    const host = await loadPlugins({ root: t.root, registry: [tasked], reserved: reservedNames(), stage: cli.stage });
    cli.attach(host);
    expect(host.failures().map((f) => f.reason)).toEqual([
      'its options failed: "rowbly tasks create" is not a command of this program',
    ]);
    expect(groups(program)).not.toContain('tasked');
    expect(longs(program, 'stories create')).not.toContain('--tag');
    expect(pluginsOf(program)?.options.size).toBe(0);
  });

  it('a healthy earlier Plugin keeps its names', async () => {
    const { host } = await load([flagged('first', ['--shared']), flagged('second', ['--shared'])]);
    expect(host.failures().map((f) => [f.id, f.reason])).toEqual([
      ['second', '--shared is already an option of "rowbly stories create"'],
    ]);
  });
});

describe('the TUI part is staged in the same activation (RES-22, W10)', () => {
  const action = (id: string, tui?: () => Promise<never>) =>
    definePlugin({
      id,
      name: id,
      description: '',
      actions: [{ key: 'X', label: id, target: 'story', run: () => {} }],
      ...(tui ? { tui } : {}),
    });
  const broken = () => action('broken', () => Promise.reject(new Error('no module')));

  it('a TUI import failure while loading releases its Action key for a later Plugin', async () => {
    const t = await pluginRoot({ broken: true, later: true });
    const parts = new Map<string, unknown>();
    const host = await loadPlugins({
      root: t.root,
      registry: [broken(), action('later')],
      reserved: reservedNames(),
      stage: async ({ definition }) => {
        try {
          parts.set(definition.id, definition.tui ? await definition.tui() : {});
        } catch (err) {
          throw new Error(`its TUI part failed: ${(err as Error).message}`);
        }
      },
    });
    expect(host.failures().map((f) => [f.id, f.reason])).toEqual([['broken', 'its TUI part failed: no module']]);
    expect(host.active().map((p) => p.definition.id)).toEqual(['later']);
  });

  it('a failure after activation does not retry a Plugin rejected before it (documented policy)', async () => {
    const t = await pluginRoot({ broken: true, later: true });
    // Loaded without staging, e.g. an injected host: the TUI part fails only afterwards.
    const host = await loadPlugins({ root: t.root, registry: [broken(), action('later')], reserved: reservedNames() });
    expect(host.failures().map((f) => f.id)).toEqual(['later']);
    expect(await loadTuiPlugins(host)).toEqual([]);
    expect(host.failures().map((f) => [f.id, f.reason])).toEqual([
      ['broken', 'its TUI part failed: no module'],
      ['later', 'the key "X" is already in use'],
    ]);
    expect(host.active()).toEqual([]);
  });
});
