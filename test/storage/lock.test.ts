// The Data Root lock (ADR-0019 §1, D1/W2).
import { readFile, realpath, symlink, utimes, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../src/core';
import { acquireLock, LOCK_BREAK_FILE, LOCK_FILE, pathExists, withLock } from '../../src/storage';
import { io } from '../../src/storage/io';
import { tempRoot } from '../helpers';
import { fixtureScript, runScript, startScript } from './engineHelpers';

const HOLDER = fixtureScript('holdLock.ts');
afterEach(() => {
  vi.restoreAllMocks();
});

const ELEVEN_MINUTES_AGO = () => new Date(Date.now() - 11 * 60_000);

async function writeLock(root: string, holder: Record<string, unknown>, name = LOCK_FILE): Promise<string> {
  const path = join(root, name);
  await writeFile(path, `${JSON.stringify(holder)}\n`);
  return path;
}

describe('acquireLock', () => {
  it('writes its holder into the lock file and removes it on release', async () => {
    const t = await tempRoot();
    const lock = await acquireLock(t.path, { operation: 'stories.create' });
    const holder = JSON.parse(await readFile(join(t.path, LOCK_FILE), 'utf8'));
    expect(holder).toMatchObject({
      pid: process.pid,
      host: hostname(),
      operation: 'stories.create',
      token: lock.token,
    });
    expect(Date.parse(holder.startedAt)).not.toBeNaN();

    expect(await lock.release()).toBe(true);
    expect(lock.released).toBe(true);
    expect(await pathExists(join(t.path, LOCK_FILE))).toBe(false);
    expect(await lock.release()).toBe(true);
  });

  it('serializes holders in one process in arrival order', async () => {
    const t = await tempRoot();
    const order: string[] = [];
    const first = await acquireLock(t.path);
    const second = acquireLock(t.path).then((lock) => {
      order.push('second');
      return lock;
    });
    const third = acquireLock(t.path).then((lock) => {
      order.push('third');
      return lock;
    });
    order.push('first releases');
    await first.release();
    await (await second).release();
    await (await third).release();
    expect(order).toEqual(['first releases', 'second', 'third']);
  });

  it('hands the lock to an in-process waiter on release, without polling the lock file', async () => {
    const t = await tempRoot();
    const first = await acquireLock(t.path);
    const link = vi.spyOn(io, 'link');
    const resolved = vi.spyOn(io, 'realpath');
    const second = acquireLock(t.path);
    // Let the waiter get as far as it can while the lock is held.
    await resolved.mock.results[0]?.value;
    for (let i = 0; i < 5; i++) await new Promise(setImmediate);
    expect(link).not.toHaveBeenCalled();
    await first.release();
    await (await second).release();
    // One exclusive create, never an EEXIST retry with backoff.
    expect(link).toHaveBeenCalledTimes(1);
  });

  it("keeps call order when an earlier caller's realpath resolves later", async () => {
    const t = await tempRoot();
    const canonical = await realpath(t.path);
    const first = await acquireLock(t.path);
    // The second caller's realpath is slow, as on a loaded machine; the third's is instant. The
    // second must still queue first, or it waits on the third, which this test releases after it.
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let calls = 0;
    vi.spyOn(io, 'realpath').mockImplementation(async () => {
      calls += 1;
      if (calls === 1) await gate;
      return canonical;
    });
    const order: string[] = [];
    const second = acquireLock(t.path, { timeoutMs: 2_000 }).then((lock) => {
      order.push('second');
      return lock;
    });
    const third = acquireLock(t.path, { timeoutMs: 2_000 }).then((lock) => {
      order.push('third');
      return lock;
    });
    // Let the third caller's instant realpath settle before the second's.
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    openGate();

    await first.release();
    await (await second).release();
    await (await third).release();
    expect(calls).toBe(2);
    expect(order).toEqual(['second', 'third']);
  });

  it("queues later callers when an earlier caller's realpath fails", async () => {
    const t = await tempRoot();
    await expect(acquireLock(join(t.dir, 'missing'), { timeoutMs: 100 })).rejects.toMatchObject({ code: 'ENOENT' });
    await (await acquireLock(t.path, { timeoutMs: 1_000 })).release();
  });

  it('times out with a CONFLICT naming the holder, and later waiters still get it', async () => {
    const t = await tempRoot();
    const held = await acquireLock(t.path);
    const err = await acquireLock(t.path, { timeoutMs: 50 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({
      exitCode: 4,
      details: { lock: join(t.path, LOCK_FILE), pid: process.pid, host: hostname() },
      hint: `try again; if no Rowbly process is running, delete ${join(t.path, LOCK_FILE)}`,
    });
    expect((err as Error).message).toMatch(
      /^Data Root is busy: another Rowbly process \(pid \d+ on .+, since .+\) is saving$/,
    );

    const next = acquireLock(t.path, { timeoutMs: 5_000 });
    await held.release();
    await (await next).release();
  });

  it('shares one lock between aliases of the Data Root', async () => {
    const t = await tempRoot();
    const alias = join(t.dir, 'alias');
    await symlink(t.path, alias);
    const held = await acquireLock(alias);
    expect(held.root).toBe(await realpath(t.path));
    await expect(acquireLock(join(t.path, '..', '.rowbly'), { timeoutMs: 50 })).rejects.toBeInstanceOf(ConflictError);
    await held.release();
  });

  it('releases on every path through withLock', async () => {
    const t = await tempRoot();
    await expect(
      withLock(t.path, {}, async () => {
        throw new Error('body failed');
      }),
    ).rejects.toThrow('body failed');
    expect(await pathExists(join(t.path, LOCK_FILE))).toBe(false);
    expect(await withLock(t.path, {}, async () => 'ok')).toBe('ok');
  });

  it('releases through await using', async () => {
    const t = await tempRoot();
    {
      await using lock = await acquireLock(t.path);
      expect(lock.owning).toBe(true);
      expect(await pathExists(join(t.path, LOCK_FILE))).toBe(true);
    }
    expect(await pathExists(join(t.path, LOCK_FILE))).toBe(false);
  });

  it('reuses a held handle explicitly, without releasing it', async () => {
    const t = await tempRoot();
    const held = await acquireLock(t.path);
    const inner = await acquireLock(t.path, { held, timeoutMs: 50 });
    expect(inner).toMatchObject({ owning: false, token: held.token });
    await inner.release();
    expect(held.released).toBe(false);
    expect(await pathExists(join(t.path, LOCK_FILE))).toBe(true);
    await held.release();
    await expect(acquireLock(t.path, { held })).rejects.toThrow(/released/);
  });

  it('does not remove a lock that is no longer its own', async () => {
    const t = await tempRoot();
    const lock = await acquireLock(t.path);
    await writeLock(t.path, { pid: 1, host: 'other', startedAt: new Date().toISOString(), token: 'theirs' });
    expect(await lock.release()).toBe(false);
    expect(JSON.parse(await readFile(join(t.path, LOCK_FILE), 'utf8')).token).toBe('theirs');
  });

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

    it('breaks a lock older than ten minutes, even from another host', async () => {
      const t = await tempRoot();
      await writeLock(t.path, {
        pid: 1,
        host: 'elsewhere',
        startedAt: ELEVEN_MINUTES_AGO().toISOString(),
        token: 'old',
      });
      await (await acquireLock(t.path, { timeoutMs: 1_000 })).release();
    });

    it('waits for a fresh lock from another host', async () => {
      const t = await tempRoot();
      await writeLock(t.path, { pid: 1, host: 'elsewhere', startedAt: new Date().toISOString(), token: 'fresh' });
      await expect(acquireLock(t.path, { timeoutMs: 100 })).rejects.toMatchObject({
        details: { pid: 1, host: 'elsewhere' },
      });
    });

    it('judges an unreadable lock by its mtime', async () => {
      const t = await tempRoot();
      const path = join(t.path, LOCK_FILE);
      await writeFile(path, '{"pid": 12');
      await expect(acquireLock(t.path, { timeoutMs: 100 })).rejects.toThrow(/holder unknown/);
      await utimes(path, ELEVEN_MINUTES_AGO(), ELEVEN_MINUTES_AGO());
      await (await acquireLock(t.path, { timeoutMs: 1_000 })).release();
    });

    it('leaves a stale lock alone while another waiter is breaking it, until that break is stale', async () => {
      const t = await tempRoot();
      await writeLock(t.path, {
        pid: 1,
        host: 'elsewhere',
        startedAt: ELEVEN_MINUTES_AGO().toISOString(),
        token: 'old',
      });
      const breaking = await writeLock(t.path, { pid: 1, host: 'elsewhere' }, LOCK_BREAK_FILE);
      await expect(acquireLock(t.path, { timeoutMs: 100 })).rejects.toBeInstanceOf(ConflictError);

      const old = new Date(Date.now() - 31_000);
      await utimes(breaking, old, old);
      await (await acquireLock(t.path, { timeoutMs: 1_000 })).release();
      expect(await pathExists(breaking)).toBe(false);
    });
  });

  describe('between processes', () => {
    it('blocks while another process holds it and succeeds once it releases', { timeout: 30_000 }, async () => {
      const t = await tempRoot();
      const holder = startScript(HOLDER, ['hold', t.path]);
      await holder.printed('locked');
      await expect(acquireLock(t.path, { timeoutMs: 200 })).rejects.toMatchObject({
        details: { pid: holder.child.pid },
      });
      // Through an alias too.
      const alias = join(t.dir, 'alias');
      await symlink(t.path, alias);
      await expect(acquireLock(alias, { timeoutMs: 100 })).rejects.toBeInstanceOf(ConflictError);

      const waiting = acquireLock(t.path, { timeoutMs: 10_000 });
      holder.child.stdin.end();
      await holder.printed('released');
      await (await waiting).release();
      expect((await holder.exited).code).toBe(0);
    });

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
