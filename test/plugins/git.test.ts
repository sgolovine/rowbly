import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { comments } from '../../src/plugins/comments';
import { addComment } from '../../src/plugins/comments/comments';
import { git } from '../../src/plugins/git';
import { configure } from '../../src/plugins/git/model';
import { pendingPath, readGitPending } from '../../src/storage/git';
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
    expect(await f.command('rev-parse', 'HEAD')).not.toBe(initial);
    expect(await readGitPending(pendingFile)).toBeNull();
    const committed = await f.command('rev-parse', 'HEAD');
    await f.services.stories.update(story.key, { name: 'Second' });
    await plugin.git.resume({ frequency: 'change', intervalSeconds: 1 });
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
    expect(await f.command('show', `HEAD:${path.slice(f.t.dir.length + 1)}`)).toContain('Saved');
  });
});
