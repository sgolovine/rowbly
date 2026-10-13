import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { DataRootNotFoundError } from '../../src/core';
import { findDataRoot } from '../../src/storage';
import { tempRoot } from '../helpers';

async function emptyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rowbly-discovery-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('findDataRoot', () => {
  it('--root wins over the env var and walking up', async () => {
    const walked = await tempRoot();
    const flagged = await tempRoot();
    const env = await tempRoot();
    const root = await findDataRoot({
      cwd: walked.dir,
      flag: flagged.path,
      env: { ROWBLY_ROOT: env.path },
      home: await emptyDir(),
    });
    expect(root).toEqual({ path: flagged.path, kind: 'local' });
  });

  it('resolves a relative --root against cwd', async () => {
    const t = await tempRoot();
    const root = await findDataRoot({ cwd: t.dir, flag: '.rowbly', env: {}, home: await emptyDir() });
    expect(root.path).toBe(t.path);
  });

  it('ROWBLY_ROOT wins over walking up', async () => {
    const walked = await tempRoot();
    const env = await tempRoot();
    const root = await findDataRoot({ cwd: walked.dir, env: { ROWBLY_ROOT: env.path }, home: await emptyDir() });
    expect(root).toEqual({ path: env.path, kind: 'local' });
  });

  it('an explicit root that does not exist is DataRootNotFoundError', async () => {
    const dir = await emptyDir();
    await expect(findDataRoot({ cwd: dir, flag: join(dir, 'missing'), env: {}, home: dir })).rejects.toThrow(
      DataRootNotFoundError,
    );
  });

  it('a nested cwd finds an ancestor .rowbly', async () => {
    const t = await tempRoot();
    const nested = join(t.dir, 'a', 'b', 'c');
    await mkdir(nested, { recursive: true });
    const root = await findDataRoot({ cwd: nested, env: {}, home: await emptyDir() });
    expect(root).toEqual({ path: t.path, kind: 'local' });
  });

  it('falls back to ~/.rowbly only when it exists', async () => {
    const cwd = await emptyDir();
    const home = await emptyDir();
    await expect(findDataRoot({ cwd, env: {}, home })).rejects.toThrow(DataRootNotFoundError);

    await mkdir(join(home, '.rowbly'));
    const root = await findDataRoot({ cwd, env: {}, home });
    expect(root).toEqual({ path: join(home, '.rowbly'), kind: 'global' });
  });

  it('prefers a local .rowbly over the global one', async () => {
    const t = await tempRoot();
    const home = await emptyDir();
    await mkdir(join(home, '.rowbly'));
    const root = await findDataRoot({ cwd: t.dir, env: {}, home });
    expect(root).toEqual({ path: t.path, kind: 'local' });
  });

  it('with nothing found, the result is DataRootNotFoundError with an init hint', async () => {
    const dir = await emptyDir();
    const err = await findDataRoot({ cwd: dir, env: {}, home: dir }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataRootNotFoundError);
    expect((err as DataRootNotFoundError).exitCode).toBe(5);
    expect((err as DataRootNotFoundError).hint).toMatch(/rowbly init/);
  });
});
