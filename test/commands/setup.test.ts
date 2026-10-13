import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, onTestFinished } from 'vitest';
import { makeBoard, makeRootConfig, runCli, tempRoot } from '../helpers';

const git = (cwd: string, ...args: string[]) => promisify(execFile)('git', args, { cwd });

async function emptyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rowbly-init-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
}

const INIT_FLAGS = ['--no-prompt', '--board', 'web', '--board-name', 'Web', '--prefix', 'WEB'];

describe('rowbly init', () => {
  it('creates the contracts §1 layout and the context; later commands need no flags', async () => {
    const dir = await emptyDir();
    const init = await runCli(['init', ...INIT_FLAGS], { cwd: dir });
    expect(init).toMatchObject({ exitCode: 0, stderr: '' });
    expect(init.stdout).toContain('Created Board web (WEB)');
    expect(init.stdout).toContain('Now using web');

    const root = join(dir, '.rowbly');
    expect(await filesUnder(root)).toEqual([
      '.gitignore',
      'boards/web/board.config.json',
      'local.json',
      'rowbly.config.json',
    ]);
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('local.json\n');
    expect(JSON.parse(await readFile(join(root, 'rowbly.config.json'), 'utf8')).stages).toHaveLength(4);

    // Context resolves from local.json alone (`stories list` is WP05; these share its resolution).
    const show = await runCli(['config', 'show', '--json'], { cwd: dir });
    expect(show.exitCode).toBe(0);
    expect(JSON.parse(show.stdout)).toMatchObject({ board: { id: 'web' }, stagesSource: 'global' });
    expect((await runCli(['boards', 'show'], { cwd: dir })).exitCode).toBe(0);
  });

  it('exits 4 when the Data Root already exists', async () => {
    const dir = await emptyDir();
    expect((await runCli(['init', '--no-prompt'], { cwd: dir })).exitCode).toBe(0);
    const again = await runCli(['init', '--no-prompt'], { cwd: dir });
    expect(again.exitCode).toBe(4);
    expect(again.stderr).toContain('Data Root already exists');
    // The check runs before any first-Board input is asked for: a missing --board-name
    // would otherwise exit 2 (or prompt in a terminal).
    const beforePrompt = await runCli(['init', '--board', 'web'], { cwd: dir });
    expect(beforePrompt.exitCode).toBe(4);
    expect(beforePrompt.stderr).not.toContain('--board-name');
  });

  it('--global creates ~/.rowbly; --root creates the given path', async () => {
    const home = await emptyDir();
    const global = await runCli(['init', '--global', '--json'], { cwd: await emptyDir(), env: { HOME: home } });
    expect(global.exitCode).toBe(0);
    expect(JSON.parse(global.stdout).root).toEqual({ path: join(home, '.rowbly'), kind: 'global' });

    const dir = await emptyDir();
    const explicit = await runCli(['init', '--root', 'data'], { cwd: dir });
    expect(explicit.exitCode).toBe(0);
    expect(await filesUnder(join(dir, 'data'))).toEqual(['.gitignore', 'rowbly.config.json']);
  });

  it('non-interactive init exits 2 when a first Board flag is missing', async () => {
    const dir = await emptyDir();
    const missingName = await runCli(['init', '--board', 'web'], { cwd: dir });
    expect(missingName.exitCode).toBe(2);
    expect(missingName.stderr).toContain('missing required --board-name');
    const missingPrefix = await runCli(['init', '--board', 'web', '--board-name', 'Web'], { cwd: dir });
    expect(missingPrefix.exitCode).toBe(2);
    expect(missingPrefix.stderr).toContain('missing required --prefix');
  });
});

