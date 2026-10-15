// RES-01, ARCH-41 (`r03-partial-save`), in-process part: a Change Set is validated as a whole before
// anything live changes, and is committed through the recoverable transaction engine. A failure at
// any write, move or delete leaves the complete old state or, after recovery, the complete new state.
// The last part kills a real CLI process during the save (WP02C).
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DataIntegrityError, ValidationError } from '../../src/core';
import { definePlugin } from '../../src/plugin-api';
import { epics } from '../../src/plugins/epics';
import { createEpic, deleteEpic } from '../../src/plugins/epics/service';
import { specs } from '../../src/plugins/specs';
import { deleteSpec, saveSpec } from '../../src/plugins/specs/specs';
import { CoreChangeSet } from '../../src/services/plugins/changeSet';
import { createRepositories, pathExists, recoverTransactions } from '../../src/storage';
import { makeStory, type TempRoot } from '../helpers';
import { injectFaults, snapshotTree } from '../storage/engineHelpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

interface Scenario {
  name: string;
  /** A fresh Data Root, ready for `run`. */
  setup(): Promise<{ t: TempRoot; run: () => Promise<unknown> }>;
}

const ASSIGNEES = [
  { handle: 'alice', name: 'Alice' },
  { handle: 'bob', name: 'Bob' },
];

const scenarios: Scenario[] = [
  {
    name: 'assignee removal',
    async setup() {
      const t = await pluginRoot({}, { assignees: ASSIGNEES });
      for (const n of [1, 2, 3]) {
        await makeStory(t.path, {
          boardId: 'web',
          key: `WEB-${n}`,
          rank: `a${n}`,
          assignees: ['bob'],
          plugins: { retired: { keep: n } },
        });
      }
      const { services } = await withPlugins(t, []);
      return { t, run: () => services.assignees.remove('bob') };
    },
  },
  {
    name: 'Epic deletion',
    async setup() {
      const t = await pluginRoot({ epics: true });
      for (const n of [1, 2, 3]) {
        await makeStory(t.path, {
          boardId: 'web',
          key: `WEB-${n}`,
          rank: `a${n}`,
          plugins: { epics: { epic: 'auth' } },
        });
      }
      const { services } = await withPlugins(t, [epics]);
      const plugin = services.plugins.context('epics');
      await createEpic(plugin, { id: 'auth', name: 'Auth' });
      return { t, run: () => deleteEpic(plugin, 'auth') };
    },
  },
  {
    name: 'Spec deletion',
    async setup() {
      const t = await pluginRoot({ specs: true });
      for (const n of [1, 2, 3]) {
        await makeStory(t.path, {
          boardId: 'web',
          key: `WEB-${n}`,
          rank: `a${n}`,
          plugins: { specs: { specs: ['auth'] } },
        });
      }
      const { services } = await withPlugins(t, [specs]);
      const plugin = services.plugins.context('specs');
      await saveSpec(plugin, { board: 'web', slug: 'auth' }, '# Auth\n', true);
      return { t, run: () => deleteSpec(plugin, { board: 'web', slug: 'auth' }) };
    },
  },
];

/**
 * The Data Root without its lock files: a crash injected while the lock is taken or released leaves
 * them behind, as a killed process would, and the next acquisition breaks them (ADR-0019 §1).
 */
async function dataTree(path: string): Promise<Record<string, string>> {
  const tree = await snapshotTree(path);
  return Object.fromEntries(Object.entries(tree).filter(([name]) => !/^\.lock/.test(name)));
}

/** The tree before and after a clean run, and how many mutating `io` calls the run makes. */
async function cleanRun(scenario: Scenario) {
  const { t, run } = await scenario.setup();
  const before = await dataTree(t.path);
  const counting = injectFaults();
  try {
    await run();
  } finally {
    counting.restore();
  }
  return { before, after: await dataTree(t.path), calls: counting.calls };
}

describe.each(scenarios)('$name', (scenario) => {
  it('a crash at any write, move or delete recovers to the complete old or new state', async () => {
    const clean = await cleanRun(scenario);
    expect(clean.after).not.toEqual(clean.before);
    expect(clean.calls).toBeGreaterThan(5);
    for (let n = 1; n <= clean.calls; n++) {
      const { t, run } = await scenario.setup();
      const faults = injectFaults();
      faults.crashAt(n);
      const error = await run().then(
        () => undefined,
        (err: unknown) => err,
      );
      faults.restore();
      // Never "nothing saved" once the commit point has passed: the error names what is pending.
      if (error instanceof DataIntegrityError) expect(error.details?.pending, `call ${n}`).toBeDefined();
      await recoverTransactions(t.path);
      const recovered = await dataTree(t.path);
      // A crash while only cleanup is left still reports success: every step was applied.
      if (error === undefined) expect(recovered, `call ${n}`).toEqual(clean.after);
      else expect([clean.before, clean.after], `call ${n}`).toContainEqual(recovered);
      await recoverTransactions(t.path);
      expect(await dataTree(t.path), `call ${n}, recovered again`).toEqual(recovered);
    }
  }, 120_000);

  it('a single failed write, move or delete is retried or leaves the old state', async () => {
    const clean = await cleanRun(scenario);
    for (let n = 1; n <= clean.calls; n++) {
      const { t, run } = await scenario.setup();
      const faults = injectFaults();
      faults.failOnce(n);
      const ok = await run().then(
        () => true,
        () => false,
      );
      faults.restore();
      await recoverTransactions(t.path);
      const recovered = await dataTree(t.path);
      if (ok) expect(recovered, `call ${n}`).toEqual(clean.after);
      else expect([clean.before, clean.after], `call ${n}`).toContainEqual(recovered);
    }
  }, 120_000);
});

