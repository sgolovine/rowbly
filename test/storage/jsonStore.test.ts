import { mkdir, readdir, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DataIntegrityError, DataRootNotFoundError, UsageError } from '../../src/core';
import { BoardConfigSchema, RowblyConfigSchema } from '../../src/schemas';
import { createSkill, deleteSkill, installSkill, updateSkill } from '../../src/services/skills';
import {
  ensureHomeConfig,
  findDataRoot,
  HOME_CONFIG_FILE,
  readHomeConfig,
  readJson,
  recordOpenedDataRoot,
  registerDataRoot,
  updateHomeConfig,
  writeJson,
} from '../../src/storage';
import { io } from '../../src/storage/io';
import { FIXED_NOW, tempRoot } from '../helpers';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const board = {
  version: 1 as const,
  id: 'web',
  name: 'Web',
  description: '',
  keyPrefix: 'WEB',
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

describe('writeJson', () => {
  it('writes keys in schema order, 2-space indent and a trailing newline', async () => {
    const t = await tempRoot();
    const path = join(t.path, 'nested', 'dir', 'board.json');
    // Deliberately scrambled key order; unknown keys are dropped.
    const scrambled = {
      extra: true,
      ...Object.fromEntries(Object.entries(board).reverse()),
    } as unknown as typeof board;
    await writeJson(path, BoardConfigSchema, scrambled);
    const text = await readFile(path, 'utf8');
    expect(text).toBe(
      `{\n  "version": 1,\n  "id": "web",\n  "name": "Web",\n  "description": "",\n  "keyPrefix": "WEB",\n` +
        `  "createdAt": "${FIXED_NOW}",\n  "updatedAt": "${FIXED_NOW}"\n}\n`,
    );
    const rootPath = join(t.path, 'rowbly.config.json');
    await writeJson(rootPath, RowblyConfigSchema, {
      plugins: { future: { enabled: false, data: { kept: true } } },
      featureFlags: { unknown: false },
      version: 1,
    });
    expect(await readFile(rootPath, 'utf8')).toBe(
      `${JSON.stringify({ version: 1, featureFlags: { unknown: false }, plugins: { future: { enabled: false, data: { kept: true } } } }, null, 2)}\n`,
    );
  });

  it('is atomic: a failing rename leaves the old file intact and no temp files behind', async () => {
    const t = await tempRoot();
    const path = join(t.path, 'board.json');
    await writeJson(path, BoardConfigSchema, board);
    const before = await readFile(path, 'utf8');

    vi.mocked(rename).mockRejectedValueOnce(new Error('disk full'));
    await expect(writeJson(path, BoardConfigSchema, { ...board, name: 'Changed' })).rejects.toThrow('disk full');

    expect(await readFile(path, 'utf8')).toBe(before);
    expect((await readdir(t.path)).sort()).toEqual(['board.json', 'rowbly.config.json']);
  });
});

describe('readJson', () => {
  it('a file with git conflict markers is DataIntegrityError with conflict: true', async () => {
    const t = await tempRoot();
    const path = join(t.path, 'board.json');
    await writeFile(path, '{\n<<<<<<< HEAD\n  "name": "Ours"\n=======\n  "name": "Theirs"\n>>>>>>> feature\n}\n');
    const err = (await readJson(path, BoardConfigSchema).catch((e: unknown) => e)) as DataIntegrityError;
    expect(err).toBeInstanceOf(DataIntegrityError);
    expect(err.details).toEqual({ path, conflict: true });
  });
});

// ADR-0031: the Home Config, `~/.rowblyrc.json`.
describe('updateHomeConfig', () => {
  it('keeps every concurrent update and unknown keys, and never replaces a file it cannot read', async () => {
    const home = (await tempRoot()).dir;
    const path = join(home, HOME_CONFIG_FILE);
    await writeFile(path, '{ "editor": "vim", "dataRoots": [{ "path": "/a", "note": "kept" }] }\n');
    expect(await ensureHomeConfig(home)).toBe(false);

    // The first update holds the lock until `release`. The second must reach the lock (its realpath
    // call) without its change running; with no lock its change would run first.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let queued!: () => void;
    const secondQueued = new Promise<void>((resolve) => {
      queued = resolve;
    });
    const realpath = io.realpath;
    let calls = 0;
    const spy = vi.spyOn(io, 'realpath').mockImplementation(async (target) => {
      const resolved = await realpath(target);
      if (++calls === 2) queued();
      return resolved;
    });
    const entered: string[] = [];
    const ran: Record<string, () => void> = {};
    const running = (name: string) =>
      new Promise<void>((resolve) => {
        ran[name] = resolve;
      });
    const firstRan = running('first');
    const secondRan = running('second');
    const add = (name: string, wait?: Promise<void>) =>
      updateHomeConfig(home, async (config) => {
        entered.push(name);
        ran[name]?.();
        await wait;
        return { ...config, dataRoots: [...(config.dataRoots ?? []), { path: `/${name}` }] };
      });
    try {
      const first = add('first', held);
      await firstRan;
      const second = add('second');
      await Promise.race([secondQueued, secondRan]);
      expect(entered).toEqual(['first']);
      release();
      await Promise.all([first, second]);
    } finally {
      release();
      spy.mockRestore();
    }
    const saved = await readHomeConfig(home);
    expect(saved).toMatchObject({ version: 1, editor: 'vim' });
    expect(saved.dataRoots?.map((root) => root.path)).toEqual(['/a', '/first', '/second']);
    expect(saved.dataRoots?.[0]).toEqual({ path: '/a', note: 'kept' });
    expect((await readdir(home)).sort()).toEqual(['.rowbly', HOME_CONFIG_FILE]);

    await writeFile(path, '{ "me": "sam",');
    await expect(updateHomeConfig(home, (config) => ({ ...config, me: 'kim' }))).rejects.toBeInstanceOf(
      DataIntegrityError,
    );
    expect(await readFile(path, 'utf8')).toBe('{ "me": "sam",');
  });
});

// ADR-0033: the Data Root a run opens, and the known Data Roots it records.
describe('findDataRoot and the known Data Roots', () => {
  it('opens --data-root, then the one default, then the nearest .rowbly/; recording never repairs the file', async () => {
    const home = (await tempRoot()).dir;
    const rc = join(home, HOME_CONFIG_FILE);
    const project = await tempRoot();
    const other = await tempRoot();
    const otherPath = await realpath(other.path);
    const find = (flag?: string, env: NodeJS.ProcessEnv = {}) => findDataRoot({ cwd: project.dir, flag, env, home });
    expect((await find()).path).toBe(project.path);

    const alias = join(other.dir, 'alias');
    await symlink(other.path, alias);
    await writeFile(rc, JSON.stringify({ dataRoots: [{ path: alias, label: 'Other', default: true, note: 'kept' }] }));
    expect(await find()).toEqual({ path: otherPath, kind: 'local' });
    expect((await find(project.path)).path).toBe(project.path);

    // A known folder, under any alias, is left as stored; a folder that is not a Data Root is not recorded.
    const before = await readFile(rc, 'utf8');
    await recordOpenedDataRoot(home, { path: otherPath, kind: 'local' });
    await recordOpenedDataRoot(home, { path: project.dir, kind: 'local' });
    expect(await readFile(rc, 'utf8')).toBe(before);
    await recordOpenedDataRoot(home, project.root);
    expect((await readHomeConfig(home)).dataRoots?.map((root) => root.path)).toEqual([
      alias,
      await realpath(project.path),
    ]);

    // Two entries marked default fail, even for one folder, unless --data-root names the Data Root.
    const config = await readHomeConfig(home);
    await writeFile(
      rc,
      JSON.stringify({ ...config, dataRoots: [...(config.dataRoots ?? []), { path: otherPath, default: true }] }),
    );
    await expect(find()).rejects.toBeInstanceOf(UsageError);
    expect((await find(project.path)).path).toBe(project.path);
    await recordOpenedDataRoot(home, other.root);
    expect((await readHomeConfig(home)).dataRoots).toHaveLength(3);

    // Choosing the default merges the folder's entries without losing a label or an unknown key.
    await registerDataRoot(home, other.path, { default: true });
    expect((await readHomeConfig(home)).dataRoots).toEqual([
      { label: 'Other', path: alias, default: true, note: 'kept' },
      { path: await realpath(project.path) },
    ]);

    // A named Data Root that is missing fails rather than fall back; ROWBLY_ROOT is refused.
    await writeFile(rc, JSON.stringify({ dataRoots: [{ path: join(home, 'gone'), default: true }] }));
    const missing = await find().catch((err: unknown) => err);
    expect(missing).toBeInstanceOf(DataRootNotFoundError);
    expect((missing as DataRootNotFoundError).details.path).toBe(join(home, 'gone'));
    await expect(find(project.path, { ROWBLY_ROOT: project.path })).rejects.toBeInstanceOf(UsageError);
  });
});

describe('managed skill files', () => {
  it('preserves custom instructions, restores failed replacements, and refuses paths or links outside managed skills', async () => {
    const t = await tempRoot();
    const outside = await tempRoot();
    const custom = await createSkill({ cwd: t.dir, name: 'my-work', harness: 'codex' });
    const customDir = join(t.dir, custom.path);
    await writeFile(join(customDir, 'SKILL.md'), 'my instructions');
    await writeFile(join(customDir, 'notes.txt'), 'keep me');
    await writeFile(join(customDir, 'references/rowbly-reference.md'), 'old reference');
    await updateSkill({ cwd: t.dir, path: custom.path });
    expect(await readFile(join(customDir, 'SKILL.md'), 'utf8')).toBe('my instructions');
    expect(await readFile(join(customDir, 'notes.txt'), 'utf8')).toBe('keep me');
    expect(await readFile(join(customDir, 'references/rowbly-reference.md'), 'utf8')).not.toBe('old reference');

    const official = await installSkill({ cwd: t.dir, source: 'rowbly', harness: 'claude' });
    const officialDir = join(t.dir, official.path);
    await writeFile(join(officialDir, 'SKILL.md'), 'old bundled copy');
    const { rename: renameReal } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const fail = vi.spyOn(io, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith('.tmp') && to === officialDir) throw new Error('publication failed');
      return renameReal(from, to);
    });
    try {
      await expect(updateSkill({ cwd: t.dir, path: official.path })).rejects.toThrow('publication failed');
      expect(await readFile(join(officialDir, 'SKILL.md'), 'utf8')).toBe('old bundled copy');
    } finally {
      fail.mockRestore();
    }
    await updateSkill({ cwd: t.dir, path: official.path });
    expect(await readFile(join(officialDir, 'SKILL.md'), 'utf8')).toContain('name: rowbly');

    await mkdir(join(t.dir, '.agents/skills/unrelated'));
    await writeFile(join(t.dir, '.agents/skills/unrelated/SKILL.md'), 'unrelated');
    await expect(deleteSkill({ cwd: t.dir, path: '.agents/skills/unrelated' })).rejects.toThrow('select an installed');
    await expect(deleteSkill({ cwd: t.dir, path: '../outside' })).rejects.toThrow('select an installed');
    await expect(deleteSkill({ cwd: t.dir, path: join(t.dir, custom.path) })).rejects.toThrow('select an installed');
    await symlink(customDir, join(t.dir, '.agents/skills/linked'));
    await expect(deleteSkill({ cwd: t.dir, path: '.agents/skills/linked' })).rejects.toThrow('symbolic link');
    await rename(join(customDir, 'references'), join(customDir, 'saved-references'));
    await symlink(join(customDir, 'saved-references'), join(customDir, 'references'));
    await expect(updateSkill({ cwd: t.dir, path: custom.path })).rejects.toThrow('symbolic link');
    await expect(deleteSkill({ cwd: t.dir, path: custom.path })).rejects.toThrow('symbolic link');
    await rename(join(t.dir, '.claude'), join(outside.dir, 'claude'));
    await symlink(join(outside.dir, 'claude'), join(t.dir, '.claude'));
    await expect(deleteSkill({ cwd: t.dir, path: official.path })).rejects.toThrow('symbolic link');
    expect(await readFile(join(outside.dir, 'claude/skills/rowbly/SKILL.md'), 'utf8')).toContain('name: rowbly');
    // Deletion must unlink nested links rather than following them to unrelated content.
    const removable = await createSkill({ cwd: t.dir, name: 'remove-me', harness: 'pi' });
    await symlink(customDir, join(t.dir, removable.path, 'outside'));
    await deleteSkill({ cwd: t.dir, path: removable.path });
    expect(await readFile(join(customDir, 'notes.txt'), 'utf8')).toBe('keep me');
    expect(await readFile(join(t.dir, '.agents/skills/unrelated/SKILL.md'), 'utf8')).toBe('unrelated');
  });
});
