import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../helpers';
import { pluginRoot } from './helpers';

it('refuses activation outside Git with a clear error and leaves it off', async () => {
  const t = await pluginRoot();
  const result = await runCli(['plugins', 'enable', 'git', '--json'], { root: t.path });
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain('inside a Git repository');
  expect(JSON.parse(await readFile(join(t.path, 'rowbly.config.json'), 'utf8')).plugins.git).toBeUndefined();
});

describe('Git Plugin CLI workflow', () => {
  it('uses the Data Root repository from another cwd, configures preferences and commits saved changes', async () => {
    const t = await pluginRoot();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: t.dir, encoding: 'utf8' }).trim();
    git('init', '-b', 'main');
    git('config', 'user.name', 'Git Default');
    git('config', 'user.email', 'default@example.com');
    await writeFile(join(t.path, '.gitignore'), 'local.json\n.lock\n.txn/\n');
    git('add', '.');
    git('commit', '-m', 'initial');
    const cli = (...args: string[]) => runCli([...args, '--json', '--no-prompt'], { root: t.path });
    expect((await cli('plugins', 'enable', 'git')).exitCode).toBe(0);
    expect(JSON.parse((await cli('git', 'show')).stdout)).toMatchObject({
      frequency: 'change',
      intervalSeconds: 300,
      defaults: { authorName: 'Git Default' },
    });
    const configured = await cli(
      'git',
      'configure',
      '--automatic-merge-resolution',
      'off',
      '--merge-interval',
      '900',
      '--frequency',
      'interval',
      '--interval',
      '3600',
      '--author-name',
      'Robot',
      '--author-email',
      'robot@example.com',
    );
    expect(configured.exitCode).toBe(0);
    expect(JSON.parse(configured.stdout)).toMatchObject({
      frequency: 'interval',
      intervalSeconds: 3600,
      synchronization: { enabled: false, intervalSeconds: 900 },
    });
    expect((await cli('git', 'configure', '--interval', '0')).exitCode).toBe(2);
    expect((await cli('git', 'configure', '--author-email', 'bad')).exitCode).toBe(2);
    const initial = git('rev-parse', 'HEAD');
    expect((await cli('stories', 'create', '--board', 'web', '--name', 'CLI Story')).exitCode).toBe(0);
    expect(git('rev-parse', 'HEAD')).toBe(initial);
    expect((await cli('git', 'configure', '--frequency', 'change')).exitCode).toBe(0);
    expect(git('log', '-1', '--format=%s|%an|%ae')).toBe('chore: update Rowbly data|Robot|robot@example.com');
    expect((await cli('git', 'configure', '--author-name', '', '--author-email', '')).exitCode).toBe(0);
    const shown = JSON.parse((await cli('git', 'show')).stdout);
    expect(shown.authorName).toBeUndefined();
    expect(shown.synchronizationRun).toMatchObject({ enabled: false, intervalSeconds: 900 });
    expect(git('ls-files', '--', '.rowbly/local.json')).toBe('');
    git('remote', 'add', 'origin', join(t.dir, 'unavailable-remote.git'));
    git('config', 'branch.main.remote', 'origin');
    git('config', 'branch.main.merge', 'refs/heads/main');
    expect((await cli('git', 'configure', '--automatic-merge-resolution', 'on')).exitCode).toBe(0);
    const failed = await cli('git', 'sync');
    expect(failed.exitCode).toBe(4);
    expect(failed.stdout).toBe('');
    const reports = failed.stderr
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(reports.filter((report) => report.error)).toMatchObject([
      {
        error: {
          code: 'CONFLICT',
          details: {
            synchronizationRun: {
              enabled: true,
              last: { kind: 'failed', commit: git('rev-parse', 'HEAD'), evidence: [] },
            },
          },
        },
      },
    ]);
  });
});
