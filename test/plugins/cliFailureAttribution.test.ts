// RES-16, OBS-02, DX-39, ARCH-04: every Plugin callback the CLI runs is attributed, and expected
// errors keep their codes (ADR-0020 §5, D7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, UsageError, ValidationError } from '../../src/core';
import { main } from '../../src/main';
import { type AnyPluginDefinition, definePlugin } from '../../src/plugin-api';
import { builtInPlugins } from '../../src/plugins';
import { makeStory } from '../helpers';
import { pluginRoot, readJsonFile, storyFile } from './helpers';

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

/** The `--json` error the last command printed. */
function jsonError(): { code: string; message: string; details: Record<string, unknown> } {
  const line = stderr.join('').trim().split('\n').at(-1) ?? '';
  return JSON.parse(line).error;
}

const thrower = definePlugin({
  id: 'thrower',
  name: 'Thrower',
  description: '',
  commands(group, cli) {
    group.command('type-error').action((_o, c) =>
      cli.run(c, async () => {
        throw new TypeError('command bug');
      }),
    );
    group.command('invalid').action((_o, c) =>
      cli.run(c, async () => {
        throw new ValidationError('bad value', {
          details: { issues: [{ path: ['x'], message: 'no' }] },
          hint: 'fix x',
        });
      }),
    );
    group.command('string').action((_o, c) =>
      cli.run(c, async () => {
        throw 'a string';
      }),
    );
    group.command('body').action((_o, c) =>
      cli.run(c, async ({ plugin }) => {
        await plugin.operation('make', {}, async (changes) => {
          await changes.writeFile('dataRoot', 'made.txt', 'made');
          throw new NotFoundError('nothing to make');
        });
      }),
    );
    group.command('body-bug').action((_o, c) =>
      cli.run(c, async ({ plugin }) => {
        await plugin.operation('make', {}, async () => {
          throw new RangeError('body bug');
        });
      }),
    );
  },
  options: {
    'stories list': {
      options: [{ flags: '--boom <x>', description: 'boom' }],
      filter: ({ boom }) => boom,
    },
    'stories create': {
      options: [{ flags: '--strict-name <x>', description: 'strict' }],
      input: ({ strictName }) => {
        if (strictName === 'bad') throw new UsageError('--strict-name cannot be "bad"');
        if (strictName === 'bug') throw new TypeError('input bug');
        return strictName;
      },
    },
  },
  filterStories() {
    throw new TypeError('filter bug');
  },
});

async function run(args: string[], root: string, registry: readonly AnyPluginDefinition[] = [thrower]) {
  return main(['--root', root, '--json', ...args], registry);
}

