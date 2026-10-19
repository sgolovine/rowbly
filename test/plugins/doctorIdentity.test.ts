// RES-09 (`r06-doctor-stale-key`): doctor repairs structural key conflicts first, as their own
// guarded pass, then analyzes again before any Plugin fix runs, so a key-addressed fix reaches the
// Story it was meant for. RES-02, doctor part: a pass plans under the Data Root lock.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/core';
import { definePlugin, type PluginChangeSet, z } from '../../src/plugin-api';
import { epics } from '../../src/plugins/epics';
import { StorySchema } from '../../src/schemas';
import { makeStory, type TempRoot, writeFixture } from '../helpers';
import { snapshotTree } from '../storage/engineHelpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

const LATER = '2026-10-13T00:00:00.000Z';
const EPIC = {
  version: 1,
  id: 'real',
  name: 'Real',
  description: '',
  closed: false,
  createdAt: '2026-10-12T17:21:07.000Z',
  updatedAt: '2026-10-12T17:21:07.000Z',
};

/** Keeper `key` links to Epic `real`; a later duplicate of it, in folder `folder`, links to `missing`. */
async function duplicate(t: TempRoot, key: string, folder: string, missing: string, rank: string) {
  await makeStory(t.path, { boardId: 'web', key, name: `Keeper ${key}`, rank, plugins: { epics: { epic: 'real' } } });
  const dup = await makeStory(t.path, {
    boardId: 'web',
    key,
    name: `Duplicate ${key}`,
    rank: `${rank}x`,
    createdAt: LATER,
    plugins: { epics: { epic: missing } },
  });
  await writeFixture(join(t.path, storyFile(folder)), StorySchema, dup);
  // makeStory wrote the duplicate over the keeper's file: write the keeper again.
  await makeStory(t.path, { boardId: 'web', key, name: `Keeper ${key}`, rank, plugins: { epics: { epic: 'real' } } });
}

async function epicsRoot(extra: Record<string, true> = {}) {
  const t = await pluginRoot({ epics: true, ...extra });
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(join(t.path, 'plugins/epics'), { recursive: true });
  await writeFile(join(t.path, 'plugins/epics/real.json'), `${JSON.stringify(EPIC)}\n`);
  return t;
}

const bag = async (t: TempRoot, key: string) => {
  const story = await readJsonFile(t, storyFile(key));
  return { name: story.name, plugins: story.plugins };
};

describe('doctor --fix with duplicate Story Keys (RES-09)', () => {
  it('keeps the keeper link and repairs only the renumbered duplicate (r06)', async () => {
    const t = await epicsRoot();
    await duplicate(t, 'WEB-1', 'WEB-7', 'gone', 'a1');
    const { services } = await withPlugins(t, [epics]);

    const check = await services.doctor.check();
    expect(check.findings.map((f) => [f.code, f.path])).toEqual([['DUPLICATE_KEY', storyFile('WEB-7')]]);

    const report = await services.doctor.fix();
    expect(report.fixed.map((f) => [f.code, f.path])).toEqual([
      ['DUPLICATE_KEY', storyFile('WEB-7')],
      ['EPICS_MISSING_EPIC', storyFile('WEB-8')],
    ]);
    expect(report.findings).toEqual([]);
    expect(await bag(t, 'WEB-1')).toEqual({ name: 'Keeper WEB-1', plugins: { epics: { epic: 'real' } } });
    expect(await bag(t, 'WEB-8')).toEqual({ name: 'Duplicate WEB-1', plugins: undefined });
  });

  it('fixes two duplicate groups and their missing links together', async () => {
    const t = await epicsRoot();
    await duplicate(t, 'WEB-1', 'WEB-7', 'gone', 'a1');
    await duplicate(t, 'WEB-2', 'WEB-9', 'lost', 'a2');
    const { services } = await withPlugins(t, [epics]);

    const report = await services.doctor.fix();
    expect(report.findings).toEqual([]);
    for (const key of ['WEB-1', 'WEB-2']) expect((await bag(t, key)).plugins).toEqual({ epics: { epic: 'real' } });
    const renumbered = (await services.stories.list('web', {})).filter((s) => s.name.startsWith('Duplicate'));
    expect(renumbered.map((s) => [s.key, s.plugins])).toEqual([
      ['WEB-10', undefined],
      ['WEB-11', undefined],
    ]);
  });

  it('a guard refuses the structural repair before anything changes on disk', async () => {
    const veto = definePlugin({
      id: 'veto',
      name: 'Veto',
      description: '',
      hooks: { 'doctor.fix': { guard: () => ({ reject: 'not today' }) } },
    });
    const t = await epicsRoot({ veto: true });
    await duplicate(t, 'WEB-1', 'WEB-7', 'gone', 'a1');
    const { services } = await withPlugins(t, [epics, veto]);
    const before = await snapshotTree(t.path);
    await expect(services.doctor.fix()).rejects.toThrow(ConflictError);
    expect(await snapshotTree(t.path)).toEqual(before);
  });

  it('a failing later pass leaves the earlier committed pass in place, and the error says which committed', async () => {
    const broken = definePlugin({
      id: 'broken',
      name: 'Broken',
      description: '',
      doctor: {
        check: ({ data }) =>
          data.stories
            .filter((s) => s.name.startsWith('Duplicate'))
            .map((s) => ({
              code: 'ALWAYS',
              severity: 'warning' as const,
              path: storyFile(s.key),
              message: `${s.key} is checked`,
              async fix(changes: PluginChangeSet) {
                await changes.updateStory(s.key, (story) => ({ ...story, name: 'half' }));
                throw new Error('fix broke');
              },
            })),
      },
    });
    const t = await epicsRoot({ broken: true });
    await duplicate(t, 'WEB-1', 'WEB-7', 'gone', 'a1');
    const { services } = await withPlugins(t, [epics, broken]);

    const err = (await services.doctor.fix().catch((e: unknown) => e)) as { details: Record<string, unknown> };
    expect(err).toBeInstanceOf(Error);
    expect(err.details.committed).toEqual([
      { code: 'DUPLICATE_KEY', path: storyFile('WEB-7'), message: 'renumbered WEB-1 ("Duplicate WEB-1") to WEB-8' },
    ]);
    // The renumbering is saved; nothing of the failed pass is.
    expect(await bag(t, 'WEB-8')).toEqual({ name: 'Duplicate WEB-1', plugins: { epics: { epic: 'gone' } } });
    expect(await bag(t, 'WEB-1')).toEqual({ name: 'Keeper WEB-1', plugins: { epics: { epic: 'real' } } });
  });
});

