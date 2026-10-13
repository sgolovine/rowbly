import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { ConflictError, UsageError, ValidationError } from '../../src/core';
import { type DataRoot, DEFAULT_STAGES } from '../../src/schemas';
import { createServices, type InitOptions, type RowblyContext } from '../../src/services';
import { claimMe, initTarget, meSource } from '../../src/services/setup';
import { createRepositories } from '../../src/storage';
import { FIXED_NOW, fixedClock, fixedIds, makeWorkspace, type TempRoot, tempRoot } from '../helpers';

async function emptyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rowbly-init-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function contextFor(root: DataRoot, warnings: string[] = []): RowblyContext {
  return {
    root,
    local: { version: 1 },
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => warnings.push(message),
  };
}

async function init(opts: Omit<InitOptions, 'root'>) {
  const root: DataRoot = { path: join(await emptyDir(), '.rowbly'), kind: 'local' };
  return { root, result: await createServices(contextFor(root)).setup.init({ root, ...opts }) };
}

describe('setup.init', () => {
  it('writes the root config with the default stages and a .gitignore', async () => {
    const { root, result } = await init({});
    expect(result).toEqual({ root, workspace: null, board: null });
    expect(await createRepositories(root).rootConfig.get()).toEqual({ version: 1, stages: [...DEFAULT_STAGES] });
    expect(await readFile(join(root.path, '.gitignore'), 'utf8')).toBe('local.json\n');
  });

  it('creates the first Workspace and Board and makes them the current context', async () => {
    const { root, result } = await init({
      workspace: { id: 'acme', name: 'Acme' },
      board: { id: 'web', name: 'Web', keyPrefix: 'web' },
    });
    expect(result.workspace).toMatchObject({ id: 'acme', name: 'Acme', createdAt: FIXED_NOW });
    expect(result.board).toMatchObject({ id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    expect(await createRepositories(root).localState.get()).toEqual({ version: 1, workspace: 'acme', board: 'web' });
  });

  it('refuses an existing target with a ConflictError', async () => {
    const t = await tempRoot();
    await expect(createServices(contextFor(t.root)).setup.init({ root: t.root })).rejects.toThrow(ConflictError);
  });

  it('checks the first Workspace and Board before writing anything', async () => {
    const dir = await emptyDir();
    const root: DataRoot = { path: join(dir, '.rowbly'), kind: 'local' };
    const services = createServices(contextFor(root));
    await expect(services.setup.init({ root, workspace: { id: 'Bad Id', name: 'x' } })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      services.setup.init({
        root,
        workspace: { id: 'acme', name: 'Acme' },
        board: { id: 'web', name: 'Web', keyPrefix: '1' },
      }),
    ).rejects.toThrow(ValidationError);
    await expect(services.setup.init({ root, board: { id: 'web', name: 'Web', keyPrefix: 'WEB' } })).rejects.toThrow(
      UsageError,
    );
    await expect(access(root.path)).rejects.toThrow();
  });
});

describe('initTarget', () => {
  it('uses the explicit path, else ~/.rowbly with global, else <cwd>/.rowbly', () => {
    expect(initTarget({ cwd: '/work', home: '/home/me', global: false })).toEqual({
      path: '/work/.rowbly',
      kind: 'local',
    });
    expect(initTarget({ cwd: '/work', home: '/home/me', global: true })).toEqual({
      path: '/home/me/.rowbly',
      kind: 'global',
    });
    expect(initTarget({ cwd: '/work', home: '/home/me', global: true, explicit: 'data' })).toEqual({
      path: '/work/data',
      kind: 'local',
    });
  });
});

describe('claimMe', () => {
  async function withRoster(t: TempRoot) {
    await makeWorkspace(t.path, { id: 'acme', assignees: [{ handle: 'sam', name: 'Sam' }] });
  }

  it('stores a roster handle without warnings', async () => {
    const t = await tempRoot();
    await withRoster(t);
    const warnings: string[] = [];
    const ctx = contextFor(t.root, warnings);
    expect(await claimMe(ctx, 'sam')).toEqual({ version: 1, me: 'sam' });
    expect(ctx.me).toBe('sam');
    expect(meSource(ctx)).toBe('local');
    expect(warnings).toEqual([]);
  });

  it('warns rather than failing for a handle outside the roster, or with no Workspace', async () => {
    const t = await tempRoot();
    const warnings: string[] = [];
    await claimMe(contextFor(t.root, warnings), 'bob');
    await withRoster(t);
    await claimMe(contextFor(t.root, warnings), 'bob');
    expect(warnings).toEqual([
      'no current Workspace to check "bob" against',
      '"bob" is not in the roster of Workspace "acme"',
    ]);
    expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, me: 'bob' });
  });

  it('rejects a handle that is not a slug', async () => {
    const t = await tempRoot();
    await expect(claimMe(contextFor(t.root), 'Not A Slug')).rejects.toThrow(ValidationError);
  });
});

describe('meSource', () => {
  it('is git when Me did not come from Local State', async () => {
    const t = await tempRoot();
    expect(meSource({ ...contextFor(t.root), me: 'sam' })).toBe('git');
    expect(meSource(contextFor(t.root))).toBeNull();
  });
});
