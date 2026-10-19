// Command mode with the fixture Plugins as the registry, through the built fixture CLI.
import { mkdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { makeStory, type RunCliOptions, runCli, type TempRoot, tempRoot } from '../helpers';
import { FIXTURE_CLI_PATH, pluginRoot, readJsonFile, storyFile } from './helpers';

const cli = (t: TempRoot, args: string[], opts: RunCliOptions = {}) =>
  runCli(args, { root: t.path, cli: FIXTURE_CLI_PATH, ...opts });

const json = (text: string) => JSON.parse(text);

describe('rowbly plugins', () => {
  it('list, show, enable and disable; disable deletes no data', async () => {
    const t = await pluginRoot({ notes: { marker: 'm' } });
    const list = await cli(t, ['plugins', 'list', '--json']);
    expect(list.exitCode).toBe(0);
    expect(json(list.stdout).slice(0, 2)).toEqual([
      {
        id: 'notes',
        name: 'Notes',
        description: 'Short notes on Stories, for testing the Plugin API',
        enabled: true,
        loaded: true,
        known: true,
      },
      { id: 'stamp', name: 'Stamp', description: 'Stamps new Stories', enabled: false, loaded: false, known: true },
    ]);
    const human = await cli(t, ['plugins', 'list']);
    expect(human.stdout).toMatch(/notes\s+on\s+Notes/);
    expect(human.stdout).toMatch(/stamp\s+off\s+Stamp/);

    expect((await cli(t, ['plugins', 'show', 'notes'])).stdout).toContain('marker: "m"');
    await cli(t, ['stories', 'create', '--name', 'A', '--note', 'keep me']);
    const off = await cli(t, ['plugins', 'disable', 'notes']);
    expect(off.stdout).toBe('Turned off Plugin notes; its data is kept\n');
    expect((await readJsonFile(t, 'rowbly.config.json')).plugins).toEqual({ notes: { enabled: false, marker: 'm' } });
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({ notes: { note: 'keep me' } });
    // Its commands are gone while it is off.
    const gone = await cli(t, ['notes', 'list']);
    expect(gone.exitCode).toBe(2);
    expect(gone.stderr).toContain('Plugin "notes" is off; run `rowbly plugins enable notes`');

    const on = await cli(t, ['plugins', 'enable', 'notes', '--json']);
    expect(json(on.stdout)).toEqual({ id: 'notes', enabled: true });
    expect((await cli(t, ['plugins', 'enable', 'nope'])).exitCode).toBe(3);
  });

  it('rowbly init turns no Plugins on', async () => {
    const t = await tempRoot();
    const dir = `${t.dir}/fresh`;
    await mkdir(dir);
    expect((await runCli(['init'], { cli: FIXTURE_CLI_PATH, cwd: dir })).exitCode).toBe(0);
    const config = json(await readFile(`${dir}/.rowbly/rowbly.config.json`, 'utf8'));
    expect(config).not.toHaveProperty('plugins');
  });
});

describe('a Plugin that fails to load', () => {
  it('is skipped with one warning per run, in human and --json mode', async () => {
    const t = await pluginRoot({ notes: true, boom: true, strict: { level: 'x' }, clash: true });
    const run = await cli(t, ['stories', 'create', '--name', 'A', '--note', 'n']);
    expect(run.exitCode).toBe(0);
    const warnings = run.stderr.trim().split('\n');
    expect(warnings).toEqual([
      'warning: Plugin "boom" failed to load (boom at start); Rowbly runs without it and keeps its data. Turn it off with `rowbly plugins disable boom`',
      'warning: Plugin "strict" failed to load (invalid settings: level: Invalid input: expected number, received string); Rowbly runs without it and keeps its data. Turn it off with `rowbly plugins disable strict`',
      'warning: Plugin "clash" failed to load (--name is already an option of "rowbly stories create"); Rowbly runs without it and keeps its data. Turn it off with `rowbly plugins disable clash`',
      'warning: notes saw WEB-1 created',
    ]);
    const quiet = await cli(t, ['stories', 'list', '--json']);
    expect(
      quiet.stderr
        .trim()
        .split('\n')
        .map((line) => Object.keys(json(line))),
    ).toEqual([['warning'], ['warning'], ['warning']]);
  });

  it('doctor reports it as PLUGIN_FAILED and exits 6', async () => {
    const t = await pluginRoot({ boom: true });
    const doctor = await cli(t, ['doctor', '--json']);
    expect(doctor.exitCode).toBe(6);
    expect(json(doctor.stdout).findings).toMatchObject([{ code: 'PLUGIN_FAILED', details: { plugin: 'boom' } }]);
  });
});

describe('the pipeline in command mode', () => {
  it('Plugin options fill Plugin input; --json prints the bags; show has the rows; list filters', async () => {
    const t = await pluginRoot({ notes: { marker: '✎' }, tracer: true });
    const created = await cli(t, ['stories', 'create', '--name', 'A', '--note', 'hello', '--json']);
    expect(json(created.stdout).plugins).toEqual({ notes: { note: 'hello' } });
    await cli(t, ['stories', 'create', '--name', 'B']);
    const show = await cli(t, ['stories', 'show', 'WEB-1']);
    expect(show.stdout).toMatch(/Note:\s+✎: hello/);
    expect(show.stdout).toMatch(/Number:\s+1/);
    const noted = await cli(t, ['stories', 'list', '--noted', '--json']);
    expect(json(noted.stdout).map((s: { key: string }) => s.key)).toEqual(['WEB-1']);

    const edited = await cli(t, ['stories', 'edit', 'WEB-1', '--no-note', '--json']);
    expect(edited.exitCode).toBe(0);
    expect(json(edited.stdout)).not.toHaveProperty('plugins');
    expect((await cli(t, ['stories', 'edit', 'WEB-2', '--note', 'later'])).exitCode).toBe(0);
    expect((await readJsonFile(t, storyFile('WEB-2'))).plugins).toEqual({ notes: { note: 'later' } });
  });

  it('a guard rejection exits 4; --json errors carry the Plugin, operation and stage', async () => {
    const t = await pluginRoot({ notes: { blocked: ['Nope'] }, tracer: true });
    const run = await cli(t, ['stories', 'create', '--name', 'Nope', '--json']);
    expect(run.exitCode).toBe(4);
    expect(json(run.stderr.trim().split('\n').at(-1) ?? '')).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Notes refuses a Story named "Nope"',
        details: { plugin: 'notes', operation: 'stories.create', stage: 'guard' },
        hint: 'pick another name',
      },
    });
    const board = await cli(t, ['boards', 'delete', 'web', '--yes']);
    expect(board.exitCode).toBe(4);
    expect(board.stderr).toContain('Board "web" has tracer files');
  });

  it('a throwing transform exits 1 and saves nothing; a throwing reaction only warns', async () => {
    const t = await pluginRoot({ faulty: true });
    const run = await cli(t, ['boards', 'edit', 'web', '--name', 'X', '--json']);
    expect(run.exitCode).toBe(1);
    expect(json(run.stderr.trim())).toEqual({
      error: {
        code: 'INTERNAL',
        message: 'Plugin "faulty" failed in the transform of boards.update: kaboom',
        details: { plugin: 'faulty', operation: 'boards.update', stage: 'transform' },
        hint: 'turn it off with `rowbly plugins disable faulty`',
      },
    });
    expect((await readJsonFile(t, 'boards/web/board.config.json')).name).toBe('Website');
    const human = await cli(t, ['boards', 'edit', 'web', '--name', 'X']);
    expect(human.stderr).toContain('hint: turn it off with `rowbly plugins disable faulty`');

    const t2 = await pluginRoot({ echo: true });
    const echoed = await cli(t2, ['boards', 'edit', 'web', '--name', 'X']);
    expect(echoed.exitCode).toBe(0);
    expect(echoed.stderr).toBe('warning: Plugin "echo" failed to react to boards.update: echo failed\n');
    expect((await readJsonFile(t2, 'boards/web/board.config.json')).name).toBe('X');
  });

  it('a replacement runs instead of core', async () => {
    const t = await pluginRoot({ stamp: true });
    const run = await cli(t, ['stories', 'create', '--name', 'Test', '--json']);
    expect(json(run.stdout).name).toBe('[stamped] Test');
  });
});

describe("a Plugin's own commands", () => {
  it('live under `rowbly <id>` and write its files through operations', async () => {
    const t = await pluginRoot({ notes: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    expect((await cli(t, ['notes', 'add', 'todo', 'milk'])).stdout).toBe('Added note todo\n');
    expect((await cli(t, ['notes', 'attach', 'web-1', 'story note'])).exitCode).toBe(0);
    expect(json((await cli(t, ['notes', 'list', '--json'])).stdout)).toEqual(['todo.txt']);
    const help = await cli(t, ['--help']);
    expect(help.stdout).toMatch(/notes\s+Short notes on Stories/);
    const settings = await cli(t, ['notes', 'settings', '--json']);
    expect(json(settings.stdout)).toEqual({ marker: 'note', blocked: [] });
    expect((await cli(t, ['notes', 'nope'])).exitCode).toBe(2);
  });
});
