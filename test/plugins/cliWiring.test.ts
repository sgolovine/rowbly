// Every core command that takes Plugin options passes them to the right operation (ARCH-16), only
// the options the user gave count (DX-10), and startup does only the work it needs (PERF-06).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import { main } from '../../src/main';
import { definePlugin, type PluginOptionCommand } from '../../src/plugin-api';
import { PLUGIN_OPTION_COMMANDS } from '../../src/services';
import { makeStory } from '../helpers';
import { pluginRoot, readJsonFile } from './helpers';

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (stdout.push(String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (stderr.push(String(chunk)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

/** The operation (or the `stories list` filter) each option command passes its Plugin input to. */
const OPERATION_OF: Record<PluginOptionCommand, string> = {
  'assignees add': 'assignees.add',
  'assignees edit': 'assignees.update',
  'assignees remove': 'assignees.remove',
  'boards create': 'boards.create',
  'boards edit': 'boards.update',
  'boards delete': 'boards.remove',
  'stories list': 'stories.list',
  'stories create': 'stories.create',
  'stories edit': 'stories.update',
  'stories move': 'stories.move',
  'stories rank': 'stories.rank',
  'stories delete': 'stories.remove',
  'tasks create': 'tasks.create',
  'tasks edit': 'tasks.update',
  'tasks move': 'tasks.move',
  'tasks delete': 'tasks.remove',
};

function recorder() {
  const seen: [string, unknown][] = [];
  const plugin = definePlugin({
    id: 'rec',
    name: 'Recorder',
    description: 'Records its Plugin input',
    options: Object.fromEntries(
      PLUGIN_OPTION_COMMANDS.map((command) => [
        command,
        {
          options: [
            { flags: '--rec <v>', description: '' },
            { flags: '--no-rec', description: '' },
            { flags: '--no-skip', description: 'a lone negation' },
          ],
          input: (values: Record<string, unknown>) =>
            Object.values(values).some((v) => v !== undefined) ? values : undefined,
        },
      ]),
    ),
    hooks: Object.fromEntries(
      Object.values(OPERATION_OF)
        .filter((op) => op !== 'stories.list')
        .map((op) => [op, { guard: ({ pluginInput }: { pluginInput: unknown }) => void seen.push([op, pluginInput]) }]),
    ),
    filterStories: (_story, filter) => {
      seen.push(['stories.list', filter]);
      return true;
    },
  });
  return { plugin, seen };
}

async function setup() {
  const t = await pluginRoot({ rec: true });
  const { plugin, seen } = recorder();
  const run = async (...argv: string[]) => {
    const code = await main(['--root', t.path, '--json', '--yes', ...argv], [plugin]);
    expect(code, `${argv.join(' ')}: ${stderr.join('')}`).toBe(0);
  };
  return { t, seen, run };
}

describe('Plugin options reach their operation (ARCH-16)', () => {
  it('on every option command, including option-only edits of Boards, Tasks and Assignees', async () => {
    const { seen, run } = await setup();
    const cases: [PluginOptionCommand, string[]][] = [
      ['assignees add', ['assignees', 'add', 'bob', '--name', 'Bob']],
      ['assignees edit', ['assignees', 'edit', 'bob']],
      ['boards create', ['boards', 'create', 'api', '--name', 'API', '--prefix', 'API']],
      ['boards edit', ['boards', 'edit', 'api']],
      ['stories create', ['stories', 'create', '--name', 'A', '--board', 'web']],
      ['stories edit', ['stories', 'edit', 'WEB-1']],
      ['stories move', ['stories', 'move', 'WEB-1', 'done']],
      ['stories rank', ['stories', 'rank', 'WEB-1', '--top']],
      ['tasks create', ['tasks', 'create', 'WEB-1', '--name', 'T']],
      ['tasks edit', ['tasks', 'edit', 'WEB-1.1']],
      ['tasks move', ['tasks', 'move', 'WEB-1.1', 'done']],
      ['tasks delete', ['tasks', 'delete', 'WEB-1.1']],
      ['stories list', ['stories', 'list', '--board', 'web']],
      ['stories delete', ['stories', 'delete', 'WEB-1']],
      ['boards delete', ['boards', 'delete', 'api']],
      ['assignees remove', ['assignees', 'remove', 'bob']],
    ];
    expect(cases.map(([command]) => command).sort()).toEqual([...PLUGIN_OPTION_COMMANDS].sort());
    for (const [command, argv] of cases) {
      seen.length = 0;
      await run(...argv, '--rec', command);
      expect(seen, command).toContainEqual([OPERATION_OF[command], { rec: command }]);
    }
  });
});

describe('only the options the user gave count (DX-10)', () => {
  it('no flag gives no Plugin input, and a lone --no-x never filters an unfiltered list', async () => {
    const { t, seen, run } = await setup();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await run('stories', 'list');
    expect(JSON.parse(stdout.join(''))).toHaveLength(1);
    await run('stories', 'create', '--name', 'B');
    expect(seen).toEqual([['stories.create', undefined]]);
  });

  it('--no-x is told apart; with both --x and --no-x the last one wins', async () => {
    const { t, seen, run } = await setup();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await run('boards', 'edit', 'web', '--no-skip');
    await run('boards', 'edit', 'web', '--rec', 'a', '--no-rec');
    await run('boards', 'edit', 'web', '--no-rec', '--rec', 'b');
    await run('stories', 'list', '--no-skip');
    expect(seen).toEqual([
      ['boards.update', { skip: false }],
      ['boards.update', { rec: false }],
      ['boards.update', { rec: 'b' }],
      ['stories.list', { skip: false }],
    ]);
  });
});

describe('startup (PERF-06, ARCH-28)', () => {
  function counted() {
    let starts = 0;
    const plugin = definePlugin({
      id: 'counted',
      name: 'Counted',
      description: 'Counts its activations',
      start: () => void starts++,
      commands(group) {
        group.command('hello').description('says hello');
      },
    });
    return { plugin, starts: () => starts };
  }

  it('--version skips activation, with globals before or after it', async () => {
    const t = await pluginRoot({ counted: true });
    const { plugin, starts } = counted();
    for (const argv of [['--version'], ['-V'], ['--root', t.path, '--version'], ['--version', '--json'], ['--json', '-V']]) {
      stdout.length = 0;
      expect(await main(argv, [plugin])).toBe(0);
      expect(stdout.join('')).toBe(`${pkg.version}\n`);
    }
    expect(starts()).toBe(0);
    expect(stderr).toEqual([]);
  });

  it('help still activates the Plugins and lists their commands', async () => {
    const t = await pluginRoot({ counted: true });
    const { plugin, starts } = counted();
    expect(await main(['--root', t.path, '--help'], [plugin])).toBe(0);
    expect(stdout.join('')).toMatch(/counted\s+Counts its activations/);
    expect(starts()).toBe(1);
  });
});

describe('plugins disable after a load failure', () => {
  it('turns off a Plugin whose commands or declarations failed', async () => {
    const broken = definePlugin({
      id: 'broken',
      name: 'Broken',
      description: '',
      commands() {
        throw new Error('commands bug');
      },
    });
    const dupe = definePlugin({
      id: 'dupe',
      name: 'Dupe',
      description: '',
      options: {
        'stories create': {
          options: [
            { flags: '--x', description: '' },
            { flags: '--x', description: '' },
          ],
          input: () => undefined,
        },
      },
    });
    const t = await pluginRoot({ broken: true, dupe: true });
    for (const id of ['broken', 'dupe']) {
      expect(await main(['--root', t.path, 'plugins', 'disable', id], [broken, dupe])).toBe(0);
    }
    expect((await readJsonFile(t, 'rowbly.config.json')).plugins).toEqual({
      broken: { enabled: false },
      dupe: { enabled: false },
    });
  });
});
