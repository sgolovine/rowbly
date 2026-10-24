// The recoverable commit engine (ADR-0019 §2; RES-01/ARCH-41 engine, RES-04 engine part).
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareTransaction, recoverTransactions, type TransactionPlan } from '../../src/storage';
import { FIXED_NOW, fixedClock, tempRoot } from '../helpers';
import { fixtureScript, injectFaults, runScript, snapshotTree } from './engineHelpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const clock = fixedClock(FIXED_NOW);

/** The transaction folders left in `.txn/`. */
async function journal(root: string): Promise<string[]> {
  return readdir(join(root, '.txn')).catch(() => []);
}

/**
 * A Data Root with two Boards: `web` holds WEB-1…WEB-3, each with a Story file and a Spec file of
 * the `specs` Plugin, plus an unknown Plugin's file on WEB-3; `ops` is a Board to delete.
 */
async function fixtureRoot(): Promise<string> {
  const t = await tempRoot();
  const put = async (rel: string, text: string) => {
    await mkdir(join(t.path, rel, '..'), { recursive: true });
    await writeFile(join(t.path, rel), text);
  };
  await put('boards/web/board.config.json', '{"id":"web"}\n');
  for (const n of [1, 2, 3]) {
    await put(`boards/web/stories/WEB-${n}/story.json`, `{"key":"WEB-${n}","assignee":"bob"}\n`);
    await put(`boards/web/stories/WEB-${n}/plugins/specs/spec.md`, `spec of WEB-${n}\n`);
  }
  await put('boards/web/stories/WEB-3/plugins/unknown/data.bin', 'opaque\n');
  await put('boards/ops/board.config.json', '{"id":"ops"}\n');
  await put('boards/ops/stories/OPS-1/story.json', '{"key":"OPS-1"}\n');
  await put('plugins/epics/epics.json', '{"epics":["e1"]}\n');
  return t.path;
}

/**
 * One plan that uses every primitive: an Assignee removal across the root config and two Stories,
 * an Epic file deletion, a Story swap with a Spec written into and deleted from moved folders, and
 * a whole Board deletion that takes every Plugin's files with it.
 */
const BIG_PLAN: TransactionPlan = {
  operation: 'assignees.remove',
  changes: [
    { kind: 'write', path: 'rowbly.config.json', text: '{"version":1,"assignees":[]}\n' },
    { kind: 'write', path: 'boards/web/stories/WEB-1/story.json', text: '{"key":"WEB-1","from":"WEB-2"}\n' },
    { kind: 'write', path: 'boards/web/stories/WEB-2/story.json', text: '{"key":"WEB-2","from":"WEB-1"}\n' },
    { kind: 'write', path: 'boards/web/stories/WEB-3/story.json', text: '{"key":"WEB-3"}\n' },
    { kind: 'write', path: 'boards/web/stories/WEB-1/plugins/specs/new.md', text: 'new spec\n' },
    { kind: 'move', from: 'boards/web/stories/WEB-1', to: 'boards/web/stories/WEB-2' },
    { kind: 'move', from: 'boards/web/stories/WEB-2', to: 'boards/web/stories/WEB-1' },
    {
      kind: 'delete',
      path: 'boards/web/stories/WEB-2/plugins/specs/spec.md',
      pruneTo: 'boards/web/stories/WEB-2',
    },
    { kind: 'delete', path: 'plugins/epics/epics.json', pruneTo: '' },
    { kind: 'delete', path: 'boards/ops' },
  ],
};

async function expectedNewState(): Promise<Record<string, string>> {
  const root = await fixtureRoot();
  const tx = await prepareTransaction(root, BIG_PLAN, { now: clock.now });
  await tx.commit();
  return snapshotTree(root);
}