describe('doctor plans each pass under the Data Root lock (RES-02)', () => {
  const REPO = fileURLToPath(new URL('../..', import.meta.url));
  const BARRIER_CLI = fileURLToPath(new URL('./scripts/barrierCli.ts', import.meta.url));

  it('a Story edited by another process while doctor analyzes keeps both changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rowbly-barrier-'));
    const { writeFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const waitFor = async (...marks: string[]) => {
      while (!marks.some((m) => existsSync(join(dir, m)))) await new Promise((r) => setTimeout(r, 5));
    };
    let t!: TempRoot;
    let stderr = '';
    let exited: Promise<number | null> | undefined;
    /** Another CLI process edits WEB-1; it waits for the lock if doctor holds it. */
    const editElsewhere = () => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', BARRIER_CLI, 'stories', 'edit', 'WEB-1', '--name', 'Edited elsewhere'],
        {
          cwd: REPO,
          env: {
            PATH: process.env.PATH,
            HOME: t.path,
            ROWBLY_ROOT: t.path,
            BARRIER_DIR: dir,
            BARRIER_SELF: 'b',
            BARRIER_PEER: 'a',
          },
        },
      );
      child.stdin.end();
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      exited = new Promise((resolve) => child.on('close', resolve));
    };
    let checks = 0;
    const Step = z.object({ step: z.number() });
    // Its fix leaves an unknown Custom Field value, which the next pass strips from the Story it analyzed.
    const stepper = definePlugin({
      id: 'stepper',
      name: 'Stepper',
      description: '',
      bags: { story: Step },
      doctor: {
        async check({ data, plugin }) {
          checks += 1;
          if (checks === 2) {
            // Second analysis: the other process edits WEB-1 now, or waits for the lock.
            await writeFile(join(dir, 'a.reached'), '');
            editElsewhere();
            await waitFor('b.blocked', 'b.done');
          }
          return data.stories
            .filter((s) => plugin.readBag(s, Step)?.step === 1)
            .map((s) => ({
              code: 'STEP',
              severity: 'warning' as const,
              path: storyFile(s.key),
              message: `${s.key} needs a step`,
              async fix(changes: PluginChangeSet) {
                await changes.updateStory(s.key, (story) => ({
                  ...plugin.writeBag(story, undefined),
                  customFields: { ghost: 'x' },
                }));
                return `stepped ${s.key}`;
              },
            }));
        },
      },
    });
    t = await pluginRoot({ stepper: true, barrier: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Old', plugins: { stepper: { step: 1 } } });
    const { services } = await withPlugins(t, [stepper]);
    try {
      await services.doctor.fix();
      expect(await exited, stderr).toBe(0);
      expect(await readJsonFile(t, storyFile('WEB-1'))).toMatchObject({ name: 'Edited elsewhere', customFields: {} });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