describe('final-plan validation (r03 case A)', () => {
  it('an invalid record anywhere in the plan writes nothing', async () => {
    const t = await pluginRoot({}, { assignees: ASSIGNEES });
    for (const n of [1, 2, 3]) {
      await makeStory(t.path, { boardId: 'web', key: `WEB-${n}`, rank: `a${n}`, assignees: ['bob'] });
    }
    const before = await snapshotTree(t.path);
    const changes = new CoreChangeSet(t.root, createRepositories(t.root));
    await changes.updateRootConfig((c) => ({ ...c, assignees: c.assignees.filter((a) => a.handle !== 'bob') }));
    for (const n of [1, 2, 3]) await changes.updateStory(`WEB-${n}`, (s) => ({ ...s, assignees: [] }));
    // Core code holds the plan's own records; one that becomes invalid is caught before any write.
    const second = changes.changes[2];
    if (second?.type === 'story' && second.after) second.after.name = '';

    await expect(changes.save()).rejects.toThrow(ValidationError);
    expect(await snapshotTree(t.path)).toEqual(before);
  });

  it('a transform that edits a snapshot in place saves nothing (r03 case A)', async () => {
    const mutator = definePlugin({
      id: 'mutator',
      name: 'Mutator',
      description: '',
      hooks: {
        'assignees.remove': {
          transform({ changes }) {
            const second = changes.changes.filter((c) => c.type === 'story')[1];
            if (second?.type === 'story' && second.after) (second.after as { name: string }).name = '';
          },
        },
      },
    });
    const t = await pluginRoot({ mutator: true }, { assignees: ASSIGNEES });
    for (const n of [1, 2, 3]) {
      await makeStory(t.path, { boardId: 'web', key: `WEB-${n}`, rank: `a${n}`, assignees: ['bob'] });
    }
    const { services } = await withPlugins(t, [mutator]);
    const before = await snapshotTree(t.path);
    await expect(services.assignees.remove('bob')).rejects.toThrow();
    expect(await snapshotTree(t.path)).toEqual(before);
  });

  it('no reaction runs after a failed save', async () => {
    let reacted = 0;
    const watcher = definePlugin({
      id: 'watcher',
      name: 'Watcher',
      description: '',
      hooks: {
        'assignees.remove': {
          react() {
            reacted++;
          },
        },
      },
    });
    const t = await pluginRoot({ watcher: true }, { assignees: ASSIGNEES });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', assignees: ['bob'] });
    const { services } = await withPlugins(t, [watcher]);
    const faults = injectFaults();
    faults.crashAt(1);
    await expect(services.assignees.remove('bob')).rejects.toThrow();
    faults.restore();
    expect(reacted).toBe(0);
  });
});

describe('a CLI process killed during the save (WP02C)', () => {
  const REPO = fileURLToPath(new URL('../..', import.meta.url));
  const BARRIER_CLI = fileURLToPath(new URL('./scripts/barrierCli.ts', import.meta.url));

  function rowbly(t: TempRoot, args: string[], env: NodeJS.ProcessEnv = {}) {
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
    return new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
      },
    );
  }

  async function bobRoot() {
    const t = await pluginRoot({}, { assignees: ASSIGNEES });
    for (const n of [1, 2, 3]) {
      await makeStory(t.path, { boardId: 'web', key: `WEB-${n}`, rank: `a${n}`, assignees: ['bob'] });
    }
    return t;
  }

  /** 'old' or 'new' when the Data Root holds one of the two complete states, else what it holds. */
  async function stateOf(t: TempRoot): Promise<string> {
    const roster = ((await readJsonFile(t, 'rowbly.config.json')).assignees as { handle: string }[]).map(
      (a) => a.handle,
    );
    const assigned = await Promise.all(
      [1, 2, 3].map(async (n) => (await readJsonFile(t, storyFile(`WEB-${n}`))).assignees as string[]),
    );
    const withBob = [roster, ...assigned].map((list) => list.includes('bob'));
    if (withBob.every(Boolean)) return 'old';
    if (!withBob.some(Boolean)) return 'new';
    return `partial: ${JSON.stringify(withBob)}`;
  }

  it('recovers to the complete old or new state when the next command opens the Data Root', async () => {
    const clean = await bobRoot();
    const counted = await rowbly(clean, ['assignees', 'remove', 'bob'], { COUNT_CALLS: '1' });
    expect(counted.code, counted.stderr).toBe(0);
    const calls = counted.stderr.split('\n').filter((line) => line.startsWith('io '));
    // After staging, at the commit point, and at every step of the commit.
    const points = calls.flatMap((line, i) => (/\.txn/.test(line) ? [i + 1] : []));
    expect(points.length).toBeGreaterThan(5);

    for (const n of points) {
      const t = await bobRoot();
      const killed = await rowbly(t, ['assignees', 'remove', 'bob'], { KILL_AT: String(n) });
      expect(killed.signal, `call ${n}: ${calls[n - 1]}`).toBe('SIGKILL');
      const reopened = await rowbly(t, ['stories', 'list', '--board', 'web', '--json']);
      expect(reopened.code, reopened.stderr).toBe(0);
      expect(['old', 'new'], `call ${n}: ${calls[n - 1]}`).toContain(await stateOf(t));
      expect((await pathExists(join(t.path, '.txn'))) ? await readdir(join(t.path, '.txn')) : []).toEqual([]);
      await t.cleanup();
    }
  }, 240_000);
});
