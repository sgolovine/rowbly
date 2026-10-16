// RES-21 / SEC-02: Plugin file paths never follow a symbolic link inside a Plugin scope (ADR-0019
// §10). These are the storage checks; WP02A routes Change Set file access through them.
import { mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/core';
import {
  canonicalDataRoot,
  listPluginFiles,
  readPluginFile,
  resolvePluginFile,
  writeTextFile,
} from '../../src/storage';
import { tempRoot } from '../helpers';

const LINK_RE = /^Plugin "paths" (file .+|folder) is reached through a symbolic link, which Rowbly does not follow$/;

/** A Data Root plus a sibling `outside/` folder holding `secret.txt`, the sentinel. */
async function rootWithOutside(): Promise<{ root: string; dir: string; outside: string; secret: string }> {
  const t = await tempRoot();
  const outside = join(t.dir, 'outside');
  await mkdir(outside);
  const secret = join(outside, 'secret.txt');
  await writeFile(secret, 'secret\n');
  return { root: t.path, dir: t.dir, outside, secret };
}

/** Each way a Plugin touches a file, as the Change Set will do it through the policy. */
const access = {
  read: (folder: string, name: string) => readPluginFile(folder, 'paths', name),
  write: async (folder: string, name: string) =>
    writeTextFile(await resolvePluginFile(folder, 'paths', name), 'overwritten'),
  delete: async (folder: string, name: string) => rm(await resolvePluginFile(folder, 'paths', name), { force: true }),
  list: (folder: string) => listPluginFiles(folder, 'paths'),
};

describe.skipIf(process.platform === 'win32')('Plugin file paths', () => {
  it.each(['read', 'write', 'delete', 'list'] as const)('reject a linked Plugin folder for %s', async (how) => {
    const { root, outside, secret } = await rootWithOutside();
    await mkdir(join(root, 'plugins'));
    await symlink(outside, join(root, 'plugins', 'paths'));

    const err = await access[how](root, 'secret.txt').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(LINK_RE);
    expect(await readFile(secret, 'utf8')).toBe('secret\n');
  });

  it.each(['read', 'write', 'delete'] as const)('reject a linked plugins/ folder for %s', async (how) => {
    const { root, outside } = await rootWithOutside();
    await mkdir(join(outside, 'paths'));
    await writeFile(join(outside, 'paths', 'secret.txt'), 'secret\n');
    await symlink(outside, join(root, 'plugins'));

    await expect(access[how](root, 'secret.txt')).rejects.toThrow(LINK_RE);
    expect(await readFile(join(outside, 'paths', 'secret.txt'), 'utf8')).toBe('secret\n');
  });

  it.each(['read', 'write', 'delete'] as const)('reject a linked nested folder for %s', async (how) => {
    const { root, outside, secret } = await rootWithOutside();
    await mkdir(join(root, 'plugins', 'paths'), { recursive: true });
    await symlink(outside, join(root, 'plugins', 'paths', 'sub'));

    const err = await access[how](root, 'sub/secret.txt').catch((e: unknown) => e);
    expect(err).toMatchObject({
      message: 'Plugin "paths" file sub/secret.txt is reached through a symbolic link, which Rowbly does not follow',
      details: { plugin: 'paths', name: 'sub/secret.txt', link: join(root, 'plugins', 'paths', 'sub') },
    });
    expect(await readFile(secret, 'utf8')).toBe('secret\n');
  });

  it.each(['read', 'write', 'delete'] as const)('reject a linked file for %s', async (how) => {
    const { root, secret } = await rootWithOutside();
    await mkdir(join(root, 'plugins', 'paths'), { recursive: true });
    await symlink(secret, join(root, 'plugins', 'paths', 'notes.md'));

    await expect(access[how](root, 'notes.md')).rejects.toThrow(LINK_RE);
    expect(await readFile(secret, 'utf8')).toBe('secret\n');
  });

  it('lists neither linked entries nor what lies behind them', async () => {
    const { root, outside, secret } = await rootWithOutside();
    const scope = join(root, 'plugins', 'paths');
    await mkdir(join(scope, 'a', 'b'), { recursive: true });
    await writeFile(join(scope, 'top.md'), 'top\n');
    await writeFile(join(scope, 'a', 'b', 'deep.md'), 'deep\n');
    await symlink(outside, join(scope, 'a', 'out'));
    await symlink(secret, join(scope, 'linked.md'));

    expect(await listPluginFiles(root, 'paths')).toEqual(['a/b/deep.md', 'top.md']);
    expect(await listPluginFiles(root, 'missing')).toEqual([]);
  });

  it('allows normal nested names, new files and missing folders', async () => {
    const { root } = await rootWithOutside();
    expect(await readPluginFile(root, 'paths', 'a/b/c.md')).toBeNull();
    const path = await resolvePluginFile(root, 'paths', 'a/b/c.md');
    expect(path).toBe(join(root, 'plugins', 'paths', 'a', 'b', 'c.md'));
    await writeTextFile(path, 'nested\n');
    expect(await readPluginFile(root, 'paths', 'a/b/c.md')).toBe('nested\n');
    expect(await listPluginFiles(root, 'paths')).toEqual(['a/b/c.md']);
  });

  it('allows a symlinked Data Root and a linked record folder', async () => {
    const { root, dir } = await rootWithOutside();
    const alias = join(dir, 'alias');
    await symlink(root, alias);
    expect(await canonicalDataRoot(alias)).toBe(await realpath(root));
    await writeTextFile(await resolvePluginFile(alias, 'paths', 'x.md'), 'via alias\n');
    expect(await readPluginFile(root, 'paths', 'x.md')).toBe('via alias\n');

    // A Story folder that is itself a link: record folders are not checked (rename semantics).
    const real = join(dir, 'story-elsewhere');
    await mkdir(real);
    await mkdir(join(root, 'boards', 'web', 'stories'), { recursive: true });
    await symlink(real, join(root, 'boards', 'web', 'stories', 'WEB-1'));
    const folder = join(root, 'boards', 'web', 'stories', 'WEB-1');
    await writeTextFile(await resolvePluginFile(folder, 'paths', 'y.md'), 'in story\n');
    expect(await readPluginFile(folder, 'paths', 'y.md')).toBe('in story\n');
  });

  it.each(['../secret.txt', '/etc/passwd', 'a//b', './a', 'a/..', 'a\\b'])('rejects the name %j', async (name) => {
    const { root } = await rootWithOutside();
    await expect(resolvePluginFile(root, 'paths', name)).rejects.toThrow(/invalid Plugin file name/);
  });

  it('rejects a Plugin id that is not a slug', async () => {
    const { root } = await rootWithOutside();
    await expect(resolvePluginFile(root, '../paths', 'x.md')).rejects.toThrow(/invalid Plugin id/);
  });
});