describe('Transaction.commit', () => {
  it('applies every change and removes its journal', async () => {
    const root = await fixtureRoot();
    const tx = await prepareTransaction(root, BIG_PLAN, { now: clock.now });
    expect(tx.manifest.steps).toHaveLength(12);
    expect(await tx.commit()).toEqual({ id: tx.id, leftover: false });

    const after = await snapshotTree(root);
    expect(after).toEqual(await expectedNewState());
    expect(after['rowbly.config.json']).toBe('{"version":1,"assignees":[]}\n');
    // The swap: WEB-1's old folder (and its Spec) is now WEB-2, minus the deleted Spec.
    expect(after['boards/web/stories/WEB-2/story.json']).toBe('{"key":"WEB-2","from":"WEB-1"}\n');
    expect(after['boards/web/stories/WEB-2/plugins']).toBeUndefined();
    expect(after['boards/web/stories/WEB-1/plugins/specs/spec.md']).toBe('spec of WEB-2\n');
    expect(after['boards/web/stories/WEB-1/plugins/specs/new.md']).toBe('new spec\n');
    // The unknown Plugin's file is untouched; the deleted Board takes every Plugin's files.
    expect(after['boards/web/stories/WEB-3/plugins/unknown/data.bin']).toBe('opaque\n');
    expect(Object.keys(after).filter((p) => p.startsWith('boards/ops'))).toEqual([]);
    expect(after.plugins).toBeUndefined();
    expect(await journal(root)).toEqual([]);
  });

  it('ends in the complete old or the complete new state when any single step fails once', async () => {
    const newState = await expectedNewState();
    const probe = await fixtureRoot();
    const counting = injectFaults();
    await (await prepareTransaction(probe, BIG_PLAN, { now: clock.now })).commit();
    const total = counting.calls;
    counting.restore();

    for (let n = 1; n <= total; n++) {
      const root = await fixtureRoot();
      const oldState = await snapshotTree(root);
      const faults = injectFaults();
      faults.failOnce(n);
      const outcome = await prepareTransaction(root, BIG_PLAN, { now: clock.now })
        .then((tx) => tx.commit())
        .catch((err: unknown) => err);
      faults.restore();
      const state = await snapshotTree(root);
      if (outcome instanceof Error) {
        // Failed before the commit point: nothing live changed and the staging is gone.
        expect(state, `call ${n}: ${faults.log[n - 1]}: ${outcome.message}`).toEqual(oldState);
        expect(outcome.message).not.toMatch(/saved only in part/);
        expect(await journal(root)).toEqual([]);
      } else {
        // After the commit point the step is retried, so the operation completes.
        expect(state, `call ${n}: ${faults.log[n - 1]}`).toEqual(newState);
      }
    }
  });
});

/** Runs BIG_PLAN with every mutating call from the `n`-th on failing, like a process that died there. */
async function crashDuringCommit(root: string, n: number): Promise<{ outcome: unknown; prepared: boolean }> {
  const faults = injectFaults();
  faults.crashAt(n);
  let passed = false;
  const outcome = await prepareTransaction(root, BIG_PLAN, {
    now: clock.now,
    onCheckpoint: (point) => {
      if (point === 'prepared') passed = true;
    },
  })
    .then((tx) => tx.commit())
    .catch((err: unknown) => err);
  faults.restore();
  // Prepared means the manifest landed (the commit point), even if the crash came before the checkpoint.
  const [id] = await journal(root);
  const prepared = passed || (id !== undefined && (await readdir(join(root, '.txn', id))).includes('manifest.json'));
  return { outcome, prepared };
}

/** How many mutating calls a clean run of `fn` makes. */
async function countCalls(fn: () => Promise<unknown>): Promise<number> {
  const counting = injectFaults();
  await fn();
  counting.restore();
  return counting.calls;
}

