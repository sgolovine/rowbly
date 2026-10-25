import { execFile, fork } from 'node:child_process';
import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { definePlugin, type GitOptionsSource } from '../../src/plugin-api';
import { comments } from '../../src/plugins/comments';
import { addComment } from '../../src/plugins/comments/comments';
import { git } from '../../src/plugins/git';
import { configure, preferences, resolveSyncOptions } from '../../src/plugins/git/model';
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
    const alias = { ...f.t.root, path: join(f.t.dir, 'root-alias') };
    await symlink(f.t.path, alias.path, 'dir');
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
      let aliasDrained = false;
      const aliasDrain = drainGitQueue(alias).then(() => {
        aliasDrained = true;
      });
      expect((await f.services.stories.get(story.key)).name).toBe('Latest snapshot');
      expect(aliasDrained).toBe(false);
      release.resolve();
      await aliasDrain;
      expect(aliasDrained).toBe(true);
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
    const record = JSON.parse(Buffer.from(result.files[core]?.data ?? '', 'base64').toString());
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
    const evidencePath = result.evidence[0];
    if (!evidencePath) throw new Error('Expected merge evidence');
    const evidence = JSON.parse(Buffer.from(result.files[evidencePath]?.data ?? '', 'base64').toString());
    expect(evidence.sources.sides).toEqual([left, right]);
    expect(evidence.decisions.some((d: { reason: string }) => d.reason === 'overlapping text hunks')).toBe(true);
    expect(mergeData(base, right, left, builtInPlugins)).toEqual(result);
    expect(mergeData(base, left, right, builtInPlugins)).toEqual(result);
    const nextBase = { id: 'published', files: result.files };
    const nextLeft = { id: 'next-a', files: { ...result.files, [core]: file({ ...record, name: 'Second left' }) } };
    const nextRight = { id: 'next-b', files: { ...result.files, [core]: file({ ...record, name: 'Second right' }) } };
    const successive = mergeData(nextBase, nextLeft, nextRight, builtInPlugins);
    expect(successive.files[evidencePath]).toEqual(result.files[evidencePath]);
    const nextPath = successive.evidence[0];
    if (!nextPath) throw new Error('Expected successive merge evidence');
    const nextEvidence = JSON.parse(Buffer.from(successive.files[nextPath]?.data ?? '', 'base64').toString());
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
    const comment = {
      id: 'same-id',
      author: null,
      body: 'Left Comment',
      createdAt: old.createdAt,
      updatedAt: old.updatedAt,
    };
    const left = {
      id: 'a',
      files: {
        ...base.files,
        [path(old.key)]: file({
          ...old,
          plugins: {
            tasks: { nextNumber: 2, tasks: [task] },
            comments: { comments: [comment] },
            'story-linking': { blocks: [target.key, 'WEB-3'] },
          },
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
            comments: { comments: [{ ...comment, body: 'Right Comment' }] },
            'story-linking': { blocks: ['WEB-3'] },
          },
        }),
        [path('WEB-3')]: file({ ...old, key: 'WEB-3', name: 'Right addition' }),
        'boards/web/stories/WEB-3/plugins/specs/b.md': text('# Right\n'),
      },
    };
    delete right.files[path(target.key)];
    const result = mergeData(base, left, right, builtInPlugins);
    const read = (key: string) => JSON.parse(Buffer.from(result.files[path(key)]?.data ?? '', 'base64').toString());
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
    expect(read(old.key).plugins.comments.comments).toEqual([
      comment,
      { ...comment, id: 'same-id-2', body: 'Right Comment' },
    ]);
    expect(result.decisions).toContainEqual(
      expect.objectContaining({
        reason: 'distinct concurrent Comments retained with separate identities',
        alternatives: [{ value: comment }, { value: { ...comment, body: 'Right Comment' } }],
      }),
    );
    expect(result.evidence).toHaveLength(1);
    expect(mergeData(base, right, left, builtInPlugins)).toEqual(result);

    const boardPath = 'boards/web/board.config.json';
    const originalBoard = JSON.parse(Buffer.from(base.files[boardPath]?.data ?? '', 'base64').toString());
    const opaquePath = 'boards/web/plugins/future/opaque.bin';
    const retainedStoryFile = `boards/web/stories/${target.key}/plugins/future/retained.bin`;
    const boardBase = {
      ...base,
      files: { ...base.files, [opaquePath]: text('original bytes'), [retainedStoryFile]: text('unchanged descendant') },
    };
    const recreatedBoard = {
      id: 'a',
      files: {
        ...boardBase.files,
        [boardPath]: file({ ...originalBoard, name: 'Recreated Board', createdAt: '2030-01-01T00:00:00.000Z' }),
        [path(target.key)]: file({
          ...target,
          createdAt: '2030-01-01T00:00:00.000Z',
          plugins: { 'story-linking': { blocks: [old.key] }, future: { key: target.key } },
        }),
        [path(old.key)]: file({ ...old, name: 'Recreated Story', createdAt: '2030-01-01T00:00:00.000Z' }),
        [opaquePath]: { data: Buffer.from([0, 255, 65]).toString('base64'), mode: '100644' as const },
      },
    };
    const editedBoard = {
      id: 'b',
      files: {
        ...boardBase.files,
        [boardPath]: file({ ...originalBoard, name: 'Edited original Board' }),
        [path(old.key)]: file({ ...old, plugins: { 'story-linking': { blocks: [target.key] } } }),
        [opaquePath]: { data: Buffer.from([0, 255, 66]).toString('base64'), mode: '100644' as const },
      },
    };
    const boards = mergeData(boardBase, recreatedBoard, editedBoard, builtInPlugins);
    const remap = boards.remaps.find((map) => map.source === recreatedBoard.id);
    const newBoard = remap?.boards.web,
      newTarget = remap?.stories[target.key],
      newOld = remap?.stories[old.key];
    if (!newBoard || !newTarget || !newOld) throw new Error('Expected recreated Board subtree remapping');
    const readBoardMerge = (path: string) =>
      JSON.parse(Buffer.from(boards.files[path]?.data ?? '', 'base64').toString());
    expect(Object.keys(boards.files).filter((p) => p.endsWith('/board.config.json'))).toHaveLength(2);
    expect(readBoardMerge(boardPath).name).toBe('Edited original Board');
    expect(boards.files[path(target.key)]).toBeDefined();
    expect(readBoardMerge(path(target.key))).toEqual(target);
    expect(readBoardMerge(`boards/${newBoard}/board.config.json`).name).toBe('Recreated Board');
    expect(boards.files[opaquePath]).toEqual(editedBoard.files[opaquePath]);
    expect(boards.files[retainedStoryFile]).toEqual(editedBoard.files[retainedStoryFile]);
    expect(boards.files[`boards/${newBoard}/plugins/future/opaque.bin`]).toEqual(recreatedBoard.files[opaquePath]);
    expect(readBoardMerge(path(old.key)).plugins['story-linking'].blocks).toEqual([target.key]);
    const newStory = readBoardMerge(`boards/${newBoard}/stories/${newTarget}/story.json`);
    expect(newStory.boardId).toBe(newBoard);
    expect(newStory.plugins['story-linking'].blocks).toEqual([newOld]);
    expect(newStory.plugins.future.key).toBe(target.key);
    expect(mergeData(boardBase, editedBoard, recreatedBoard, builtInPlugins)).toEqual(boards);

    // Story recreation uses the same complete-subtree rule: unchanged descendants belong to
    // the retained old identity, even though the other source replaced that identity.
    const recreatedStory = {
      id: 'a',
      files: {
        ...boardBase.files,
        [path(target.key)]: file({ ...target, name: 'Recreated Story', createdAt: '2030-01-01T00:00:00.000Z' }),
        [path(old.key)]: file({ ...old, plugins: { 'story-linking': { blocks: [target.key] } } }),
        [retainedStoryFile]: text('recreated descendant'),
      },
    };
    const editedStory = {
      id: 'b',
      files: {
        ...boardBase.files,
        [path(target.key)]: file({ ...target, name: 'Edited original Story' }),
        [path(old.key)]: file({ ...old, plugins: { 'story-linking': { blocks: [target.key] } } }),
      },
    };
    const storyMerge = mergeData(boardBase, recreatedStory, editedStory, builtInPlugins);
    const replacement = storyMerge.remaps.find((map) => map.source === 'a')?.stories[target.key];
    if (!replacement) throw new Error('Expected recreated Story remapping');
    expect(storyMerge.files[retainedStoryFile]).toEqual(editedStory.files[retainedStoryFile]);
    expect(storyMerge.files[`boards/web/stories/${replacement}/plugins/future/retained.bin`]).toEqual(
      recreatedStory.files[retainedStoryFile],
    );
    const retainedLinks = JSON.parse(Buffer.from(storyMerge.files[path(old.key)]?.data ?? '', 'base64').toString());
    expect(retainedLinks.plugins['story-linking'].blocks).toEqual([target.key, replacement]);
    expect(mergeData(boardBase, editedStory, recreatedStory, builtInPlugins)).toEqual(storyMerge);
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
    const read = (p: string) => JSON.parse(Buffer.from(result.files[p]?.data ?? '', 'base64').toString());
    expect(read(storyPath).customFields).toEqual({ kind: 'a', 'kind-2': 10 });
    const config = read(boardPath);
    expect(config.customFields.find((f: { key: string }) => f.key === 'new').required).toBe(false);
    expect(read(rootPath).customFields.map((f: { key: string }) => f.key)).toEqual(['kind', 'kind-2', 'new']);
    expect(result.decisions.some((d) => d.reason === 'incompatible Custom Field types retained separately')).toBe(true);
    expect(mergeData(base, right, left, [])).toEqual(result);
    const { builtInPlugins } = await import('../../src/plugins');
    for (const boardOverride of [false, true]) {
      const retainedStage = { key: 'task-only', name: 'Task only' };
      const rootConfig = {
        ...root,
        stages: boardOverride ? [{ key: 'global-only', name: 'Global only' }] : [retainedStage],
      };
      const boardConfig = { ...board, ...(boardOverride ? { stages: [retainedStage] } : {}) };
      const source = {
        id: 'stage-base',
        files: { [rootPath]: file(rootConfig), [boardPath]: file(boardConfig), [storyPath]: file(story) },
      };
      const task = {
        number: 1,
        name: 'Retained concurrent Task',
        description: '',
        stage: 'task-only',
        createdAt: story.createdAt,
        updatedAt: story.updatedAt,
      };
      const a = {
        id: 'stage-a',
        files: {
          ...source.files,
          [storyPath]: file({ ...story, plugins: { tasks: { nextNumber: 2, tasks: [task] } } }),
        },
      };
      const b = {
        id: 'stage-b',
        files: {
          ...source.files,
          [boardOverride ? boardPath : rootPath]: file({ ...(boardOverride ? boardConfig : rootConfig), stages: [] }),
        },
      };
      const merged = mergeData(source, a, b, builtInPlugins);
      const configPath = boardOverride ? boardPath : rootPath;
      expect(JSON.parse(Buffer.from(merged.files[configPath]?.data ?? '', 'base64').toString()).stages).toContainEqual(
        retainedStage,
      );
      if (boardOverride)
        expect(JSON.parse(Buffer.from(merged.files[rootPath]?.data ?? '', 'base64').toString())).toEqual(rootConfig);
      else
        expect(
          JSON.parse(Buffer.from(merged.files[boardPath]?.data ?? '', 'base64').toString()).stages,
        ).toBeUndefined();
      expect(merged.decisions.some((d) => d.reason.startsWith('restored effective Stage'))).toBe(true);
      expect(mergeData(source, b, a, builtInPlugins)).toEqual(merged);
    }
  });
});

