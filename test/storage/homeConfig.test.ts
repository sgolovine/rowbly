// The Home Config, `~/.rowblyrc.json` (ADR-0031): concurrent updates and unreadable files.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DataIntegrityError } from '../../src/core';
import { ensureHomeConfig, HOME_CONFIG_FILE, readHomeConfig, updateHomeConfig } from '../../src/storage';
import { tempRoot } from '../helpers';

describe('Home Config', () => {
  it('keeps every concurrent update and the keys Rowbly does not know', async () => {
    const home = (await tempRoot()).dir;
    const path = join(home, HOME_CONFIG_FILE);
    await writeFile(path, '{ "editor": "vim", "dataRoots": [{ "path": "/a", "note": "kept" }] }\n');
    expect(await ensureHomeConfig(home)).toBe(false);

    // Each change yields between its read and its write, so unlocked updates would lose entries.
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        updateHomeConfig(home, async (config) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { ...config, dataRoots: [...(config.dataRoots ?? []), { path: `/root-${i}` }] };
        }),
      ),
    );

    const saved = await readHomeConfig(home);
    expect(saved).toMatchObject({ version: 1, editor: 'vim' });
    expect(saved.dataRoots).toHaveLength(9);
    expect(saved.dataRoots?.[0]).toEqual({ path: '/a', note: 'kept' });
    expect((await readdir(home)).sort()).toEqual(['.rowbly', HOME_CONFIG_FILE]);
  });

  it('never replaces a Home Config it cannot read', async () => {
    const home = (await tempRoot()).dir;
    const path = join(home, HOME_CONFIG_FILE);
    await writeFile(path, '{ "me": "sam",');

    expect(await ensureHomeConfig(home)).toBe(false);
    await expect(updateHomeConfig(home, (config) => ({ ...config, me: 'kim' }))).rejects.toBeInstanceOf(
      DataIntegrityError,
    );
    expect(await readFile(path, 'utf8')).toBe('{ "me": "sam",');
  });
});