describe('recoverTransactions', () => {
  it('recovers the complete old or new state after a crash at any step, and again is a no-op', async () => {
    const newState = await expectedNewState();
    const probe = await fixtureRoot();
    const total = await countCalls(async () =>
      (await prepareTransaction(probe, BIG_PLAN, { now: clock.now })).commit(),
    );

    for (let n = 1; n <= total; n++) {
      const root = await fixtureRoot();
      const oldState = await snapshotTree(root);
      const { outcome, prepared } = await crashDuringCommit(root, n);
      // Before the commit point the error is the original one; after it, a partial save, unless
      // only the cleanup failed, which still succeeds and leaves the folder to recovery.
      if (!prepared) expect(outcome, `call ${n}`).not.toMatchObject({ code: 'DATA_INTEGRITY' });
      else if (outcome instanceof Error) expect(outcome, `call ${n}`).toMatchObject({ code: 'DATA_INTEGRITY' });
      else expect(outcome, `call ${n}`).toMatchObject({ leftover: true });

      await recoverTransactions(root);
      const recovered = await snapshotTree(root);
      expect(recovered, `call ${n}`).toEqual(prepared ? newState : oldState);
      expect(await journal(root)).toEqual([]);

      expect(await recoverTransactions(root)).toEqual({ finished: [], removed: [], leftovers: [] });
      expect(await snapshotTree(root)).toEqual(recovered);
    }
  });

  it('refuses to guess when a manifest cannot be read', async () => {
    const root = await fixtureRoot();
    const id = '20261012T172107000Z-0000000b';
    await mkdir(join(root, '.txn', id), { recursive: true });
    await writeFile(join(root, '.txn', id, 'manifest.json'), '{"version": 1, "phase": "prep');
    await expect(recoverTransactions(root)).rejects.toMatchObject({
      code: 'DATA_INTEGRITY',
      details: { transaction: id },
    });
    expect(await journal(root)).toEqual([id]);
  });
});

describe('a killed process', () => {
  async function planFile(root: string): Promise<string> {
    const path = join(root, '..', 'plan.json');
    await writeFile(path, JSON.stringify(BIG_PLAN));
    return path;
  }

  it('killed after the commit point recovers to the new state when the root is reopened', {
    timeout: 60_000,
  }, async () => {
    const newState = await expectedNewState();
    const root = await fixtureRoot();
    const killed = await runScript(fixtureScript('killAt.ts'), ['commit', root, await planFile(root), 'prepared']);
    expect(killed.signal, killed.stderr).toBe('SIGKILL');
    expect(await journal(root)).toHaveLength(1);

    await recoverTransactions(root);
    expect(await snapshotTree(root)).toEqual(newState);
    expect(await journal(root)).toEqual([]);
  });
});