describe('CLI attribution (RES-16, OBS-02)', () => {
  it('an unexpected throw from a command is INTERNAL and names the Plugin and stage', async () => {
    const t = await pluginRoot({ thrower: true });
    expect(await run(['thrower', 'type-error'], t.path)).toBe(1);
    expect(jsonError()).toEqual({
      code: 'INTERNAL',
      message: 'Plugin "thrower" failed in its command: command bug',
      details: { plugin: 'thrower', stage: 'command' },
    });
  });

  it('an expected error from a command keeps its code, hint and issues, and gains attribution', async () => {
    const t = await pluginRoot({ thrower: true });
    expect(await run(['thrower', 'invalid'], t.path)).toBe(2);
    expect(jsonError()).toEqual({
      code: 'VALIDATION',
      message: 'bad value',
      details: { issues: [{ path: ['x'], message: 'no' }], plugin: 'thrower', stage: 'command' },
    });
  });

  it('a thrown value that is not an Error is attributed too', async () => {
    const t = await pluginRoot({ thrower: true });
    expect(await run(['thrower', 'string'], t.path)).toBe(1);
    expect(jsonError()).toMatchObject({
      code: 'INTERNAL',
      message: 'Plugin "thrower" failed in its command: a string',
      details: { plugin: 'thrower', stage: 'command' },
    });
  });

  it('a Plugin operation body keeps its expected code and saves nothing', async () => {
    const t = await pluginRoot({ thrower: true });
    expect(await run(['thrower', 'body'], t.path)).toBe(3);
    expect(jsonError()).toMatchObject({
      code: 'NOT_FOUND',
      message: 'nothing to make',
      details: { plugin: 'thrower', operation: 'thrower.make', stage: 'body' },
    });
    expect(await run(['thrower', 'body-bug'], t.path)).toBe(1);
    expect(jsonError()).toMatchObject({
      code: 'INTERNAL',
      message: 'Plugin "thrower" failed in the body of thrower.make: body bug',
      details: { plugin: 'thrower', operation: 'thrower.make', stage: 'body' },
    });
  });

  it('a throwing filter fails the list visibly, never as an empty result (DX-39)', async () => {
    const t = await pluginRoot({ thrower: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    expect(await run(['stories', 'list', '--board', 'web', '--boom', 'x'], t.path)).toBe(1);
    expect(stdout.join('')).toBe('');
    expect(jsonError()).toMatchObject({
      code: 'INTERNAL',
      message: 'Plugin "thrower" failed in its filter: filter bug',
      details: { plugin: 'thrower', stage: 'filter' },
    });
  });

  it('option input conversion keeps a UsageError (exit 2) and attributes a bug (exit 1)', async () => {
    const t = await pluginRoot({ thrower: true });
    expect(await run(['stories', 'create', '--board', 'web', '--name', 'A', '--strict-name', 'bad'], t.path)).toBe(2);
    expect(jsonError()).toMatchObject({
      code: 'USAGE',
      message: '--strict-name cannot be "bad"',
      details: { plugin: 'thrower', stage: 'option-input' },
    });
    expect(await run(['stories', 'create', '--board', 'web', '--name', 'A', '--strict-name', 'bug'], t.path)).toBe(1);
    expect(jsonError()).toMatchObject({
      code: 'INTERNAL',
      details: { plugin: 'thrower', stage: 'option-input' },
    });
    expect(await readJsonFile(t, 'boards/web/board.config.json')).toBeTruthy();
    await expect(readJsonFile(t, storyFile('WEB-1'))).rejects.toThrow();
  });
});

describe('Epics through the CLI (ARCH-04)', () => {
  it('malformed input exits 2, a missing Epic exits 3; nothing is saved and nothing reacts', async () => {
    const t = await pluginRoot({ epics: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const registry = builtInPlugins;

    expect(await run(['stories', 'edit', 'WEB-1', '--epic', 'Auth'], t.path, registry)).toBe(2);
    expect(jsonError()).toMatchObject({
      code: 'VALIDATION',
      details: { plugin: 'epics', operation: 'stories.update', issues: expect.any(Array) },
    });

    expect(await run(['stories', 'edit', 'WEB-1', '--epic', 'auth'], t.path, registry)).toBe(3);
    expect(jsonError()).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Epic "auth" not found',
      details: { plugin: 'epics', operation: 'stories.update', stage: 'guard' },
    });
    expect(await readJsonFile(t, storyFile('WEB-1'))).not.toHaveProperty('plugins');
  });
});

describe('guards and replacements (D7)', () => {
  it('a refused deletion stays CONFLICT (exit 4) and passes canForce on', async () => {
    const keeper = definePlugin({
      id: 'keeper',
      name: 'Keeper',
      description: '',
      hooks: {
        'boards.remove': {
          guard: ({ input }) =>
            input.force ? undefined : { reject: 'Keeper keeps this Board', hint: 'pass --force', canForce: true },
        },
      },
    });
    const t = await pluginRoot({ keeper: true });
    expect(await run(['boards', 'delete', 'web', '--yes'], t.path, [keeper])).toBe(4);
    expect(jsonError()).toEqual({
      code: 'CONFLICT',
      message: 'Keeper keeps this Board',
      details: { plugin: 'keeper', operation: 'boards.remove', stage: 'guard', canForce: true },
    });
  });

  it("a replacement's core() error keeps its core code, without Plugin attribution", async () => {
    const replacer = definePlugin({
      id: 'replacer',
      name: 'Replacer',
      description: '',
      replaces: { 'stories.update': async ({ core }) => core() },
    });
    const t = await pluginRoot({ replacer: true });
    expect(await run(['stories', 'edit', 'WEB-9', '--name', 'X'], t.path, [replacer])).toBe(3);
    const err = jsonError();
    expect(err.code).toBe('NOT_FOUND');
    expect(err.details).not.toHaveProperty('plugin');
  });
});
