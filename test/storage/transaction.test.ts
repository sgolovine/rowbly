// The recoverable commit engine (ADR-0019 §2; RES-01/ARCH-41 engine, RES-04 engine part).
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ValidationError } from '../../src/core';
import { prepareTransaction, type TransactionPlan } from '../../src/storage';
import { FIXED_NOW, fixedClock, tempRoot } from '../helpers';
import { injectFaults, snapshotTree } from './engineHelpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const clock = fixedClock(FIXED_NOW);

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
    expect(await readdir(join(root, '.txn'))).toEqual([]);
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
