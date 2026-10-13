import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';
import type { DataRoot } from '../../src/schemas';

export interface TempRoot {
  /** The temp directory containing `.rowbly/`; use it as cwd. */
  dir: string;
  /** Absolute path of the `.rowbly/` Data Root. */
  path: string;
  /** The Data Root as services see it. */
  root: DataRoot;
  cleanup(): Promise<void>;
}

/**
 * Creates `<tmp>/.rowbly/` with a minimal `rowbly.config.json`. Inside a test it is removed when the
 * test finishes; elsewhere call `cleanup()`.
 */
export async function tempRoot(): Promise<TempRoot> {
  const dir = await mkdtemp(join(tmpdir(), 'rowbly-test-'));
  const path = join(dir, '.rowbly');
  await mkdir(path);
  await writeFile(join(path, 'rowbly.config.json'), `${JSON.stringify({ version: 1 }, null, 2)}\n`);
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    onTestFinished(cleanup);
  } catch {
    // Not inside a running test (e.g. beforeAll): the caller cleans up.
  }
  return { dir, path, root: { path, kind: 'local' }, cleanup };
}
