// The Data Root lock (ADR-0019 §1, D1/W2).
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireLock, LOCK_BREAK_FILE, LOCK_FILE, pathExists } from '../../src/storage';
import { tempRoot } from '../helpers';
import { fixtureScript, runScript, startScript } from './engineHelpers';

const HOLDER = fixtureScript('holdLock.ts');
afterEach(() => {
  vi.restoreAllMocks();
});

describe('acquireLock', () => {
  describe('stale locks', () => {
    it('breaks a lock whose holder process on this host is gone', async () => {
      const t = await tempRoot();
      const exited = startScript(HOLDER, ['die', t.path]);
      await exited.printed('locked');
      const { signal } = await exited.exited;
      expect(signal).toBe('SIGKILL');
      expect(await pathExists(join(t.path, LOCK_FILE))).toBe(true);

      const started = Date.now();
      const lock = await acquireLock(t.path, { timeoutMs: 2_000 });
      expect(Date.now() - started).toBeLessThan(2_000);
      await lock.release();
      expect(await pathExists(join(t.path, LOCK_BREAK_FILE))).toBe(false);
    });
  });

  describe('between processes', () => {
    it('never lets two processes hold it at once', { timeout: 60_000 }, async () => {
      const t = await tempRoot();
      const log = join(t.dir, 'turns.log');
      await writeFile(log, '');
      const [a, b] = await Promise.all([
        runScript(HOLDER, ['turns', t.path, log, 'a', '10']),
        runScript(HOLDER, ['turns', t.path, log, 'b', '10']),
      ]);
      expect(a.code, a.stderr).toBe(0);
      expect(b.code, b.stderr).toBe(0);
      const lines = (await readFile(log, 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(40);
      for (let i = 0; i < lines.length; i += 2) {
        const who = lines[i]?.slice(3);
        expect([lines[i], lines[i + 1]]).toEqual([`in ${who}`, `out ${who}`]);
      }
    });
  });
});
