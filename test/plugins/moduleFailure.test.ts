// Built-in Plugin modules are evaluated statically when the CLI starts, before any Plugin loads, so
// a module that throws at import cannot be skipped (RES-18A). These smoke tests build and start the
// real CLI with every Built-in Plugin on, so such a bug fails here instead of for users.
import { describe, expect, it } from 'vitest';
import { reservedNames } from '../../src/main';
import { builtInPlugins } from '../../src/plugins';
import { validatePluginDefinition } from '../../src/services';
import { runCli } from '../helpers';
import { pluginRoot } from './helpers';

const ids = builtInPlugins.map((d) => d.id);

describe('every Built-in Plugin (RES-18A)', () => {
  it('has a valid definition', () => {
    expect(ids).toEqual(['tasks', 'epics', 'specs', 'comments']);
    for (const definition of builtInPlugins) expect(validatePluginDefinition(definition, reservedNames())).toEqual([]);
  });

  it('starts with the built CLI, all on, without warnings', async () => {
    const t = await pluginRoot(Object.fromEntries(ids.map((id) => [id, true])));
    const cli = (args: string[]) => runCli(args, { root: t.path });

    const listed = await cli(['plugins', 'list', '--json']);
    expect(listed.stderr).toBe('');
    expect(JSON.parse(listed.stdout).map((p: { id: string; loaded: boolean }) => [p.id, p.loaded])).toEqual(
      ids.map((id) => [id, true]),
    );

    const help = await cli(['--help']);
    expect(help.exitCode).toBe(0);
    for (const id of ids) expect(help.stdout).toMatch(new RegExp(`\\n\\s+${id}\\b`));
    for (const id of ids) expect((await cli([id, '--help'])).exitCode).toBe(0);

    const create = await cli(['stories', 'create', '--help']);
    expect(create.stdout).toContain('--epic <id>');
    expect(create.stdout).toContain('--spec');

    const stories = await cli(['stories', 'list', '--json']);
    expect([stories.exitCode, stories.stderr]).toEqual([0, '']);
    expect((await cli(['doctor', '--json'])).exitCode).toBe(0);
    expect((await cli(['--version'])).exitCode).toBe(0);
  });
});