describe('Git local publication', () => {
  it('rolls forward after faults at every filesystem boundary, preserving binary data, mode, staged blobs and unrelated working bytes', async () => {
    const { syncFixture } = await import('./fixtures/syncFixture');
    const { withGitWorker } = await import('../../src/storage/gitRepository');
    const { publishPublication, recoverPublication, readIndex, readPublicationFile, withPublication } = await import(
      '../../src/storage/gitSyncJournal'
    );
    const { coordinated } = await import('../../src/services/coordination');
    const { rm } = await import('node:fs/promises');
    const run = async (failAt?: number, crash = false) => {
      const t = await tempRoot(),
        f = await syncFixture(t.dir, t.path);
      let count = 0,
        intended = false;
      await withGitWorker(f.repo, () =>
        withPublication(f.repo, async (hold) => {
          const faults = injectFaults();
          if (failAt !== undefined) {
            if (crash) faults.crashAt(failAt);
            else faults.failOnce(failAt);
          }
          try {
            await publishPublication(hold, f.plan);
          } catch {
            /* Recover as a reopened process would. */
          } finally {
            count = faults.calls;
            faults.restore();
          }
          intended =
            (await readFile(f.repo.journal, 'utf8').then(
              () => true,
              () => false,
            )) || (await f.git('rev-parse', 'HEAD')) === f.plan.candidate;
          // Persistent injected I/O emulates death; remove only this test process's abandoned root lock.
          const lock = join(t.path, '.lock');
          const owner = await readFile(lock, 'utf8').then(
            (s) => JSON.parse(s),
            () => undefined,
          );
          if (owner) {
            expect(owner.pid).toBe(process.pid);
            await rm(lock);
          }
          await recoverPublication(hold);
          expect(await readIndex(f.repo), `index at fault ${failAt}`).toBe(
            intended ? f.plan.indexAfter : f.plan.indexBefore,
          );
          expect(await f.git('rev-parse', 'HEAD')).toBe(intended ? f.plan.candidate : f.plan.old);
          for (const edit of f.plan.edits)
            expect(await readPublicationFile(f.repo, edit.path)).toEqual(intended ? edit.after : edit.before);
          expect(await f.git('rev-parse', ':staged.txt')).toBe(f.stagedOid);
          expect(await readFile(join(t.dir, 'staged.txt'), 'utf8')).toBe('unstaged bytes over staged blob\n');
          expect(await readFile(join(t.dir, 'untracked.txt'), 'utf8')).toBe('untracked bytes\n');
          await recoverPublication(hold);
        }),
      );
      await coordinated(t.root, 'verify recovered publication', async () => undefined);
      expect(await readdir(join(t.path, '.txn')).catch(() => [])).toEqual([]);
      expect(await readFile(f.repo.journal, 'utf8').catch(() => null)).toBeNull();
      await t.cleanup();
      return count;
    };
    const count = await run();
    for (let n = 1; n <= count; n++) {
      await run(n);
      await run(n, true);
    }
    const t = await tempRoot(),
      f = await syncFixture(t.dir, t.path);
    await withGitWorker(f.repo, () =>
      withPublication(f.repo, async (hold) => {
        await expect(publishPublication(hold, { ...f.plan, indexBefore: 'drift' })).rejects.toThrow('index changed');
        expect(await readIndex(f.repo)).toBe(f.plan.indexBefore);
        await writeFile(join(t.dir, 'code.txt'), 'external edit');
        await expect(publishPublication(hold, f.plan)).rejects.toThrow('captured snapshot');
        expect(await readFile(join(t.dir, 'code.txt'), 'utf8')).toBe('external edit');
        await writeFile(join(t.dir, 'code.txt'), 'old code\n');
        const external = await f.git(
          'commit-tree',
          await f.git('rev-parse', 'HEAD^{tree}'),
          '-p',
          f.plan.old,
          '-m',
          'external ref advance',
        );
        await expect(
          publishPublication(hold, f.plan, {
            checkpoint: async (point) => {
              if (point === 'before-intent') await f.git('update-ref', f.plan.branch, external, f.plan.old);
            },
          }),
        ).rejects.toThrow('safely discarded');
        expect(await f.git('rev-parse', 'HEAD')).toBe(external);
        expect(await readIndex(f.repo)).toBe(f.plan.indexBefore);
        for (const edit of f.plan.edits) expect(await readPublicationFile(f.repo, edit.path)).toEqual(edit.before);
      }),
    );
  });

  it('recovers a real SIGKILL after ref effect before its phase write through an ordinary read while synchronization is Off', async () => {
    const { syncFixture } = await import('./fixtures/syncFixture');
    const { coordinated } = await import('../../src/services/coordination');
    const { readPublicationFile } = await import('../../src/storage/gitSyncJournal');
    for (const target of ['index-token-ready', 'index-reserved', 'ref-effect']) {
      const t = await tempRoot(),
        f = await syncFixture(t.dir, t.path);
      await writeFile(
        join(t.path, 'local.json'),
        JSON.stringify({ version: 1, plugins: { git: { synchronization: { enabled: false, intervalSeconds: 300 } } } }),
      );
      const peer = join(t.dir, 'peer');
      await f.git('worktree', 'add', '--detach', peer, f.plan.old);
      const plan = join(t.dir, 'publication-plan.json');
      await writeFile(plan, JSON.stringify(f.plan));
      const killed = await runScript(fixtureScript('killSyncAt.ts'), [t.path, plan, target]);
      expect(killed.signal, killed.stderr).toBe('SIGKILL');
      expect(await f.git('rev-parse', 'HEAD')).toBe(target === 'ref-effect' ? f.plan.candidate : f.plan.old);
      expect(await readPublicationFile(f.repo, f.plan.edits[0]!.path)).toEqual(f.plan.edits[0]!.before);
      // A different linked worktree shares the publication gate and recovers the recorded owner.
      await coordinated(
        { path: join(peer, '.rowbly'), kind: 'local' },
        'peer read with sync Off',
        async () => undefined,
      );
      await coordinated(t.root, 'open with synchronization Off', async () => {
        for (const edit of f.plan.edits)
          expect(await readPublicationFile(f.repo, edit.path)).toEqual(
            target === 'ref-effect' ? edit.after : edit.before,
          );
      });
      expect(await f.git('rev-parse', ':staged.txt')).toBe(f.stagedOid);
      expect(await f.git('remote')).toBe('');
      expect(await readFile(f.repo.journal, 'utf8').catch(() => null)).toBeNull();
      expect((await readdir(join(f.repo.gitDir, 'rowbly'))).filter((name) => name.startsWith('index-token-'))).toEqual(
        [],
      );
    }
  });
});
