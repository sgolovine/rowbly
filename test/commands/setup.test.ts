import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, onTestFinished } from 'vitest';
import { makeBoard, makeWorkspace, runCli, tempRoot } from '../helpers';

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

const INIT_FLAGS = [
  '--no-prompt',
  '--workspace',
  'acme',
  '--workspace-name',
  'Acme',
  '--board',
  'web',
  '--board-name',
  'Web',
  '--prefix',
  'WEB',
];

describe('rowbly init', () => {
  it('creates the contracts §1 layout and the context; later commands need no flags', async () => {
    const dir = await emptyDir();
    const init = await runCli(['init', ...INIT_FLAGS], { cwd: dir });
    expect(init).toMatchObject({ exitCode: 0, stderr: '' });
    expect(init.stdout).toContain('Now using acme/web');

    const root = join(dir, '.rowbly');
    expect(await filesUnder(root)).toEqual([
      '.gitignore',
      'local.json',
      'rowbly.config.json',
      'workspaces/acme/boards/web/board.config.json',
      'workspaces/acme/workspace.config.json',
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
    // The check runs before any first-Workspace input is asked for: a missing --workspace-name
    // would otherwise exit 2 (or prompt in a terminal).
    const beforePrompt = await runCli(['init', '--workspace', 'acme'], { cwd: dir });
    expect(beforePrompt.exitCode).toBe(4);
    expect(beforePrompt.stderr).not.toContain('--workspace-name');
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

  it('non-interactive init exits 2 when a first Workspace or Board flag is missing', async () => {
    const dir = await emptyDir();
    const missing = await runCli(['init', '--workspace', 'acme'], { cwd: dir });
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain('missing required --workspace-name');
    const boardOnly = await runCli(['init', '--board', 'web'], { cwd: dir });
    expect(boardOnly.exitCode).toBe(2);
    expect(boardOnly.stderr).toContain('--board needs --workspace');
  });
});

describe('rowbly use', () => {
  it('writes local.json, which git ignores', async () => {
    const dir = await emptyDir();
    await git(dir, 'init', '-q');
    await runCli(['init', '--no-prompt'], { cwd: dir });
    const root = join(dir, '.rowbly');
    await makeWorkspace(root, { id: 'acme' });
    await makeWorkspace(root, { id: 'labs' });
    await makeBoard(root, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });

    const use = await runCli(['use', 'acme/web'], { cwd: dir });
    expect(use).toMatchObject({ exitCode: 0, stdout: 'Now using acme/web\n' });
    expect(JSON.parse(await readFile(join(root, 'local.json'), 'utf8'))).toEqual({
      version: 1,
      workspace: 'acme',
      board: 'web',
    });
    await expect(git(dir, 'check-ignore', '.rowbly/local.json')).resolves.toMatchObject({
      stdout: '.rowbly/local.json\n',
    });
  });

  it('shows the current context and where each part came from', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    await makeBoard(t.path, { id: 'api', workspaceId: 'acme', keyPrefix: 'API' });
    const cli = (args: string[], env = {}) => runCli(args, { root: t.path, env });

    const none = await cli(['use']);
    expect(none.stdout).toMatch(/Workspace\s+acme\s+\(the only one\)/);
    expect(none.stdout).toMatch(/Board\s+\(none\)/);

    await cli(['use', 'acme/api']);
    expect(JSON.parse((await cli(['use', '--json'])).stdout)).toEqual({
      workspace: { id: 'acme', source: 'local' },
      board: { id: 'api', source: 'local' },
    });
    expect(JSON.parse((await cli(['use', '--json'], { ROWBLY_BOARD: 'web' })).stdout).board).toEqual({
      id: 'web',
      source: 'env',
    });
    expect(JSON.parse((await cli(['use', '--json', '--board', 'web', '--workspace', 'acme'])).stdout)).toEqual({
      workspace: { id: 'acme', source: 'flag' },
      board: { id: 'web', source: 'flag' },
    });

    const cleared = await cli(['use', '--clear']);
    expect(cleared.exitCode).toBe(0);
    expect(JSON.parse(await readFile(join(t.path, 'local.json'), 'utf8'))).toEqual({ version: 1 });
  });

  it('exits 3 for an unknown Workspace or Board', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    expect((await runCli(['use', 'nope'], { root: t.path })).exitCode).toBe(3);
    expect((await runCli(['use', 'acme/nope'], { root: t.path })).exitCode).toBe(3);
    expect((await runCli(['use', 'acme/'], { root: t.path })).exitCode).toBe(2);
  });
});

describe('rowbly whoami', () => {
  it('resolves Me through a git email match when local.json has no me', async () => {
    const t = await tempRoot();
    await git(t.dir, 'init', '-q');
    await git(t.dir, 'config', 'user.email', 'Sam@Example.com');
    await makeWorkspace(t.path, {
      id: 'acme',
      assignees: [{ handle: 'sam', name: 'Sam', email: 'sam@example.com' }],
    });
    const whoami = await runCli(['whoami'], { cwd: t.dir });
    expect(whoami).toMatchObject({ exitCode: 0, stdout: 'sam  (matched by git email)\n' });
    expect(JSON.parse((await runCli(['whoami', '--json'], { cwd: t.dir })).stdout)).toEqual({
      me: 'sam',
      source: 'git',
    });
  });

  it('sets Me, warns for a handle outside the roster, and clears it', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme', assignees: [{ handle: 'sam', name: 'Sam' }] });
    const cli = (...args: string[]) => runCli(args, { root: t.path });

    expect(await cli('whoami')).toMatchObject({ stdout: expect.stringContaining('Me is not set') });
    expect(await cli('whoami', 'sam')).toMatchObject({ exitCode: 0, stdout: 'You are sam\n', stderr: '' });
    expect((await cli('whoami')).stdout).toBe('sam  (from local.json)\n');

    const outside = await cli('whoami', 'bob');
    expect(outside).toMatchObject({ exitCode: 0, stdout: 'You are bob\n' });
    expect(outside.stderr).toContain('warning: "bob" is not in the roster of Workspace "acme"');

    expect((await cli('whoami', '--clear')).exitCode).toBe(0);
    expect(JSON.parse(await readFile(join(t.path, 'local.json'), 'utf8'))).toEqual({ version: 1 });
  });
});

describe('rowbly config show', () => {
  it('prints the effective Stages and Custom Fields with their source levels', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, {
      id: 'acme',
      customFields: [{ key: 'size', name: 'Size', type: 'select', options: ['s', 'm'], required: true }],
    });
    await makeBoard(t.path, {
      id: 'web',
      workspaceId: 'acme',
      keyPrefix: 'WEB',
      stages: [{ key: 'open', name: 'Open', category: 'todo' }],
    });
    const human = await runCli(['config', 'show'], { root: t.path });
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('Stages (from board)');
    expect(human.stdout).toMatch(/open\s+Open\s+todo/);
    expect(human.stdout).toContain('Custom Fields (from workspace)');
    expect(human.stdout).toMatch(/size\s+Size\s+select\s+yes\s+s, m/);

    const json = JSON.parse(
      (await runCli(['config', 'show', '--json', '--board', 'acme/web'], { root: t.path })).stdout,
    );
    expect(json).toMatchObject({ stagesSource: 'board', customFieldsSource: 'workspace', board: { id: 'web' } });
  });
});
