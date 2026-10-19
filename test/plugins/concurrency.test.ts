// RES-02 (`r01-concurrent-create`) with real CLI processes: two Rowbly processes that change the same
// Data Root at once are serialized from their first read through the save, so neither loses the
// other's change. A barrier Plugin holds both processes after they planned (or while one waits for
// the lock), so an uncoordinated design fails deterministically, without sleeps.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeStory, type TempRoot } from '../helpers';
import { startScript } from '../storage/engineHelpers';
import { pluginRoot, readJsonFile, storyFile } from './helpers';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const BARRIER_CLI = fileURLToPath(new URL('./scripts/barrierCli.ts', import.meta.url));
const HOLD_LOCK = fileURLToPath(new URL('../storage/fixtures/holdLock.ts', import.meta.url));

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the barrier CLI (the real `main`) in its own Node process. */
function rowbly(t: TempRoot, args: string[], env: NodeJS.ProcessEnv = {}): Promise<Run> {
  const child = spawn(process.execPath, ['--import', 'tsx', BARRIER_CLI, ...args], {
    cwd: REPO,
    env: { PATH: process.env.PATH, HOME: t.path, NO_COLOR: '1', ROWBLY_ROOT: t.path, ...env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.end();
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Runs two commands at once, held together by the barrier. */
async function together(t: TempRoot, a: string[], b: string[]): Promise<[Run, Run]> {
  const dir = await mkdtemp(join(tmpdir(), 'rowbly-barrier-'));
  try {
    const runs = await Promise.all([
      rowbly(t, a, { BARRIER_DIR: dir, BARRIER_SELF: 'a', BARRIER_PEER: 'b' }),
      rowbly(t, b, { BARRIER_DIR: dir, BARRIER_SELF: 'b', BARRIER_PEER: 'a' }),
    ]);
    for (const run of runs) expect(run.code, run.stderr).toBe(0);
    return runs;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const json = (run: Run) => JSON.parse(run.stdout) as Record<string, unknown>;

describe('two CLI processes at once', () => {
  it('creating Stories get different keys and both Stories persist, 10 times in a row (r01)', async () => {
    for (let n = 0; n < 10; n++) {
      const t = await pluginRoot({ barrier: true });
      const [a, b] = await together(
        t,
        ['stories', 'create', '--board', 'web', '--name', 'From A', '--json'],
        ['stories', 'create', '--board', 'web', '--name', 'From B', '--json'],
      );
      const keys = [json(a).key, json(b).key].sort();
      expect(keys, `run ${n}`).toEqual(['WEB-1', 'WEB-2']);
      const names = await Promise.all(keys.map(async (key) => (await readJsonFile(t, storyFile(key as string))).name));
      expect(names.sort(), `run ${n}`).toEqual(['From A', 'From B']);
      await t.cleanup();
    }
  }, 180_000);

  it('updating different fields of one Story keeps both changes', async () => {
    const t = await pluginRoot({ barrier: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Old' });
    await together(
      t,
      ['stories', 'edit', 'WEB-1', '--name', 'New name', '--json'],
      ['stories', 'edit', 'WEB-1', '--priority', 'P1', '--json'],
    );
    expect(await readJsonFile(t, storyFile('WEB-1'))).toMatchObject({ name: 'New name', priority: 'P1' });
  }, 60_000);

  it('root config changes keep both changes', async () => {
    const t = await pluginRoot({ barrier: true });
    const add = (key: string) => ['stages', 'add', key, '--level', 'global', '--name', key];
    await together(t, add('review'), add('qa'));
    const keys = ((await readJsonFile(t, 'rowbly.config.json')).stages as { key: string }[]).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['review', 'qa']));
  }, 60_000);

  it('Plugin file edits keep both changes', async () => {
    const t = await pluginRoot({ barrier: true });
    await together(t, ['barrier', 'append', 'one'], ['barrier', 'append', 'two']);
    const lines = (await readFile(join(t.path, 'plugins/barrier/log.txt'), 'utf8')).trim().split('\n');
    expect(lines.sort()).toEqual(['one', 'two']);
  }, 60_000);
});

describe('a killed lock holder', () => {
  it('blocks the Data Root no longer than the stale-lock rule takes', async () => {
    const t = await pluginRoot();
    const holder = startScript(HOLD_LOCK, ['die', t.path]);
    await holder.printed('locked');
    expect((await holder.exited).signal).toBe('SIGKILL');
    const started = Date.now();
    const run = await rowbly(t, ['stories', 'create', '--board', 'web', '--name', 'After', '--json']);
    expect(run.code, run.stderr).toBe(0);
    expect(json(run).key).toBe('WEB-1');
    // A dead holder on this host is broken at once; far below the 10 s wait bound.
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 60_000);
});