// Real Git remotes are disposable and never point to the development origin.
describe('isolated upstream synchronization', () => {
  async function remoteFixture() {
    const f = await fixture();
    const { tempRoot } = await import('../helpers');
    const holder = await tempRoot();
    const remote = join(holder.dir, 'remote.git'),
      peer = join(holder.dir, 'peer');
    await command(holder.dir, 'init', '--bare', '--initial-branch=main', remote);
    await f.command('remote', 'add', 'origin', remote);
    await f.command('push', '-u', 'origin', 'main');
    await command(holder.dir, 'clone', remote, peer);
    await command(peer, 'config', 'user.name', 'Peer');
    await command(peer, 'config', 'user.email', 'peer@example.com');
    await configure(f.services.plugins.context('git'), { automaticCommits: false });
    const { requireRepository, withGitWorker } = await import('../../src/storage/gitRepository');
    const { synchronizeGit } = await import('../../src/storage/gitSync');
    const { mergeData } = await import('../../src/services/plugins/mergeData');
    const { builtInPlugins } = await import('../../src/plugins');
    const { coordinated } = await import('../../src/services/coordination');
    const repo = await requireRepository(f.t.root);
    const run = (
      phase: (name: string) => Promise<void> = async () => undefined,
      reconcile = mergeData,
      root = f.t.root,
    ) =>
      withGitWorker(repo, () =>
        synchronizeGit(
          repo,
          root,
          { automaticCommits: false, frequency: 'change', intervalSeconds: 300 },
          (read) => coordinated(root, 'sync test snapshot', read),
          (base, left, right) => reconcile(base, left, right, builtInPlugins),
          phase,
          async (files) => {
            mergeData(
              { id: 'validation', files },
              { id: 'validation', files },
              { id: 'validation', files },
              builtInPlugins,
            );
          },
        ),
      );
    return { ...f, remote, peer, repo, run };
  }
  it('publishes an isolated valid merge with later writes while preserving unrelated content, and blocks non-Rowbly conflicts and dirty overlap without live effects', async () => {
    const f = await remoteFixture();
    const alias = { ...f.t.root, path: join(f.peer, '..', 'external-root') };
    await symlink(f.t.path, alias.path, 'dir');
    const oldHead = await f.command('rev-parse', 'HEAD');
    const oldIndex = await readFile(f.repo.index);
    await expect(
      f.run(undefined, () => ({
        files: Object.fromEntries(
          Array.from({ length: 4097 }, (_, n) => [
            `plugins/unknown/${n}.bin`,
            { data: 'eA==', mode: '100644' as const },
          ]),
        ),
        remaps: [
          { source: 'left', boards: {}, stories: {} },
          { source: 'right', boards: {}, stories: {} },
        ],
        evidence: [],
        decisions: [],
      })),
    ).rejects.toThrow('bounded Data Root size');
    expect(await f.command('rev-parse', 'HEAD')).toBe(oldHead);
    expect(await readFile(f.repo.index)).toEqual(oldIndex);
    const abandoned = '0'.repeat(32);
    await mkdir(join(f.repo.gitDir, 'rowbly'), { recursive: true });
    await writeFile(join(f.repo.gitDir, 'rowbly', `candidate-${abandoned}`), 'abandoned private index');
    await f.command('update-ref', `refs/rowbly/fetched/${abandoned}`, 'HEAD');
    await writeFile(join(f.t.dir, 'staged.txt'), 'staged blob');
    await f.command('add', 'staged.txt');
    await writeFile(join(f.t.dir, 'staged.txt'), 'unstaged over staged');
    await writeFile(join(f.t.dir, 'untracked.txt'), 'untracked');
    const stage = await f.command('rev-parse', ':staged.txt');
    const story = await f.services.stories.create('web', { name: 'Dirty local capture', description: 'Local' });
    const boardFile = join(f.peer, '.rowbly/boards/web/board.config.json');
    const board = JSON.parse(await readFile(boardFile, 'utf8'));
    board.description = 'Peer Board';
    await writeFile(boardFile, JSON.stringify(board));
    await writeFile(join(f.peer, 'code.txt'), 'peer clean code\n');
    await command(f.peer, 'add', '.rowbly/boards/web/board.config.json', 'code.txt');
    await command(f.peer, 'commit', '-m', 'peer data and code');
    await command(f.peer, 'push');
    const storyPath = join(f.t.path, 'boards/web/stories', story.key, 'story.json');
    const validStoryBytes = await readFile(storyPath);
    const task = {
      number: 1,
      name: 'First duplicate Task',
      description: '',
      stage: 'backlog',
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
    };
    const comment = {
      id: 'duplicate-id',
      author: null,
      body: 'First current-format Comment',
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
    };
    const rootBytes = async () =>
      Object.fromEntries(
        await Promise.all(
          (await readdir(f.t.path, { recursive: true, withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map(async (entry) => [
              join(entry.parentPath, entry.name),
              await readFile(join(entry.parentPath, entry.name)),
            ]),
        ),
      );
    // Supported same-source duplicates must stop before publication, including while Tasks is Off.
    for (const plugins of [
      { tasks: { nextNumber: 2, tasks: [task, { ...task, name: 'Second duplicate Task distinct bytes' }] } },
      { comments: { comments: [comment, { ...comment, body: 'Second distinct current-format Comment' }] } },
    ]) {
      await writeFile(storyPath, `${JSON.stringify({ ...story, plugins }, null, 2)}\n`);
      const bytes = await rootBytes(),
        index = await readFile(f.repo.index),
        head = await f.command('rev-parse', 'HEAD');
      const branches = await f.command('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/');
      const upstream = await command(f.remote, 'rev-parse', 'refs/heads/main');
      await expect(f.run()).rejects.toThrow(/Cannot reconcile (Tasks|Comments).*duplicate/);
      expect(await rootBytes()).toEqual(bytes);
      expect(await readFile(f.repo.index)).toEqual(index);
      expect(await f.command('rev-parse', 'HEAD')).toBe(head);
      expect(await f.command('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/')).toBe(branches);
      expect(await command(f.remote, 'rev-parse', 'refs/heads/main')).toBe(upstream);
      expect(await f.command('rev-parse', ':staged.txt')).toBe(stage);
      expect(await readFile(join(f.t.dir, 'staged.txt'), 'utf8')).toBe('unstaged over staged');
      expect(await readFile(join(f.t.dir, 'untracked.txt'), 'utf8')).toBe('untracked');
      expect(await readFile(join(f.repo.gitDir, 'rowbly/publication.json')).catch(() => null)).toBeNull();
      expect(await readFile(join(f.repo.gitDir, 'MERGE_HEAD')).catch(() => null)).toBeNull();
      expect(await f.command('ls-files', '--unmerged')).toBe('');
    }
    await writeFile(storyPath, validStoryBytes);
    const held = deferred(),
      release = deferred();
    let first = true;
    const running = f.run(
      async (phase) => {
        if (phase === 'validating' && first) {
          first = false;
          held.resolve();
          await release.promise;
        }
      },
      undefined,
      alias,
    );
    try {
      await held.promise;
      expect((await f.services.stories.get(story.key)).name).toBe('Dirty local capture');
      const writer = fork(
        new URL('../storage/fixtures/syncConcurrentWriter.ts', import.meta.url),
        [f.t.path, story.key],
        {
          execArgv: ['--import', 'tsx'],
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        },
      );
      let writerErrors = '';
      writer.stderr?.on('data', (bytes) => {
        writerErrors += bytes.toString();
      });
      const written = new Promise<void>((resolve, reject) => {
        writer.once('message', () => resolve());
        writer.once('error', reject);
        writer.once('exit', (code) => {
          if (code !== 0) reject(new Error(writerErrors));
        });
      });
      const exited = new Promise<number | null>((resolve) => writer.once('exit', resolve));
      try {
        await written;
        expect((await f.services.stories.get(story.key)).name).toBe('Later accepted edit');
        release.resolve();
        expect(await exited, writerErrors).toBe(0);
      } finally {
        release.resolve();
        if (writer.exitCode === null) writer.kill('SIGKILL');
        await exited;
      }
      const result = await running;
      expect(await readGitPending(await pendingPath(f.t.root, 'git'))).toBeNull();
      expect(result.pushed).toBe(true);
      expect(await readdir(join(f.repo.gitDir, 'rowbly'))).not.toContain(`candidate-${abandoned}`);
      expect(await f.command('for-each-ref', '--format=%(refname)', 'refs/rowbly/fetched/')).toBe('');
      expect((await f.services.stories.get(story.key)).name).toBe('Later accepted edit');
      expect(await f.command('rev-parse', ':staged.txt')).toBe(stage);
      expect(await readFile(join(f.t.dir, 'staged.txt'), 'utf8')).toBe('unstaged over staged');
      expect(await readFile(join(f.t.dir, 'untracked.txt'), 'utf8')).toBe('untracked');
      expect(await readFile(join(f.t.dir, 'code.txt'), 'utf8')).toBe('peer clean code\n');
      expect(await f.command('ls-tree', '-r', '--name-only', 'HEAD')).not.toContain('staged.txt');
      await command(f.peer, 'pull', '--ff-only');
      expect(await readFile(join(f.peer, '.rowbly/boards/web/stories', story.key, 'story.json'), 'utf8')).toContain(
        'Later accepted edit',
      );
      expect((await f.services.doctor.check()).findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    } finally {
      release.resolve();
      await running.catch(() => undefined);
    }
    // Divergent code changes stop only the isolated merge, preserving live ref, index and bytes.
    await writeFile(join(f.t.dir, 'code.txt'), 'local committed code\n');
    await f.command('add', 'code.txt');
    await f.command('commit', '--only', '-m', 'local code', '--', 'code.txt');
    await writeFile(join(f.peer, 'code.txt'), 'remote conflicting code\n');
    await command(f.peer, 'commit', '-am', 'peer conflict');
    await command(f.peer, 'push');
    const before = await f.command('rev-parse', 'HEAD'),
      index = await readFile(f.repo.index);
    await expect(f.run()).rejects.toThrow('Non-Rowbly conflicts');
    expect(await f.command('rev-parse', 'HEAD')).toBe(before);
    expect(await readFile(f.repo.index)).toEqual(index);
    expect(await readFile(join(f.t.dir, 'code.txt'), 'utf8')).toBe('local committed code\n');
    expect(await f.command('ls-files', '--unmerged')).toBe('');
    expect(await readFile(join(f.repo.gitDir, 'MERGE_HEAD'), 'utf8').catch(() => null)).toBeNull();
    const overlap = await remoteFixture();
    await writeFile(join(overlap.peer, 'overlap.txt'), 'base bytes');
    await command(overlap.peer, 'add', 'overlap.txt');
    await command(overlap.peer, 'commit', '-m', 'base overlap');
    await command(overlap.peer, 'push');
    await overlap.run();
    await command(overlap.peer, 'pull', '--ff-only');
    await writeFile(join(overlap.t.dir, 'overlap.txt'), 'staged alternative');
    await overlap.command('add', 'overlap.txt');
    await writeFile(join(overlap.t.dir, 'overlap.txt'), 'base bytes');
    await writeFile(join(overlap.peer, 'overlap.txt'), 'incoming bytes');
    await command(overlap.peer, 'commit', '-am', 'incoming overlap');
    await command(overlap.peer, 'push');
    const protectedIndex = await readFile(overlap.repo.index),
      protectedHead = await overlap.command('rev-parse', 'HEAD');
    await expect(overlap.run()).rejects.toThrow('unrelated staged content');
    expect(await readFile(overlap.repo.index)).toEqual(protectedIndex);
    expect(await overlap.command('rev-parse', 'HEAD')).toBe(protectedHead);
    expect(await readFile(join(overlap.t.dir, 'overlap.txt'), 'utf8')).toBe('base bytes');
    await overlap.command('restore', '--staged', '--', 'overlap.txt');
    await writeFile(join(overlap.t.dir, 'overlap.txt'), 'dirty alternative');
    await expect(overlap.run()).rejects.toThrow('unrelated local content');
    expect(await readFile(join(overlap.t.dir, 'overlap.txt'), 'utf8')).toBe('dirty alternative');
    await writeFile(join(overlap.t.dir, 'overlap.txt'), 'base bytes');
    await writeFile(join(overlap.peer, 'incoming.txt'), 'new upstream file');
    await command(overlap.peer, 'add', 'incoming.txt');
    await command(overlap.peer, 'commit', '-m', 'incoming untracked overlap');
    await command(overlap.peer, 'push');
    await writeFile(join(overlap.t.dir, 'incoming.txt'), 'protected untracked bytes');
    const untrackedIndex = await readFile(overlap.repo.index);
    await expect(overlap.run()).rejects.toThrow('incoming.txt');
    expect(await overlap.command('rev-parse', 'HEAD')).toBe(protectedHead);
    expect(await readFile(overlap.repo.index)).toEqual(untrackedIndex);
    expect(await readFile(join(overlap.t.dir, 'incoming.txt'), 'utf8')).toBe('protected untracked bytes');
    overlap.host.dispose?.();
  });

  it('keeps a locally published merge after rejected or lost-response push, then fetches the advanced upstream and retries normally', async () => {
    const f = await remoteFixture();
    const hook = join(f.remote, 'hooks/pre-receive');
    await writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const story = await f.services.stories.create('web', { name: 'Saved despite rejection' });
    await expect(f.run()).rejects.toThrow('push');
    const local = await f.command('rev-parse', 'HEAD');
    expect(await f.command('show', `HEAD:.rowbly/boards/web/stories/${story.key}/story.json`)).toContain(
      'Saved despite rejection',
    );
    const { rm } = await import('node:fs/promises');
    await rm(hook);
    await writeFile(join(f.peer, 'peer.txt'), 'advance after rejection');
    await command(f.peer, 'add', 'peer.txt');
    await command(f.peer, 'commit', '-m', 'advance');
    await command(f.peer, 'push');
    const result = await f.run();
    expect(result.pushed).toBe(true);
    expect(await f.command('merge-base', '--is-ancestor', local, 'HEAD')).toBe('');
    // Simulate response loss after server accepted, through the actual host Git execution seam.
    const process = await import('../../src/storage/gitProcess');
    const original = process.gitText;
    let lost = false;
    const spy = vi.spyOn(process, 'gitText').mockImplementation(async (cwd, args, options) => {
      const value = await original(cwd, args, options);
      if (args[0] === 'push' && !lost) {
        lost = true;
        throw new Error('push response lost after acceptance');
      }
      return value;
    });
    try {
      await f.services.stories.update(story.key, { name: 'Accepted with lost response' });
      await expect(f.run()).rejects.toThrow('response lost');
    } finally {
      spy.mockRestore();
    }
    const accepted = await f.command('rev-parse', 'HEAD');
    expect((await f.run()).commit).toBe(accepted);
    await command(f.peer, 'pull', '--ff-only');
    expect(await readFile(join(f.peer, '.rowbly/boards/web/stories', story.key, 'story.json'), 'utf8')).toContain(
      'Accepted with lost response',
    );
    expect((await f.services.doctor.check()).findings.filter((finding) => finding.severity === 'error')).toEqual([]);
  });
  it('rebases a rejected two-parent merge without losing its resolution, descendant owner edits or pending bytes', async () => {
    const { tempRoot } = await import('../helpers');
    const home = await tempRoot();
    vi.stubEnv('HOME', home.dir);
    try {
      const f = await remoteFixture();
      const { builtInPlugins } = await import('../../src/plugins');
      const { mergeData, evidenceSource } = await import('../../src/services/plugins/mergeData');
      const { createReplayHistory } = await import('../../src/services/plugins/replayHistory');
      const { synchronizeGitRebase } = await import('../../src/storage/gitRebaseSync');
      const { withGitWorker } = await import('../../src/storage/gitRepository');
      const { coordinated } = await import('../../src/services/coordination');
      const story = await f.services.stories.create('web', { name: 'Base' });
      const path = `.rowbly/boards/web/stories/${story.key}/story.json`;
      const save = async (cwd: string, value: unknown) =>
        writeFile(join(cwd, path), `${JSON.stringify(value, null, 2)}\n`);
      const read = async (cwd: string) => JSON.parse(await readFile(join(cwd, path), 'utf8'));
      await f.command('add', '.rowbly');
      await f.command('commit', '-m', 'base Story');
      await f.command('push');
      await command(f.peer, 'pull', '--ff-only');
      const base = await read(f.t.dir);
      const task = (name: string) => ({
        number: 1,
        name,
        description: '',
        stage: 'backlog',
        createdAt: story.createdAt,
        updatedAt: story.updatedAt,
      });
      const comment = (body: string) => ({
        id: 'same',
        body,
        author: null,
        createdAt: story.createdAt,
        updatedAt: story.updatedAt,
      });
      await save(f.t.dir, {
        ...base,
        plugins: { tasks: { nextNumber: 2, tasks: [task('local')] }, comments: { comments: [comment('local')] } },
      });
      const originalBytes = await readFile(join(f.t.dir, path));
      await f.command('add', '.rowbly');
      await f.command('commit', '-m', 'local identities');
      const first = await f.command('rev-parse', 'HEAD');
      await save(f.peer, {
        ...base,
        plugins: { tasks: { nextNumber: 2, tasks: [task('remote')] }, comments: { comments: [comment('remote')] } },
      });
      await command(f.peer, 'add', '.rowbly');
      await command(f.peer, 'commit', '-m', 'remote identities');
      await command(f.peer, 'push');
      const hook = join(f.remote, 'hooks/pre-receive');
      await writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      try {
        await expect(f.run()).rejects.toThrow('push');
      } finally {
        await rm(hook);
      }
      const parents = (await f.command('show', '-s', '--format=%P', 'HEAD')).split(' ');
      expect(parents).toHaveLength(2);
      expect(parents[0]).toBe(first);
      const resolved = await read(f.t.dir);
      resolved.description = 'resolution only\n';
      await save(f.t.dir, resolved);
      await f.command('add', '.rowbly');
      const editedMerge = await f.command(
        'commit-tree',
        await f.command('write-tree'),
        ...parents.flatMap((id) => ['-p', id]),
        '-m',
        'resolved merge',
      );
      await f.command('update-ref', 'refs/heads/main', editedMerge);
      const later = await read(f.t.dir);
      later.plugins.tasks.tasks.find((value: { name: string }) => value.name === 'local').name = 'later';
      later.plugins.comments.comments.find((value: { body: string }) => value.body === 'local').body = 'later';
      await save(f.t.dir, later);
      await f.command('add', '.rowbly');
      await f.command('commit', '-m', 'descendant edits');
      const old = await f.command('rev-parse', 'HEAD');
      const advanced = await read(f.peer);
      advanced.name = 'New upstream';
      await save(f.peer, advanced);
      await command(f.peer, 'add', '.rowbly');
      await command(f.peer, 'commit', '-m', 'advance upstream');
      await command(f.peer, 'push');
      const upstream = await command(f.peer, 'rev-parse', 'HEAD');
      const pending = await read(f.t.dir);
      pending.plugins.tasks.tasks.find((value: { name: string }) => value.name === 'later').name = 'pending';
      pending.plugins.comments.comments.find((value: { body: string }) => value.body === 'later').body = 'pending';
      await save(f.t.dir, pending);
      const phases: string[] = [];
      let finalMergeChecked = false;
      const run = () =>
        withGitWorker(f.repo, () =>
          synchronizeGitRebase(
            f.repo,
            f.t.root,
            { automaticCommits: false, frequency: 'change', intervalSeconds: 300 },
            (read) => coordinated(f.t.root, 'rebase regression capture', read),
            (history) => {
              const replay = createReplayHistory(history, builtInPlugins);
              let finalMerge: ReturnType<typeof createReplayHistory> | undefined;
              return {
                async replay(step, current) {
                  finalMerge ??= createReplayHistory(
                    { ...history, old: await history.read(editedMerge) },
                    builtInPlugins,
                  );
                  if (step.base === editedMerge) {
                    // The same captured graph, ending at its merge with descendant edits treated as pending.
                    const pendingId = 'pending:final-merge-regression';
                    const result = await finalMerge.finish(current, {
                      id: pendingId,
                      files: (await history.read(old)).files,
                    });
                    const proof = Object.entries(result.files)
                      .filter(([path]) => result.evidence.includes(path))
                      .map(([, file]) => JSON.parse(Buffer.from(file.data, 'base64').toString()))
                      .find((proof) => proof.kind === 'replay' && proof.original.commit.id === pendingId);
                    expect(proof.original.current).toEqual(evidenceSource(current));
                    expect(proof.projected.current.files).not.toEqual(proof.original.current.files);
                    finalMergeChecked = true;
                  } else await finalMerge.replay(step, current);
                  return replay.replay(step, current);
                },
                finish: (current, pending) => replay.finish(current, pending),
              };
            },
            async (phase) => {
              phases.push(phase);
            },
            async (files) => {
              mergeData(
                { id: 'validation', files },
                { id: 'validation', files },
                { id: 'validation', files },
                builtInPlugins,
              );
            },
          ),
        );
      const result = await run();
      expect(result.pushed).toBe(true);
      expect(finalMergeChecked).toBe(true);
      const final = await read(f.t.dir);
      expect(final).toMatchObject({ name: 'New upstream', description: 'resolution only\n' });
      expect(final.plugins.tasks.tasks.map((value: { name: string }) => value.name).sort()).toEqual([
        'pending',
        'remote',
      ]);
      expect(final.plugins.comments.comments.map((value: { body: string }) => value.body).sort()).toEqual([
        'pending',
        'remote',
      ]);
      expect(await command(f.remote, 'rev-parse', 'refs/heads/main')).toBe(result.commit);
      expect(await f.command('merge-base', '--is-ancestor', upstream, result.commit)).toBe('');
      await expect(f.command('merge-base', '--is-ancestor', old, result.commit)).rejects.toThrow();
      const proofs = await Promise.all(
        result.evidence.map(async (path) => JSON.parse(await readFile(join(f.t.path, path), 'utf8'))),
      );
      expect(proofs.some((proof) => proof.mergeOverlay?.committed.id === editedMerge)).toBe(true);
      const replay = proofs.find((proof) => proof.kind === 'replay' && proof.original.commit.id === first);
      expect(Buffer.from(replay.original.commit.files[path.slice(8)].data, 'base64')).toEqual(originalBytes);
      expect(phases.indexOf('pulling')).toBeLessThan(phases.indexOf('preparing'));
      const noop = await run();
      expect(noop.commit).toBe(result.commit);
      expect(noop.evidence).toEqual([]);
      expect((await readdir(join(f.repo.gitDir, 'rowbly'))).some((name) => name.startsWith('rebase-'))).toBe(false);
      expect((await preferences(f.services.plugins.context('git'))).automaticCommits).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('queues one exact cross-process manual receipt after an automatic run and waits for its push while retaining later edits', async () => {
    const { tempRoot } = await import('../helpers');
    const home = await tempRoot();
    vi.stubEnv('HOME', home.dir);
    const f = await remoteFixture(),
      plugin = f.services.plugins.context('git');
    const { createGitSync, disposeSyncOwner, drainSyncQueue } = await import('../../src/services/plugins/gitSync');
    const storage = await import('../../src/storage/gitSync');
    const owner = {},
      sync = createGitSync(f.t.root, 'git', [git, comments], f.ctx.warn, owner);
    const returned = deferred(),
      releaseAutomatic = deferred(),
      pushing = deferred();
    const original = storage.synchronizeGit;
    const spy = vi.spyOn(storage, 'synchronizeGit').mockImplementation(async (...args) => {
      const result = await original(...args);
      returned.resolve();
      await releaseAutomatic.promise;
      return result;
    });
    const socketPath = join(home.dir, 'push.sock');
    let connection: Socket | undefined;
    const server = createServer((socket) => {
      connection = socket;
      pushing.resolve();
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const children: {
      child: ReturnType<typeof fork>;
      exited: Promise<number | null>;
      errors: () => string;
      pending: Promise<string>;
      result: Promise<{ id: string; pushed: boolean; commit: string }>;
    }[] = [];
    let automatic: Promise<unknown> | undefined;
    try {
      await configure(plugin, { synchronization: { enabled: true, intervalSeconds: 3600 } });
      automatic = sync.requestSync(resolveSyncOptions);
      await returned.promise;
      const automaticId = (await sync.syncStatus(resolveSyncOptions)).active?.id;
      f.ctx.backgroundReactions = true;
      const story = await f.services.stories.create('web', { name: 'Manual capture' });
      await f.command(
        'config',
        'remote.origin.receivepack',
        `${process.execPath} ${fileURLToPath(new URL('./fixtures/pushBarrier.mjs', import.meta.url))} ${socketPath}`,
      );
      for (const name of ['manual-a', 'manual-b']) {
        const path = join(home.dir, name);
        await symlink(f.t.path, path, 'dir');
        const child = fork(new URL('./fixtures/manualSyncProcess.ts', import.meta.url), [path], {
          execArgv: ['--import', 'tsx'],
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        });
        let errors = '';
        child.stderr?.on('data', (bytes) => {
          errors += bytes.toString();
        });
        const pending = deferred<string>(),
          result = deferred<{ id: string; pushed: boolean; commit: string }>();
        child.on('message', (message: unknown) => {
          const value = message as { pending?: string; result?: { id: string; pushed: boolean; commit: string } };
          if (value.pending) pending.resolve(value.pending);
          if (value.result) result.resolve(value.result);
        });
        const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
        const failure = exited.then((code) => {
          throw new Error(`Manual requester exited before its response (${code}): ${errors}`);
        });
        void failure.catch(() => undefined);
        children.push({
          child,
          exited,
          errors: () => errors,
          pending: Promise.race([pending.promise, failure]),
          result: Promise.race([result.promise, failure]),
        });
        await children[children.length - 1]?.pending;
      }
      const ids = await Promise.all(children.map((child) => child.pending));
      expect(ids[0]).toBe(ids[1]);
      expect(ids[0]).not.toBe(automaticId);
      const completed: unknown[] = [];
      for (const child of children) void child.result.then((value) => completed.push(value));
      releaseAutomatic.resolve();
      await automatic;
      await pushing.promise;
      expect(completed).toEqual([]);
      const state = await sync.syncStatus(resolveSyncOptions);
      expect(state.active).toMatchObject({ id: ids[0], mode: 'rebase', phase: 'pushing' });
      expect(state.last?.id).toBe(automaticId);
      // Admission authorizes this push, but does not authorize clearing a subsequent same-path edit.
      await f.services.stories.update(story.key, { name: 'Later same-path edit' });
      await configure(plugin, { synchronization: { enabled: false } });
      await f.services.plugins.disable('git');
      connection?.end();
      const results = await Promise.all(children.map((child) => child.result));
      const result = results[0];
      if (!result) throw new Error('Expected manual result');
      expect(result).toEqual(results[1]);
      expect(results[0]).toMatchObject({ id: ids[0], pushed: true });
      expect(await command(f.remote, 'rev-parse', 'refs/heads/main')).toBe(result.commit);
      const remoteStory = await command(f.remote, 'show', `main:.rowbly/boards/web/stories/${story.key}/story.json`);
      expect(JSON.parse(remoteStory).name).toBe('Manual capture');
      expect((await f.services.stories.get(story.key)).name).toBe('Later same-path edit');
      expect(await readGitPending(await pendingPath(f.t.root, 'git'))).not.toBeNull();
      for (const child of children) expect(await child.exited, child.errors()).toBe(0);
      await drainSyncQueue(f.t.root);
      const finished = await sync.syncStatus(resolveSyncOptions);
      expect(finished.last).toMatchObject({ id: ids[0], mode: 'rebase', kind: 'synchronized', pushed: true });
      expect(finished.manualAvailable).toBe(false);
      await expect(sync.requestRebaseSync(resolveSyncOptions)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      releaseAutomatic.resolve();
      connection?.end();
      for (const child of children) {
        if (child.child.exitCode === null) child.child.kill('SIGKILL');
        await child.exited;
      }
      await automatic;
      await drainSyncQueue(f.t.root);
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      disposeSyncOwner(owner);
      f.host.dispose?.();
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it('runs a real interval without pending data, coalesces requests and lets one admitted run finish after saved Off while stale callbacks stay paused', async () => {
    const f = await remoteFixture(),
      plugin = f.services.plugins.context('git');
    const storage = await import('../../src/storage/gitSync');
    const { createGitSync, disposeSyncOwner } = await import('../../src/services/plugins/gitSync');
    const aliasA = { ...f.t.root, path: join(f.peer, '..', 'alias-a') },
      aliasB = { ...f.t.root, path: join(f.peer, '..', 'alias-b') },
      ownerA = {},
      ownerB = {};
    await symlink(f.t.path, aliasA.path, 'dir');
    await symlink(f.t.path, aliasB.path, 'dir');
    const a = createGitSync(aliasA, 'git', [git, comments], f.ctx.warn, ownerA),
      b = createGitSync(aliasB, 'git', [git, comments], f.ctx.warn, ownerB);
    const { drainGitQueue } = await import('../../src/services/plugins/git');
    const original = storage.synchronizeGit;
    const spy = vi.spyOn(storage, 'synchronizeGit');
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const held = deferred(),
      release = deferred();
    let hold = false;
    spy.mockImplementation(async (...args) => {
      if (hold) {
        held.resolve();
        await release.promise;
      }
      return original(...args);
    });
    try {
      const repository = await import('../../src/storage/gitRepository');
      const worker = repository.withGitWorker;
      let refuseAdmission = true;
      const admission = vi.spyOn(repository, 'withGitWorker').mockImplementation(async (...args) => {
        if (refuseAdmission) {
          refuseAdmission = false;
          throw new Error('controlled common worker lock timeout');
        }
        return worker(...args);
      });
      try {
        await configure(plugin, { synchronization: { enabled: true, intervalSeconds: 1 } });
        await vi.waitFor(
          async () => {
            const failed = await plugin.git.syncStatus(resolveSyncOptions);
            expect(failed.last?.kind).toBe('failed');
            expect(failed.last?.message).toContain('controlled common worker lock timeout');
            expect(failed.nextDue).toBeGreaterThan(failed.last?.finishedAt ?? 0);
          },
          { timeout: 5000 },
        );
        await vi.waitFor(
          async () => expect((await plugin.git.syncStatus(resolveSyncOptions)).last?.kind).toBe('synchronized'),
          { timeout: 5000 },
        );
      } finally {
        admission.mockRestore();
      }
      const stale = timers.mock.calls.find(([, ms]) => typeof ms === 'number' && ms > 900 && ms <= 1000)?.[0];
      expect(stale).toBeTypeOf('function');
      await vi.waitFor(
        async () => expect((await plugin.git.syncStatus(resolveSyncOptions)).last?.kind).toBe('synchronized'),
        { timeout: 5000 },
      );
      expect(spy).toHaveBeenCalledTimes(1);
      await configure(plugin, { synchronization: { intervalSeconds: 3600 } });
      const deadline = await plugin.git.syncStatus(resolveSyncOptions);
      expect(deadline.nextDue).toBe((deadline.anchor ?? 0) + 3_600_000);
      await a.resumeSync(resolveSyncOptions);
      await b.resumeSync(resolveSyncOptions);
      expect(await a.syncStatus(resolveSyncOptions)).toEqual(deadline);
      expect(await b.syncStatus(resolveSyncOptions)).toEqual(deadline);
      expect(
        (await readdir(join(f.repo.gitDir, 'rowbly'))).filter((name) => name.startsWith('sync-git-')),
      ).toHaveLength(1);
      hold = true;
      const first = a.requestSync(resolveSyncOptions);
      await held.promise;
      const coalesced = await b.requestSync(resolveSyncOptions);
      expect(coalesced.active?.phase).toBe('admitted');
      expect(await plugin.git.syncStatus(resolveSyncOptions)).toEqual(coalesced);
      if (typeof stale === 'function') stale();
      f.ctx.backgroundReactions = true;
      await configure(plugin, { synchronization: { enabled: false } });
      const story = await f.services.stories.create('web', { name: 'Saved while admitted sync waits' });
      expect((await f.services.stories.get(story.key)).name).toBe('Saved while admitted sync waits');
      f.host.dispose?.();
      disposeSyncOwner(ownerA);
      disposeSyncOwner(ownerB);
      const drained = [false, false, false];
      const draining = [f.t.root, aliasA, aliasB].map((root, n) =>
        drainGitQueue(root).then(() => {
          drained[n] = true;
        }),
      );
      expect((await plugin.git.syncStatus(resolveSyncOptions)).active?.id).toBe(coalesced.active?.id);
      expect(drained).toEqual([false, false, false]);
      release.resolve();
      expect((await first).last?.kind).toBe('synchronized');
      await Promise.all(draining);
      expect(drained).toEqual([true, true, true]);
      expect(spy).toHaveBeenCalledTimes(2);
      expect((await plugin.git.syncStatus(resolveSyncOptions)).enabled).toBe(false);
      if (typeof stale === 'function') stale();
      await drainGitQueue(f.t.root);
      expect(spy).toHaveBeenCalledTimes(2);
      await command(f.peer, 'pull', '--ff-only');
      expect(await readFile(join(f.peer, '.rowbly/boards/web/stories', story.key, 'story.json'), 'utf8')).toContain(
        'Saved while admitted sync waits',
      );
    } finally {
      release.resolve();
      await drainGitQueue(f.t.root);
      f.host.dispose?.();
      disposeSyncOwner(ownerA);
      disposeSyncOwner(ownerB);
      spy.mockRestore();
      timers.mockRestore();
    }
  });

  it('keeps persisted future deadlines on reload, resumes one overdue attempt, and admits no stale timer/start while saved Off', async () => {
    const f = await remoteFixture(),
      plugin = f.services.plugins.context('git');
    const { rootGitKey } = await import('../../src/storage/gitRepository');
    const { readSyncState, writeSyncState } = await import('../../src/storage/gitSyncState');
    const storage = await import('../../src/storage/gitSync');
    const spy = vi.spyOn(storage, 'synchronizeGit');
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const hosts = [f.host];
    const stateFile = join(f.repo.gitDir, 'rowbly', `sync-git-${rootGitKey(f.t.root)}.json`);
    try {
      await configure(plugin, { synchronization: { enabled: true, intervalSeconds: 3600 } });
      const scheduled = timers.mock.calls.find(([, ms]) => typeof ms === 'number' && ms > 3_500_000)?.[0];
      const repository = await import('../../src/storage/gitRepository');
      const { createGitSync, disposeSyncOwner } = await import('../../src/services/plugins/gitSync');
      const aliasA = { ...f.t.root, path: join(f.peer, '..', 'reload-alias-a') },
        aliasB = { ...f.t.root, path: join(f.peer, '..', 'reload-alias-b') };
      await symlink(f.t.path, aliasA.path, 'dir');
      await symlink(f.t.path, aliasB.path, 'dir');
      const ownerA = {},
        ownerB = {},
        locationEntered = deferred(),
        locationRelease = deferred();
      const locate = repository.requireRepository;
      let pausedLocation = true;
      const locating = vi.spyOn(repository, 'requireRepository').mockImplementation(async (root) => {
        if (pausedLocation) {
          pausedLocation = false;
          locationEntered.resolve();
          await locationRelease.promise;
        }
        return locate(root);
      });
      const a = createGitSync(aliasA, 'git', [git, comments], f.ctx.warn, ownerA);
      const b = createGitSync(aliasB, 'git', [git, comments], f.ctx.warn, ownerB);
      const staleSetup = a.resumeSync(resolveSyncOptions);
      try {
        await locationEntered.promise;
        disposeSyncOwner(ownerA);
        await b.resumeSync(resolveSyncOptions);
        const currentTimer = timers.mock.results.at(-1)?.value;
        const clearing = vi.spyOn(globalThis, 'clearTimeout');
        try {
          locationRelease.resolve();
          await staleSetup;
          expect(clearing).not.toHaveBeenCalledWith(currentTimer);
          expect((await b.syncStatus(resolveSyncOptions)).enabled).toBe(true);
        } finally {
          clearing.mockRestore();
        }
      } finally {
        locationRelease.resolve();
        await staleSetup;
        locating.mockRestore();
        disposeSyncOwner(ownerB);
      }
      const first = await readSyncState(stateFile);
      if (!first) throw new Error('Expected persisted synchronization deadline');
      // Deliberately reproduce an old lexical filename; it is never an authoritative identity.
      const { createHash } = await import('node:crypto');
      const legacyFile = join(
        f.repo.gitDir,
        'rowbly',
        `sync-git-${createHash('sha256').update(aliasA.path).digest('hex').slice(0, 20)}.json`,
      );
      await writeSyncState(legacyFile, {
        ...first,
        anchor: 0,
        nextDue: 0,
        requested: 'old-alias-request',
        active: {
          id: 'old-alias-active',
          pid: process.pid,
          host: 'unverified-old-host',
          startedAt: 0,
          phase: 'fetching',
        },
      });
      const legacy = await readFile(legacyFile, 'utf8');
      const ownerC = {},
        c = createGitSync(aliasA, 'git', [git, comments], f.ctx.warn, ownerC);
      try {
        await c.resumeSync(resolveSyncOptions);
        expect(await readSyncState(stateFile)).toEqual(first);
        expect(await c.syncStatus(resolveSyncOptions)).toEqual(await plugin.git.syncStatus(resolveSyncOptions));
        await rm(stateFile);
        const initializedAfter = Date.now();
        await c.resumeSync(resolveSyncOptions);
        const initialized = await readSyncState(stateFile);
        expect(initialized?.anchor).toBeGreaterThanOrEqual(initializedAfter);
        expect(initialized?.nextDue).toBe((initialized?.anchor ?? 0) + 3_600_000);
        expect(initialized?.requested).toBeUndefined();
        expect(initialized?.active).toBeUndefined();
        await c.resumeSync(resolveSyncOptions);
        expect(await readSyncState(stateFile)).toEqual(initialized);
        expect(await readFile(legacyFile, 'utf8')).toBe(legacy);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        disposeSyncOwner(ownerC);
      }
      const canonical = await readSyncState(stateFile);
      hosts.push((await withPlugins(f.t, [git, comments])).host);
      expect((await readSyncState(stateFile))?.nextDue).toBe(canonical?.nextDue);
      await configure(plugin, { synchronization: { enabled: false, intervalSeconds: 7200 } });
      const off = await readSyncState(stateFile);
      if (!off) throw new Error('Expected saved deadline');
      const anchor = Date.now() - 7_200_001;
      await writeSyncState(stateFile, { ...off, anchor, nextDue: anchor + 7_200_000 });
      hosts.push((await withPlugins(f.t, [git, comments])).host);
      if (typeof scheduled === 'function') scheduled();
      await drainGitQueue(f.t.root);
      expect(spy).not.toHaveBeenCalled();
      // Reopening a persisted enabled bag is independent of a configure reaction.
      const localFile = join(f.t.path, 'local.json'),
        local = JSON.parse(await readFile(localFile, 'utf8'));
      local.plugins.git.synchronization.enabled = true;
      await writeFile(localFile, JSON.stringify(local));
      hosts.push((await withPlugins(f.t, [git, comments])).host);
      await drainGitQueue(f.t.root);
      expect(spy).toHaveBeenCalledTimes(1);
      const completed = await readSyncState(stateFile);
      expect(completed?.last?.kind).toBe('synchronized');
      expect(completed?.nextDue).toBe((completed?.anchor ?? 0) + 7_200_000);
      hosts.push((await withPlugins(f.t, [git, comments])).host);
      expect((await readSyncState(stateFile))?.nextDue).toBe(completed?.nextDue);
      expect(spy).toHaveBeenCalledTimes(1);
      const callback = timers.mock.calls.findLast(([, ms]) => typeof ms === 'number' && ms > 7_000_000)?.[0];
      expect(callback).toBeTypeOf('function');
      await f.command('checkout', '-b', 'another');
      await f.command('branch', '--set-upstream-to=origin/main');
      if (typeof callback === 'function') callback();
      await drainGitQueue(f.t.root);
      const changedBranch = await readSyncState(stateFile);
      expect(changedBranch?.last?.kind).toBe('failed');
      expect(changedBranch?.last?.message).toContain('changed since scheduling');
      expect(changedBranch?.target?.branch).toBe('refs/heads/another');
      expect(changedBranch?.nextDue).toBeGreaterThan(Date.now());
      expect(spy).toHaveBeenCalledTimes(1);
      await f.command('checkout', 'main');
      expect((await preferences(plugin)).automaticCommits).toBe(false);
    } finally {
      for (const host of hosts) host.dispose?.();
      await drainGitQueue(f.t.root);
      spy.mockRestore();
      timers.mockRestore();
    }
  });
});
