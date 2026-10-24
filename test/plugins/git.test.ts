import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { definePlugin, type GitOptionsSource } from '../../src/plugin-api';
import { comments } from '../../src/plugins/comments';
import { addComment } from '../../src/plugins/comments/comments';
import { git } from '../../src/plugins/git';
import { configure, preferences } from '../../src/plugins/git/model';
import { drainGitQueue } from '../../src/services/plugins/git';
import * as gitStorage from '../../src/storage/git';
import { pendingPath, readGitPending } from '../../src/storage/git';
import { deferred } from '../helpers/deferred';
import { pluginRoot, withPlugins } from './helpers';

const exec = promisify(execFile);
async function command(cwd: string, ...args: string[]) {
  return (await exec('git', args, { cwd })).stdout.trim();
}
async function fixture() {
  const t = await pluginRoot({ git: true, comments: true });
  await command(t.dir, 'init', '-b', 'main');
  await command(t.dir, 'config', 'user.name', 'Default Author');
  await command(t.dir, 'config', 'user.email', 'default@example.com');
  await writeFile(join(t.path, '.gitignore'), 'local.json\n.lock\n.txn/\n');
  await command(t.dir, 'add', '.');
  await command(t.dir, 'commit', '-m', 'initial');
  const setup = await withPlugins(t, [git, comments]);
  return { t, ...setup, command: (...args: string[]) => command(t.dir, ...args) };
}

/** Hold the old caller outside coordination, or hold Off's reaction after its save. */
async function savedPreferenceRace(boundary: 'react' | 'start' | 'worker') {
  const f = await fixture();
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const file = await pendingPath(f.t.root, 'git');
  if (boundary !== 'react') {
    await configure(f.services.plugins.context('git'), { frequency: 'interval', intervalSeconds: 3600 });
    await f.services.stories.create('web', { name: 'Pending before Off' });
    if (boundary === 'start')
      await writeFile(file, JSON.stringify({ ...(await readGitPending(file)), due: Date.now() - 7_200_001 }));
  }
  let original = await readGitPending(file);
  const scheduled = timers.mock.calls.find(([, ms]) => typeof ms === 'number' && ms > 3_500_000)?.[0];
  const before = await f.command('rev-parse', 'HEAD');
  const held = deferred();
  const release = deferred();
  const finished = deferred();
  let starting: ReturnType<typeof withPlugins> | undefined;
  async function hold(options: GitOptionsSource, localData: () => Promise<unknown>) {
    const captured = typeof options === 'function' ? options(await localData()) : options;
    expect(captured.automaticCommits ?? true).toBe(true);
    held.resolve();
    await release.promise;
  }
  const observed: typeof git = {
    ...git,
    async start(args) {
      await git.start?.({
        ...args,
        git: {
          ...args.git,
          async resume(options) {
            if (boundary === 'start') await hold(options, args.localData);
            await args.git.resume(options);
            if (boundary === 'start') finished.resolve();
          },
        },
      });
    },
    async react(event) {
      if (boundary === 'worker') {
        held.resolve();
        await release.promise;
      }
      await git.react?.({
        ...event,
        plugin: {
          ...event.plugin,
          git: {
            ...event.plugin.git,
            async changed(changes, options) {
              if (boundary === 'react') await hold(options, event.plugin.localData);
              await event.plugin.git.changed(changes, options);
            },
          },
        },
      });
      finished.resolve();
    },
  };
  const off = {
    automaticCommits: false,
    frequency: 'interval',
    intervalSeconds: 7200,
    authorName: 'Saved Author',
    authorEmail: 'saved@example.com',
  };
  try {
    if (boundary === 'start') starting = withPlugins(f.t, [observed]);
    else {
      const delayed = await withPlugins(f.t, [observed], { backgroundReactions: true });
      if (boundary === 'react') await delayed.services.stories.create('web', { name: 'Delayed default On' });
      else {
        // Load while the deadline is future; only the captured callback may dispatch overdue work.
        const queued = await readGitPending(file);
        if (!queued) throw new Error('Expected pending interval work');
        original = { ...queued, due: Date.now() - 7_200_001 };
        await writeFile(file, JSON.stringify(original));
        await configure(delayed.services.plugins.context('git'), off);
      }
    }
    await held.promise;
    if (boundary !== 'worker') await configure(f.services.plugins.context('git'), off);
    expect(await preferences(f.services.plugins.context('git'))).toMatchObject(off);
    if (boundary === 'worker') {
      // Off is saved, but its reaction has not updated pending.options yet.
      expect((await readGitPending(file))?.options.automaticCommits).toBe(true);
      expect(scheduled).toBeTypeOf('function');
      if (typeof scheduled === 'function') scheduled();
      await drainGitQueue(f.t.root);
      const admitted = await readGitPending(file);
      expect(admitted?.options).toEqual(off);
      expect(admitted?.revision).toBe((original?.revision ?? 0) + 1);
      expect(admitted?.due).toBe((original?.due ?? 0) + 3_600_000);
      expect(admitted?.paths).toEqual(original?.paths);
    }
    const paused = await readGitPending(file);
    release.resolve();
    await finished.promise;
    await starting;
    await drainGitQueue(f.t.root);
    expect(await f.command('rev-parse', 'HEAD')).toBe(before);
    const pending = await readGitPending(file);
    expect(pending?.options).toEqual(off);
    expect(pending?.paths.length).toBeGreaterThan(0);
    if (original) {
      expect(pending?.paths).toEqual(original.paths);
      expect(pending?.due).toBe(original.due + 3_600_000);
      expect(pending?.due).toBe(paused?.due);
      expect(pending?.revision).toBe((paused?.revision ?? 0) + 1);
    }
    await configure(f.services.plugins.context('git'), { ...off, automaticCommits: true });
    if (boundary === 'react') {
      expect((await readGitPending(file))?.due).toBe(pending?.due);
      expect(await f.command('rev-parse', 'HEAD')).toBe(before);
      await configure(f.services.plugins.context('git'), { ...off, automaticCommits: true, frequency: 'change' });
    }
    expect(await readGitPending(file)).toBeNull();
    expect(await f.command('rev-parse', 'HEAD')).not.toBe(before);
    expect(await f.command('log', '-1', '--format=%an|%ae')).toBe('Saved Author|saved@example.com');
    expect(f.warnings).toEqual([]);
  } finally {
    release.resolve();
    await starting;
    await drainGitQueue(f.t.root);
    timers.mockRestore();
  }
}
afterEach(() => vi.restoreAllMocks());

