// The recoverable commit engine (ADR-0019 §2; RES-01/ARCH-41 engine, RES-04 engine part).
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ValidationError } from '../../src/core';
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

describe('prepareTransaction', () => {
  it('stages the new content without touching live files', async () => {
    const root = await fixtureRoot();
    const before = await snapshotTree(root);
    const tx = await prepareTransaction(
      root,
      {
        operation: 'stories.update',
        changes: [{ kind: 'write', path: 'boards/web/stories/WEB-1/story.json', text: 'x' }],
      },
      { now: clock.now },
    );
    expect(tx.id).toMatch(/^20261012T172107000Z-[0-9a-f]{8}$/);
    expect(await snapshotTree(root)).toEqual(before);
    expect(await readdir(join(root, '.txn', tx.id))).toEqual(['moving', 'staged', 'trash']);
    expect(tx.manifest.steps).toEqual([
      { kind: 'write', path: 'boards/web/stories/WEB-1/story.json', staged: 'staged/0', existed: true },
    ]);
    await tx.discard();
    expect(await journal(root)).toEqual([]);
  });

  it('orders steps: moves out, deletes, moves in, writes', async () => {
    const root = await fixtureRoot();
    const tx = await prepareTransaction(root, {
      operation: 'doctor.fix',
      changes: [
        { kind: 'write', path: join(root, 'boards/web/stories/WEB-1/story.json'), text: '{"key":"WEB-1"}\n' },
        { kind: 'move', from: 'boards/web/stories/WEB-1', to: 'boards/web/stories/WEB-2' },
        { kind: 'move', from: 'boards/web/stories/WEB-2', to: 'boards/web/stories/WEB-1' },
        { kind: 'delete', path: 'plugins/epics/epics.json', pruneTo: '' },
        { kind: 'delete', path: 'boards/ops' },
        { kind: 'delete', path: 'plugins/epics/missing.json' },
      ],
    });
    expect(tx.manifest.steps.map((s) => s.kind)).toEqual([
      'moveOut',
      'moveOut',
      'delete',
      'delete',
      'moveIn',
      'moveIn',
      'write',
    ]);
    expect(tx.manifest.steps[2]).toEqual({
      kind: 'delete',
      path: 'plugins/epics/epics.json',
      entry: 'file',
      trash: 'trash/0',
      pruneTo: '',
    });
    expect(tx.manifest.steps[3]).toMatchObject({ path: 'boards/ops', entry: 'folder' });
    await tx.discard();
  });

  it('names a file deleted in a moving folder inside the transaction', async () => {
    const root = await fixtureRoot();
    const tx = await prepareTransaction(root, {
      operation: 'doctor.fix',
      changes: [
        { kind: 'move', from: 'boards/web/stories/WEB-3', to: 'boards/web/stories/WEB-4' },
        {
          kind: 'delete',
          path: 'boards/web/stories/WEB-4/plugins/specs/spec.md',
          pruneTo: 'boards/web/stories/WEB-4',
        },
      ],
    });
    expect(tx.manifest.steps[1]).toEqual({
      kind: 'delete',
      path: 'moving/0/plugins/specs/spec.md',
      entry: 'file',
      trash: 'trash/0',
      pruneTo: 'moving/0',
    });
    await tx.discard();
  });

  const invalid: [string, TransactionPlan['changes'], typeof ConflictError | typeof ValidationError][] = [
    ['a path outside the Data Root', [{ kind: 'write', path: '../outside.txt', text: 'x' }], ValidationError],
    [
      'an absolute path outside the Data Root',
      [{ kind: 'write', path: '/etc/rowbly.txt', text: 'x' }],
      ValidationError,
    ],
    ['the journal folder', [{ kind: 'write', path: '.txn/x', text: 'x' }], ValidationError],
    [
      'one path written twice',
      [
        { kind: 'write', path: 'a.txt', text: 'x' },
        { kind: 'write', path: 'a.txt', text: 'y' },
      ],
      ConflictError,
    ],
    [
      'a path written and deleted',
      [
        { kind: 'write', path: 'plugins/epics/epics.json', text: 'x' },
        { kind: 'delete', path: 'plugins/epics/epics.json' },
      ],
      ConflictError,
    ],
    [
      'an occupied move destination',
      [{ kind: 'move', from: 'boards/web/stories/WEB-1', to: 'boards/web/stories/WEB-2' }],
      ConflictError,
    ],
    [
      'two moves to one destination',
      [
        { kind: 'move', from: 'boards/web/stories/WEB-1', to: 'boards/web/stories/WEB-9' },
        { kind: 'move', from: 'boards/web/stories/WEB-2', to: 'boards/web/stories/WEB-9' },
      ],
      ConflictError,
    ],
    [
      'a write that would revive a deleted Board',
      [
        { kind: 'delete', path: 'boards/ops' },
        { kind: 'write', path: 'boards/ops/stories/OPS-1/story.json', text: 'x' },
      ],
      ConflictError,
    ],
    [
      'a write into a folder that moves away',
      [
        { kind: 'move', from: 'boards/web/stories/WEB-3', to: 'boards/web/stories/WEB-4' },
        { kind: 'write', path: 'boards/web/stories/WEB-3/story.json', text: 'x' },
      ],
      ConflictError,
    ],
    [
      'a folder both moved and deleted',
      [
        { kind: 'move', from: 'boards/web/stories/WEB-3', to: 'boards/web/stories/WEB-4' },
        { kind: 'delete', path: 'boards/web/stories/WEB-3' },
      ],
      ConflictError,
    ],
  ];
  it.each(invalid)('rejects %s before writing anything', async (_name, changes, error) => {
    const root = await fixtureRoot();
    const before = await snapshotTree(root, []);
    await expect(prepareTransaction(root, { operation: 'test', changes })).rejects.toBeInstanceOf(error);
    expect(await snapshotTree(root, [])).toEqual(before);
  });

  it('accepts a destination that the same plan deletes first', async () => {
    const root = await fixtureRoot();
    const tx = await prepareTransaction(root, {
      operation: 'doctor.fix',
      changes: [
        { kind: 'delete', path: 'boards/web/stories/WEB-2' },
        { kind: 'move', from: 'boards/web/stories/WEB-3', to: 'boards/web/stories/WEB-2' },
        { kind: 'write', path: 'boards/web/stories/WEB-2/story.json', text: '{"key":"WEB-2"}\n' },
      ],
    });
    await tx.discard();
  });

  it('accepts a symlinked Data Root and records paths relative to it', async () => {
    const root = await fixtureRoot();
    const alias = join(root, '..', 'alias');
    await symlink(root, alias);
    const tx = await prepareTransaction(alias, {
      operation: 'test',
      changes: [{ kind: 'write', path: join(alias, 'plugins/epics/epics.json'), text: 'x' }],
    });
    expect(tx.manifest.steps[0]).toMatchObject({ path: 'plugins/epics/epics.json' });
    await tx.discard();
  });

  it('removes its staging and rethrows when staging fails', async () => {
    const root = await fixtureRoot();
    const before = await snapshotTree(root, []);
    const faults = injectFaults();
    faults.failOnce(5); // three mkdirs, the first staged file, then the second staged file.
    await expect(
      prepareTransaction(root, {
        operation: 'test',
        changes: [
          { kind: 'write', path: 'a.txt', text: 'a' },
          { kind: 'write', path: 'b.txt', text: 'b' },
        ],
      }),
    ).rejects.toThrow(/injected writeFile failure/);
    faults.restore();
    expect(await snapshotTree(root, [])).toEqual({ ...before, '.txn': '<dir>' });
  });
});

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

  it('cannot commit twice', async () => {
    const root = await fixtureRoot();
    const tx = await prepareTransaction(root, {
      operation: 'test',
      changes: [{ kind: 'write', path: 'a', text: 'a' }],
    });
    await tx.commit();
    await expect(tx.commit()).rejects.toThrow(/already/);
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

  it('reports a partial save with the pending paths when the retry fails too', async () => {
    const root = await fixtureRoot();
    const tx = await prepareTransaction(root, BIG_PLAN, { now: clock.now });
    const faults = injectFaults();
    // Write the manifest (writeFile, rename, syncDir), sync .txn, then the first moveOut fails for good.
    faults.crashAt(5);
    const err = await tx.commit().catch((e: unknown) => e);
    faults.restore();
    expect(err).toMatchObject({
      code: 'DATA_INTEGRITY',
      message: 'assignees.remove was saved only in part; Rowbly finishes it before the next read or change',
      details: { transaction: tx.id, operation: 'assignees.remove' },
    });
    expect((err as { details: { pending: string[] } }).details.pending).toContain('rowbly.config.json');
    expect((err as Error).message).not.toMatch(/nothing/i);
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

  it('survives a second crash during recovery', { timeout: 120_000 }, async () => {
    const newState = await expectedNewState();
    const probe = await fixtureRoot();
    const total = await countCalls(async () =>
      (await prepareTransaction(probe, BIG_PLAN, { now: clock.now })).commit(),
    );

    for (let n = 1; n <= total; n++) {
      const sample = await fixtureRoot();
      const oldState = await snapshotTree(sample);
      const { prepared } = await crashDuringCommit(sample, n);
      const recoveryCalls = await countCalls(() => recoverTransactions(sample));

      for (let m = 1; m <= recoveryCalls; m++) {
        const root = await fixtureRoot();
        await crashDuringCommit(root, n);
        const faults = injectFaults();
        faults.crashAt(m);
        await recoverTransactions(root).catch(() => undefined);
        faults.restore();

        await recoverTransactions(root);
        expect(await snapshotTree(root), `commit call ${n}, recovery call ${m}`).toEqual(
          prepared ? newState : oldState,
        );
        expect(await journal(root)).toEqual([]);
      }
    }
  });

  it('removes unprepared and complete folders and ignores names that are not transactions', async () => {
    const root = await fixtureRoot();
    const before = await snapshotTree(root);
    await mkdir(join(root, '.txn/20261012T172107000Z-00000001/staged'), { recursive: true });
    await mkdir(join(root, '.txn/20261012T172107000Z-00000002'), { recursive: true });
    await writeFile(
      join(root, '.txn/20261012T172107000Z-00000002/manifest.json'),
      JSON.stringify({
        version: 1,
        id: '20261012T172107000Z-00000002',
        operation: 'test',
        createdAt: FIXED_NOW,
        pid: 1,
        host: 'h',
        phase: 'complete',
        steps: [],
      }),
    );
    await writeFile(join(root, '.txn/notes.txt'), 'not a transaction\n');

    expect(await recoverTransactions(root)).toEqual({
      finished: [],
      removed: ['20261012T172107000Z-00000001', '20261012T172107000Z-00000002'],
      leftovers: [],
    });
    expect(await journal(root)).toEqual(['notes.txt']);
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('reports a transaction it cannot finish with its operation and pending paths', async () => {
    const root = await fixtureRoot();
    const id = '20261012T172107000Z-0000000a';
    await mkdir(join(root, '.txn', id, 'moving'), { recursive: true });
    await writeFile(
      join(root, '.txn', id, 'manifest.json'),
      JSON.stringify({
        version: 1,
        id,
        operation: 'doctor.fix',
        createdAt: FIXED_NOW,
        pid: 1,
        host: 'h',
        phase: 'prepared',
        steps: [{ kind: 'moveIn', temp: 'moving/0', to: 'boards/web/stories/WEB-9' }],
      }),
    );
    const err = await recoverTransactions(root).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'DATA_INTEGRITY',
      message: 'doctor.fix was saved only in part; Rowbly finishes it before the next read or change',
      details: { transaction: id, pending: ['boards/web/stories/WEB-9'] },
    });
    // Nothing was removed: the journal stays for the next attempt.
    expect(await journal(root)).toEqual([id]);
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

  it('does nothing when there is no journal', async () => {
    const root = await fixtureRoot();
    expect(await recoverTransactions(root)).toEqual({ finished: [], removed: [], leftovers: [] });
  });
});

describe('a killed process', () => {
  async function planFile(root: string): Promise<string> {
    const path = join(root, '..', 'plan.json');
    await writeFile(path, JSON.stringify(BIG_PLAN));
    return path;
  }

  const lastStep = 'applied:11'; // BIG_PLAN has 12 steps.
  it.each([
    ['staged', 'old'],
    ['prepared', 'new'],
    ['applied:0', 'new'],
    ['applied:4', 'new'],
    ['applied:9', 'new'],
    [lastStep, 'new'],
    ['complete', 'new'],
  ] as const)(
    'killed at %s recovers to the %s state when the root is reopened',
    { timeout: 60_000 },
    async (point, expected) => {
      const newState = await expectedNewState();
      const root = await fixtureRoot();
      const oldState = await snapshotTree(root);
      const killed = await runScript(fixtureScript('killAt.ts'), ['commit', root, await planFile(root), point]);
      expect(killed.signal, killed.stderr).toBe('SIGKILL');
      expect(await journal(root)).toHaveLength(1);

      await recoverTransactions(root);
      expect(await snapshotTree(root)).toEqual(expected === 'new' ? newState : oldState);
      expect(await journal(root)).toEqual([]);
    },
  );

  it('recovers after the recovery process is killed too', { timeout: 60_000 }, async () => {
    const newState = await expectedNewState();
    const root = await fixtureRoot();
    const plan = await planFile(root);
    expect((await runScript(fixtureScript('killAt.ts'), ['commit', root, plan, 'applied:2'])).signal).toBe('SIGKILL');
    expect((await runScript(fixtureScript('killAt.ts'), ['recover', root, plan, 'applied:7'])).signal).toBe('SIGKILL');

    await recoverTransactions(root);
    expect(await snapshotTree(root)).toEqual(newState);
    expect(await journal(root)).toEqual([]);
  });
});