describe('rowbly use', () => {
  it('writes local.json, which git ignores', async () => {
    const dir = await emptyDir();
    await git(dir, 'init', '-q');
    await runCli(['init', '--no-prompt'], { cwd: dir });
    const root = join(dir, '.rowbly');
    await makeBoard(root, { id: 'web', keyPrefix: 'WEB' });

    const use = await runCli(['use', 'web'], { cwd: dir });
    expect(use).toMatchObject({ exitCode: 0, stdout: 'Now using web\n' });
    expect(JSON.parse(await readFile(join(root, 'local.json'), 'utf8'))).toEqual({ version: 1, board: 'web' });
    await expect(git(dir, 'check-ignore', '.rowbly/local.json')).resolves.toMatchObject({
      stdout: '.rowbly/local.json\n',
    });
  });

  it('shows the current Board and where it came from', async () => {
    const t = await tempRoot();
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    const cli = (args: string[], env = {}) => runCli(args, { root: t.path, env });

    expect((await cli(['use'])).stdout).toMatch(/Board\s+web\s+\(the only one\)/);
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    expect((await cli(['use'])).stdout).toMatch(/Board\s+\(none\)/);
    expect(JSON.parse((await cli(['use', '--json'])).stdout)).toEqual({ board: null });

    await cli(['use', 'api']);
    expect(JSON.parse((await cli(['use', '--json'])).stdout)).toEqual({ board: { id: 'api', source: 'local' } });
    expect(JSON.parse((await cli(['use', '--json'], { ROWBLY_BOARD: 'web' })).stdout)).toEqual({
      board: { id: 'web', source: 'env' },
    });
    expect(JSON.parse((await cli(['use', '--json', '--board', 'web'])).stdout)).toEqual({
      board: { id: 'web', source: 'flag' },
    });

    const cleared = await cli(['use', '--clear']);
    expect(cleared.exitCode).toBe(0);
    expect(JSON.parse(await readFile(join(t.path, 'local.json'), 'utf8'))).toEqual({ version: 1 });
  });

  it('exits 3 for an unknown Board and 2 for a Board with --clear', async () => {
    const t = await tempRoot();
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    expect((await runCli(['use', 'nope'], { root: t.path })).exitCode).toBe(3);
    expect((await runCli(['use', 'web', '--clear'], { root: t.path })).exitCode).toBe(2);
  });
});

describe('rowbly whoami', () => {
  it('resolves Me through a git email match when local.json has no me', async () => {
    const t = await tempRoot();
    await git(t.dir, 'init', '-q');
    await git(t.dir, 'config', 'user.email', 'Sam@Example.com');
    await makeRootConfig(t.path, { assignees: [{ handle: 'sam', name: 'Sam', email: 'sam@example.com' }] });
    const whoami = await runCli(['whoami'], { cwd: t.dir });
    expect(whoami).toMatchObject({ exitCode: 0, stdout: 'sam  (matched by git email)\n' });
    expect(JSON.parse((await runCli(['whoami', '--json'], { cwd: t.dir })).stdout)).toEqual({
      me: 'sam',
      source: 'git',
    });
  });

  it('sets Me, warns for a handle outside the roster, and clears it', async () => {
    const t = await tempRoot();
    await makeRootConfig(t.path, { assignees: [{ handle: 'sam', name: 'Sam' }] });
    const cli = (...args: string[]) => runCli(args, { root: t.path });

    expect(await cli('whoami')).toMatchObject({ stdout: expect.stringContaining('Me is not set') });
    expect(await cli('whoami', 'sam')).toMatchObject({ exitCode: 0, stdout: 'You are sam\n', stderr: '' });
    expect((await cli('whoami')).stdout).toBe('sam  (from local.json)\n');

    const outside = await cli('whoami', 'bob');
    expect(outside).toMatchObject({ exitCode: 0, stdout: 'You are bob\n' });
    expect(outside.stderr).toContain('warning: "bob" is not in the roster');

    expect((await cli('whoami', '--clear')).exitCode).toBe(0);
    expect(JSON.parse(await readFile(join(t.path, 'local.json'), 'utf8'))).toEqual({ version: 1 });
  });
});

describe('rowbly config show', () => {
  it('prints the effective Stages and Custom Fields with their source levels', async () => {
    const t = await tempRoot();
    await makeRootConfig(t.path, {
      customFields: [{ key: 'size', name: 'Size', type: 'select', options: ['s', 'm'], required: true }],
    });
    await makeBoard(t.path, {
      id: 'web',
      keyPrefix: 'WEB',
      stages: [{ key: 'open', name: 'Open', category: 'todo' }],
    });
    const human = await runCli(['config', 'show'], { root: t.path });
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('Stages (from board)');
    expect(human.stdout).toMatch(/open\s+Open\s+todo/);
    expect(human.stdout).toContain('Custom Fields (from global)');
    expect(human.stdout).toMatch(/size\s+Size\s+select\s+yes\s+s, m/);

    const json = JSON.parse((await runCli(['config', 'show', '--json', '--board', 'web'], { root: t.path })).stdout);
    expect(json).toMatchObject({ stagesSource: 'board', customFieldsSource: 'global', board: { id: 'web' } });
  });
});
