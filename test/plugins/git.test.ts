import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { definePlugin } from '../../src/plugin-api';
import { comments } from '../../src/plugins/comments';
import { addComment } from '../../src/plugins/comments/comments';
import { git } from '../../src/plugins/git';
import { configure } from '../../src/plugins/git/model';
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
    await configure(plugin, { frequency: 'interval', intervalSeconds: 3600 });
    const initial = await f.command('rev-parse', 'HEAD');
    const story = await f.services.stories.create('web', { name: 'First' });
    const pendingFile = await pendingPath(f.t.root, 'git');
    const first = await readGitPending(pendingFile);
    await f.services.stories.update(story.key, { name: 'Second' });
    expect((await readGitPending(pendingFile))?.due).toBe(first?.due);
    expect(await f.command('rev-parse', 'HEAD')).toBe(initial);
    await writeFile(pendingFile, JSON.stringify({ ...first, due: Date.now() - 1 }));
    await withPlugins(f.t, [git, comments]);
    await drainGitQueue(f.t.root);
    expect(await f.command('rev-parse', 'HEAD')).not.toBe(initial);
    expect(await readGitPending(pendingFile)).toBeNull();
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
  it('runs a due timer with the latest persisted author and stops timers when disabled', async () => {
    const f = await fixture();
    const plugin = f.services.plugins.context('git');
    await configure(plugin, { frequency: 'interval', intervalSeconds: 3600 });
    const timers = vi.spyOn(globalThis, 'setTimeout');
    await f.services.stories.create('web', { name: 'Pending' });
    const scheduled = timers.mock.calls.find(([, ms]) => typeof ms === 'number' && ms > 3_500_000)?.[0];
    expect(scheduled).toBeTypeOf('function');
    const file = await pendingPath(f.t.root, 'git');
    const pending = await readGitPending(file);
    await writeFile(
      file,
      JSON.stringify({
        ...pending,
        due: Date.now() - 1,
        options: {
          frequency: 'interval',
          intervalSeconds: 3600,
          authorName: 'Latest',
          authorEmail: 'latest@example.com',
        },
      }),
    );
    if (typeof scheduled === 'function') scheduled();
    await vi.waitFor(async () => expect(await readGitPending(file)).toBeNull());
    expect(await f.command('log', '-1', '--format=%an')).toBe('Latest');

    await f.services.stories.create('web', { name: 'Paused' });
    const before = await f.command('rev-parse', 'HEAD');
    await f.services.plugins.disable('git');
    await plugin.git.resume({ frequency: 'change', intervalSeconds: 3600 });
    await drainGitQueue(f.t.root);
    expect(await f.command('rev-parse', 'HEAD')).toBe(before);
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

  it('keeps reads and edits live during queued Git work and retains same-path edits after a snapshot', async () => {
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
      release.resolve();
      await drainGitQueue(f.t.root);
      const path = `.rowbly/boards/web/stories/${story.key}/story.json`;
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