describe('Git automatic commits', () => {
  it('fails load and refuses enable outside Git', async () => {
    const t = await pluginRoot({ git: true });
    const { host, services } = await withPlugins(t, [git]);
    expect(host.failures()[0]?.reason).toContain('inside a Git repository');
    await expect(services.plugins.enable('git')).rejects.toThrow('inside a Git repository');
  });

  it('commits new, changed and deleted files, preserves unrelated staged and unstaged changes, and uses Git defaults', async () => {
    const f = await fixture();
    expect((await preferences(f.services.plugins.context('git'))).automaticCommits).toBe(true);
    await writeFile(join(f.t.dir, 'staged.txt'), 'staged');
    await f.command('add', 'staged.txt');
    await writeFile(join(f.t.dir, 'untracked.txt'), 'untracked');
    const story = await f.services.stories.create('web', { name: 'First' });
    expect(await f.command('log', '-1', '--format=%s|%an|%ae')).toBe(
      'chore: update Rowbly data|Default Author|default@example.com',
    );
    expect(await f.command('diff', '--cached', '--name-only')).toBe('staged.txt');
    expect(await f.command('show', '--format=', '--name-only', 'HEAD')).toBe(
      `.rowbly/boards/web/stories/${story.key}/story.json`,
    );
    await f.services.stories.update(story.key, { name: 'Changed' });
    await f.services.stories.remove(story.key);
    expect(await f.command('show', '--format=', '--name-status', 'HEAD')).toContain('D\t.rowbly/boards/web/stories/');
    expect(await f.command('status', '--porcelain')).toContain('?? untracked.txt');
    expect(f.warnings).toEqual([]);
  });

  it('reacts to other Plugins, supports custom authors, excludes Local State, and suppresses Git hooks', async () => {
    const f = await fixture();
    const story = await f.services.stories.create('web', { name: 'First' });
    await configure(f.services.plugins.context('git'), {
      frequency: 'change',
      intervalSeconds: 300,
      authorName: 'Robot',
      authorEmail: 'robot@example.com',
    });
    const before = await f.command('rev-parse', 'HEAD');
    await f.services.context.setMe('sam');
    expect(await f.command('rev-parse', 'HEAD')).toBe(before);
    const hooks = join(f.t.dir, 'hooks');
    await mkdir(hooks);
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await f.command('config', 'core.hooksPath', hooks);
    await addComment(f.services.plugins.context('comments'), story.key, 'Hello');
    expect(await f.command('log', '-1', '--format=%an|%ae')).toBe('Robot|robot@example.com');
    expect(await f.command('ls-files', '--', '.rowbly/local.json')).toBe('');
    expect(f.warnings).toEqual([]);
  });

  it('persists interval work, batches changes without postponing the deadline, resumes when due and skips empty commits', async () => {
    const f = await fixture();
    const plugin = f.services.plugins.context('git');
    await configure(plugin, { synchronization: { intervalSeconds: 7200 } });
    await configure(plugin, { synchronization: { enabled: true } });
    expect((await preferences(plugin)).synchronization).toEqual({ enabled: true, intervalSeconds: 7200 });
    await configure(plugin, { synchronization: { enabled: false } });
    await configure(plugin, { synchronization: { intervalSeconds: 3600 } });
    expect((await preferences(plugin)).synchronization).toEqual({ enabled: false, intervalSeconds: 3600 });
    await configure(plugin, { frequency: 'interval', intervalSeconds: 3600 });
    const initial = await f.command('rev-parse', 'HEAD');
    const story = await f.services.stories.create('web', { name: 'First' });
    const pendingFile = await pendingPath(f.t.root, 'git');
    const first = await readGitPending(pendingFile);
    await f.services.stories.update(story.key, { name: 'Second' });
    expect((await readGitPending(pendingFile))?.due).toBe(first?.due);
    expect(await f.command('rev-parse', 'HEAD')).toBe(initial);
    await configure(plugin, {
      automaticCommits: false,
      frequency: 'interval',
      intervalSeconds: 3600,
      authorName: 'Paused Author',
      authorEmail: 'paused@example.com',
    });
    const pausedStory = await f.services.stories.create('web', { name: 'While off' });
    expect((await readGitPending(pendingFile))?.due).toBe(first?.due);
    await withPlugins(f.t, [git, comments]);
    await drainGitQueue(f.t.root);
    expect(await f.command('rev-parse', 'HEAD')).toBe(initial);
    expect((await readGitPending(pendingFile))?.paths).toContain(`boards/web/stories/${pausedStory.key}`);
    const saved = await preferences(plugin);
    await configure(plugin, { ...saved, automaticCommits: true });
    expect(await f.command('rev-parse', 'HEAD')).toBe(initial);
    // Legacy pending files and capability callers omit the new preference and still resume.
    await writeFile(
      pendingFile,
      JSON.stringify({
        ...(await readGitPending(pendingFile)),
        due: Date.now() - 1,
        options: {
          frequency: 'interval',
          intervalSeconds: 3600,
        },
      }),
    );
    await withPlugins(f.t, [git, comments]);
    await drainGitQueue(f.t.root);
    expect(await f.command('rev-parse', 'HEAD')).not.toBe(initial);
    expect(await readGitPending(pendingFile)).toBeNull();
    expect(await f.command('log', '-1', '--format=%an|%ae')).toBe('Paused Author|paused@example.com');
    const committed = await f.command('rev-parse', 'HEAD');
    await f.services.stories.update(story.key, { name: 'Second' });
    await plugin.git.resume({ frequency: 'change', intervalSeconds: 1 });
    await drainGitQueue(f.t.root);
    expect(await f.command('rev-parse', 'HEAD')).toBe(committed);
  });

  it('warns without failing the saved Operation when touched files are already staged, and retries pending paths', async () => {
    const f = await fixture();
    const story = await f.services.stories.create('web', { name: 'First' });
    const path = join(f.t.path, 'boards/web/stories', story.key, 'story.json');
    const saved = await readFile(path, 'utf8');
    await writeFile(path, saved.replace('First', 'Staged'));
    await f.command('add', path);
    await f.services.stories.update(story.key, { name: 'Saved' });
    expect((await f.services.stories.get(story.key)).name).toBe('Saved');
    expect(f.warnings.join()).toContain('already have staged changes');
    expect(await f.command('show', `:${path.slice(f.t.dir.length + 1)}`)).toContain('Staged');
    await f.command('reset', '--', path);
    await f.services.plugins.context('git').git.resume({ frequency: 'change', intervalSeconds: 300 });
    await drainGitQueue(f.t.root);
    expect(await f.command('show', `HEAD:${path.slice(f.t.dir.length + 1)}`)).toContain('Saved');
  });
  it('runs a due timer with the latest persisted author and pauses stale timers and restarts while off', async () => {
    const f = await fixture();
    const plugin = f.services.plugins.context('git');
    await configure(plugin, { frequency: 'interval', intervalSeconds: 3600 });
    const timers = vi.spyOn(globalThis, 'setTimeout');
    await f.services.stories.create('web', { name: 'Pending' });
    const scheduled = timers.mock.calls.find(([, ms]) => typeof ms === 'number' && ms > 3_500_000)?.[0];
    expect(scheduled).toBeTypeOf('function');
    const file = await pendingPath(f.t.root, 'git');
    await configure(plugin, {
      frequency: 'interval',
      intervalSeconds: 3600,
      authorName: 'Latest',
      authorEmail: 'latest@example.com',
    });
    const pending = await readGitPending(file);
    await writeFile(
      file,
      JSON.stringify({
        ...pending,
        due: Date.now() - 1,
      }),
    );
    if (typeof scheduled === 'function') scheduled();
    await vi.waitFor(async () => expect(await readGitPending(file)).toBeNull());
    expect(await f.command('log', '-1', '--format=%an')).toBe('Latest');

    await f.services.stories.create('web', { name: 'Paused' });
    const before = await f.command('rev-parse', 'HEAD');
    await configure(plugin, { automaticCommits: false, frequency: 'interval', intervalSeconds: 3600 });
    const paused = await readGitPending(file);
    await writeFile(file, JSON.stringify({ ...paused, due: Date.now() - 1 }));
    // Invoke an already-dispatched callback: clearing its timer alone cannot prevent this work.
    if (typeof scheduled === 'function') scheduled();
    await drainGitQueue(f.t.root);
    expect(await f.command('rev-parse', 'HEAD')).toBe(before);
    await withPlugins(f.t, [git, comments]);
    await drainGitQueue(f.t.root);
    expect(await f.command('rev-parse', 'HEAD')).toBe(before);
    expect((await readGitPending(file))?.paths).toEqual(paused?.paths);
    expect(f.host.status().find((entry) => entry.id === 'git')).toMatchObject({ enabled: true, loaded: true });
    await configure(plugin, { ...(await preferences(plugin)), frequency: 'change' });
    expect(await f.command('rev-parse', 'HEAD')).toBe(before);
    expect((await preferences(plugin)).automaticCommits).toBe(false);
    await configure(plugin, { ...(await preferences(plugin)), automaticCommits: true });
    expect(await f.command('rev-parse', 'HEAD')).not.toBe(before);
    await configure(plugin, { frequency: 'interval', intervalSeconds: 3600 });
    await f.services.stories.create('web', { name: 'Plugin paused' });
    const beforeDisable = await f.command('rev-parse', 'HEAD');
    await f.services.plugins.disable('git');
    await plugin.git.resume({ frequency: 'change', intervalSeconds: 3600 });
    await drainGitQueue(f.t.root);
    expect(await f.command('rev-parse', 'HEAD')).toBe(beforeDisable);
    expect(await readGitPending(file)).not.toBeNull();
  });

  it('supports the Data Root at the Git top and an unborn branch', async () => {
    const t = await pluginRoot({ git: true });
    await command(t.path, 'init', '-b', 'main');
    await command(t.path, 'config', 'user.name', 'Top');
    await command(t.path, 'config', 'user.email', 'top@example.com');
    const { services, warnings } = await withPlugins(t, [git]);
    expect((await services.plugins.context('git').git.info()).root).toBe(t.path);
    await services.stories.create('web', { name: 'Top Story' });
    expect(await command(t.path, 'show', '--format=', '--name-only', 'HEAD')).toBe(
      'boards/web/stories/WEB-1/story.json',
    );
    expect(warnings).toEqual([]);
  });

  it('refuses Git effects in a guard before saving any change', async () => {
    const f = await fixture();
    const bad = definePlugin({
      id: 'bad',
      name: 'Bad',
      description: '',
      hooks: {
        'stories.create': {
          guard: async ({ plugin, changes }) => {
            await plugin.git.changed(changes, { frequency: 'change', intervalSeconds: 1 });
            return undefined;
          },
        },
      },
    });
    const config = JSON.parse(await readFile(join(f.t.path, 'rowbly.config.json'), 'utf8'));
    config.plugins.bad = { enabled: true };
    await writeFile(join(f.t.path, 'rowbly.config.json'), JSON.stringify(config));
    const { services } = await withPlugins(f.t, [git, bad]);
    await expect(services.stories.create('web', { name: 'Refused' })).rejects.toThrow('Git effects');
    expect(await services.stories.list('web', {})).toEqual([]);
  });
  it('keeps a failed commit pending and removes intent-to-add entries before retry', async () => {
    const f = await fixture();
    await f.command('config', 'commit.cleanup', 'invalid-cleanup');
    await f.services.stories.create('web', { name: 'Saved despite Git failure' });
    expect(f.warnings.join()).toContain('invalid-cleanup');
    expect(await f.command('diff', '--cached', '--name-only')).toBe('');
    expect(await f.command('status', '--porcelain')).not.toContain(' A ');
    await f.command('config', '--unset', 'commit.cleanup');
    await f.services.plugins.context('git').git.resume({ frequency: 'change', intervalSeconds: 300 });
    await drainGitQueue(f.t.root);
    expect(await f.command('log', '-1', '--format=%s')).toBe('chore: update Rowbly data');
  });

  it('keeps reads and edits live during Git work and retains later revisions when paused in flight', async () => {
    await savedPreferenceRace('react');
    await savedPreferenceRace('start');
    await savedPreferenceRace('worker');
    const f = await fixture();
    f.ctx.backgroundReactions = true;
    const snapshotted = deferred();
    const release = deferred();
    const enqueued = deferred();
    const commit = gitStorage.commitGitPaths;
    let first = true;
    const spy = vi.spyOn(gitStorage, 'commitGitPaths').mockImplementation((root, paths, options, snapshot) =>
      commit(root, paths, options, async (read) => {
        const result = await snapshot(read);
        if (first) {
          first = false;
          snapshotted.resolve();
          await release.promise;
        }
        return result;
      }),
    );
    const write = gitStorage.writeGitPending;
    const writing = vi.spyOn(gitStorage, 'writeGitPending').mockImplementation(async (path, value) => {
      await write(path, value);
      if (value?.revision === 2) enqueued.resolve();
    });
    try {
      const story = await f.services.stories.create('web', { name: 'First snapshot' });
      await snapshotted.promise;
      expect((await f.services.stories.get(story.key)).name).toBe('First snapshot');
      const file = await pendingPath(f.t.root, 'git');
      await f.services.stories.update(story.key, { name: 'Latest snapshot' });
      await enqueued.promise;
      await configure(f.services.plugins.context('git'), { automaticCommits: false });
      await vi.waitFor(async () => expect((await readGitPending(file))?.options.automaticCommits).toBe(false));
      const later = await f.services.stories.create('web', { name: 'Created while paused' });
      await vi.waitFor(async () =>
        expect((await readGitPending(file))?.paths).toContain(`boards/web/stories/${later.key}`),
      );
      const paused = await readGitPending(file);
      release.resolve();
      await drainGitQueue(f.t.root);
      const path = `.rowbly/boards/web/stories/${story.key}/story.json`;
      expect(await f.command('show', `HEAD:${path}`)).toContain('First snapshot');
      expect(await readGitPending(file)).toEqual(paused);
      // The first commit may finish; queued workers must recheck Off before starting another.
      await configure(f.services.plugins.context('git'), { automaticCommits: true });
      await vi.waitFor(async () => expect(await readGitPending(file)).toBeNull());
      await drainGitQueue(f.t.root);
      expect(await f.command('show', `HEAD~1:${path}`)).toContain('First snapshot');
      expect(await f.command('show', `HEAD:${path}`)).toContain('Latest snapshot');
      expect(await readGitPending(file)).toBeNull();
      expect(f.warnings).toEqual([]);
    } finally {
      release.resolve();
      await drainGitQueue(f.t.root);
      spy.mockRestore();
      writing.mockRestore();
    }
  });
});

// Pure three-way imports exercise preservation boundaries, independently of Git's textual merge.
describe('Git data reconciliation', () => {
  it('combines independent fields and hunks, distinguishes missing/null, and retains byte-exact alternatives deterministically', async () => {
    const { mergeData } = await import('../../src/services/plugins/mergeData');
    const { createMergeHelpers } = await import('../../src/services/plugins/reconciliation');
    const { builtInPlugins } = await import('../../src/plugins');
    const f = await fixture();
    await configure(f.services.plugins.context('git'), { automaticCommits: false });
    const story = await f.services.stories.create('web', {
      name: 'Base',
      description: 'one\ntwo\nthree\nfour\nfive\n',
    });
    const core = `boards/web/stories/${story.key}/story.json`;
    const file = (v: unknown) => ({
      data: Buffer.from(`${JSON.stringify(v, null, 2)}\n`).toString('base64'),
      mode: '100644' as const,
    });
    const root = JSON.parse(await readFile(join(f.t.path, 'rowbly.config.json'), 'utf8'));
    const board = JSON.parse(await readFile(join(f.t.path, 'boards/web/board.config.json'), 'utf8'));
    const base = {
      id: 'base',
      files: { 'rowbly.config.json': file(root), 'boards/web/board.config.json': file(board), [core]: file(story) },
    };
    const left = {
      id: 'a',
      files: {
        ...base.files,
        [core]: file({
          ...story,
          name: 'Left',
          labels: ['left'],
          description: 'ONE\nleft overlap\nthree\nfour\nfive\n',
          plugins: { future: { x: null, shared: [1], private: 'left' } },
        }),
      },
    };
    const right = {
      id: 'b',
      files: {
        ...base.files,
        [core]: file({
          ...story,
          priority: 'P1',
          labels: ['right'],
          description: 'one\nright overlap\nthree\nfour\nFIVE\n',
          plugins: { future: { shared: [2], other: 'right' } },
        }),
      },
    };
    const result = mergeData(base, left, right, builtInPlugins);
    const record = JSON.parse(Buffer.from(result.files[core]!.data, 'base64').toString());
    expect(record).toMatchObject({
      name: 'Left',
      priority: 'P1',
      labels: ['left', 'right'],
      plugins: { future: { x: null, private: 'left', other: 'right' } },
    });
    expect(record.description).toContain('ONE\n');
    expect(record.description).toContain('FIVE\n');
    expect(record.description).not.toMatch(/<<<<<<<|>>>>>>>/);
    expect(result.evidence).toHaveLength(1);
    const evidence = JSON.parse(Buffer.from(result.files[result.evidence[0]!]!.data, 'base64').toString());
    expect(evidence.sources.sides).toEqual([left, right]);
    expect(evidence.decisions.some((d: { reason: string }) => d.reason === 'overlapping text hunks')).toBe(true);
    expect(mergeData(base, right, left, builtInPlugins)).toEqual(result);
    expect(mergeData(base, left, right, builtInPlugins)).toEqual(result);
    const nextBase = { id: 'published', files: result.files };
    const nextLeft = { id: 'next-a', files: { ...result.files, [core]: file({ ...record, name: 'Second left' }) } };
    const nextRight = { id: 'next-b', files: { ...result.files, [core]: file({ ...record, name: 'Second right' }) } };
    const successive = mergeData(nextBase, nextLeft, nextRight, builtInPlugins);
    expect(successive.files[result.evidence[0]!]).toEqual(result.files[result.evidence[0]!]);
    const nextEvidence = JSON.parse(Buffer.from(successive.files[successive.evidence[0]!]!.data, 'base64').toString());
    for (const source of [nextEvidence.sources.base, ...nextEvidence.sources.sides]) {
      expect(Object.keys(source.files).some((p) => p.startsWith('plugins/git/merge-evidence/'))).toBe(false);
      expect(source.evidence).toEqual([{ path: result.evidence[0], digest: expect.any(String) }]);
    }
    expect(mergeData(nextBase, nextRight, nextLeft, builtInPlugins)).toEqual(successive);
    const decisions: import('../../src/services/plugins/reconciliation').MergeDecision[] = [];
    const h = createMergeHelpers(decisions);
    expect(h.value({ v: 1 }, {}, { v: null }, 'opaque')).toEqual({ v: null });
    expect(h.text('a\nb\nc\n', 'z\nleft\nc\n', 'a\nRIGHT\nc\n', 'text')).toBe('z\nRIGHT\nc\n');
    const opaque = h.value(
      { labels: ['a'], body: 'one\ntwo\n' },
      { labels: [], body: 'ONE\ntwo\n' },
      { labels: ['a', 'b'], body: 'one\nTWO\n' },
      'story.json/plugins/future',
    ) as { labels: string[]; body: string };
    expect([[], ['a', 'b']]).toContainEqual(opaque.labels);
    expect(['ONE\ntwo\n', 'one\nTWO\n']).toContain(opaque.body);
    expect(decisions.filter((d) => d.path.startsWith('story.json/plugins/future'))).toHaveLength(2);
    expect(h.members(['old'], ['left'], ['old', 'right'])).toEqual(['left', 'right']);
    expect(decisions[0]).toMatchObject({ base: { value: 1 }, alternatives: [{ missing: true }, { value: null }] });
  });

  it('splits equal-time identities with complete subtrees and source-qualified links, and restores a concurrently deleted linked target', async () => {
    const { mergeData } = await import('../../src/services/plugins/mergeData');
    const { builtInPlugins } = await import('../../src/plugins');
    const f = await fixture();
    await configure(f.services.plugins.context('git'), { automaticCommits: false });
    const target = await f.services.stories.create('web', { name: 'Target' });
    const old = await f.services.stories.create('web', { name: 'Existing' });
    const file = (v: unknown) => ({
      data: Buffer.from(`${JSON.stringify(v, null, 2)}\n`).toString('base64'),
      mode: '100644' as const,
    });
    const text = (v: string) => ({ data: Buffer.from(v).toString('base64'), mode: '100644' as const });
    const path = (key: string) => `boards/web/stories/${key}/story.json`;
    const base: import('../../src/services/plugins/mergeData').MergeSource = {
      id: 'base',
      files: {
        'rowbly.config.json': file(JSON.parse(await readFile(join(f.t.path, 'rowbly.config.json'), 'utf8'))),
        'boards/web/board.config.json': file(
          JSON.parse(await readFile(join(f.t.path, 'boards/web/board.config.json'), 'utf8')),
        ),
        [path(target.key)]: file(target),
        [path(old.key)]: file(old),
      },
    };
    const task = {
      number: 1,
      name: 'A',
      description: '',
      stage: 'backlog',
      createdAt: old.createdAt,
      updatedAt: old.updatedAt,
    };
    const left = {
      id: 'a',
      files: {
        ...base.files,
        [path(old.key)]: file({
          ...old,
          plugins: { tasks: { nextNumber: 2, tasks: [task] }, 'story-linking': { blocks: [target.key, 'WEB-3'] } },
        }),
        [path('WEB-3')]: file({ ...old, key: 'WEB-3', name: 'Left addition' }),
        'boards/web/stories/WEB-3/plugins/specs/a.md': text('# Left\n'),
        'boards/web/stories/WEB-3/plugins/unknown/raw.bin': {
          data: Buffer.from([0, 255, 1]).toString('base64'),
          mode: '100644' as const,
        },
      },
    };
    const right: typeof base = {
      id: 'b',
      files: {
        ...base.files,
        [path(old.key)]: file({
          ...old,
          plugins: {
            tasks: { nextNumber: 2, tasks: [{ ...task, name: 'B' }] },
            'story-linking': { blocks: ['WEB-3'] },
          },
        }),
        [path('WEB-3')]: file({ ...old, key: 'WEB-3', name: 'Right addition' }),
        'boards/web/stories/WEB-3/plugins/specs/b.md': text('# Right\n'),
      },
    };
    delete right.files[path(target.key)];
    const result = mergeData(base, left, right, builtInPlugins);
    const read = (key: string) => JSON.parse(Buffer.from(result.files[path(key)]!.data, 'base64').toString());
    expect(read('WEB-3').name).toBe('Left addition');
    expect(read('WEB-4').name).toBe('Right addition');
    expect(result.files['boards/web/stories/WEB-3/plugins/specs/a.md']).toEqual(
      left.files['boards/web/stories/WEB-3/plugins/specs/a.md'],
    );
    expect(result.files['boards/web/stories/WEB-4/plugins/specs/b.md']).toEqual(
      right.files['boards/web/stories/WEB-3/plugins/specs/b.md'],
    );
    expect(read(old.key).plugins['story-linking'].blocks).toEqual(['WEB-1', 'WEB-3', 'WEB-4']);
    expect(read(target.key)).toEqual(target);
    expect(read(old.key).plugins.tasks).toMatchObject({
      nextNumber: 3,
      tasks: [
        { number: 1, name: 'A' },
        { number: 2, name: 'B' },
      ],
    });
    expect(result.decisions.some((d) => d.reason.startsWith('restored source Story'))).toBe(true);
    expect(mergeData(base, right, left, builtInPlugins)).toEqual(result);
  });

  it('repairs effective constraints while retaining definitions, required-field intent and incompatible types', async () => {
    const { mergeData } = await import('../../src/services/plugins/mergeData');
    const f = await fixture();
    await configure(f.services.plugins.context('git'), { automaticCommits: false });
    const story = await f.services.stories.create('web', { name: 'Retained' });
    const file = (v: unknown) => ({
      data: Buffer.from(`${JSON.stringify(v, null, 2)}\n`).toString('base64'),
      mode: '100644' as const,
    });
    const rootPath = 'rowbly.config.json',
      boardPath = 'boards/web/board.config.json',
      storyPath = `boards/web/stories/${story.key}/story.json`;
    const root = JSON.parse(await readFile(join(f.t.path, rootPath), 'utf8'));
    const board = JSON.parse(await readFile(join(f.t.path, boardPath), 'utf8'));
    const base = { id: 'base', files: { [rootPath]: file(root), [boardPath]: file(board), [storyPath]: file(story) } };
    const left = {
      id: 'a',
      files: {
        ...base.files,
        [rootPath]: file({
          ...root,
          stages: [{ key: 'custom', name: 'Custom' }],
          customFields: [{ key: 'kind', name: 'Kind', type: 'select', options: ['a'], required: false }],
        }),
        [storyPath]: file({ ...story, stage: 'custom', customFields: { kind: 'a' } }),
      },
    };
    const right = {
      id: 'b',
      files: {
        ...base.files,
        [rootPath]: file({
          ...root,
          stages: [],
          customFields: [
            { key: 'kind', name: 'Kind number', type: 'number', required: true },
            { key: 'new', name: 'Required', type: 'text', required: true },
          ],
        }),
        [storyPath]: file({ ...story, customFields: { kind: 10 } }),
      },
    };
    const result = mergeData(base, left, right, []);
    const read = (p: string) => JSON.parse(Buffer.from(result.files[p]!.data, 'base64').toString());
    expect(read(storyPath).customFields).toEqual({ kind: 'a', 'kind-2': 10 });
    const config = read(boardPath);
    expect(config.customFields.find((f: { key: string }) => f.key === 'new').required).toBe(false);
    expect(read(rootPath).customFields.map((f: { key: string }) => f.key)).toEqual(['kind', 'kind-2', 'new']);
    expect(result.decisions.some((d) => d.reason === 'incompatible Custom Field types retained separately')).toBe(true);
    expect(mergeData(base, right, left, [])).toEqual(result);
  });
});
