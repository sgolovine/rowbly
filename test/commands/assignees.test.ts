import { describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/storage';
import { makeBoard, makeRootConfig, makeStory, runCli, tempRoot } from '../helpers';

describe('rowbly assignees', () => {
  it('add, assign to a Story, remove: warns "removed from 1 story" and the Story no longer lists the handle', async () => {
    const t = await tempRoot();
    const added = await runCli(['assignees', 'add', 'sam', '--name', 'Sam'], { root: t.path });
    expect(added).toMatchObject({ exitCode: 0, stdout: 'Added Assignee sam  Sam\n' });

    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web', assignees: ['sam'] });

    const removed = await runCli(['assignees', 'remove', 'sam'], { root: t.path });
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toBe('Removed Assignee sam\n');
    expect(removed.stderr).toBe('warning: Assignee "sam" removed from 1 story\n');
    expect((await createRepositories(t.root).stories.findByKey('WEB-1')).assignees).toEqual([]);
  });

  it('remove --json reports storiesUpdated and writes the warning as JSON', async () => {
    const t = await tempRoot();
    await makeRootConfig(t.path, { assignees: [{ handle: 'sam', name: 'Sam' }] });
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web', assignees: ['sam'] });
    await makeStory(t.path, { key: 'WEB-2', boardId: 'web', assignees: ['sam'] });
    const result = await runCli(['assignees', 'remove', 'sam', '--json'], { root: t.path });
    expect(JSON.parse(result.stdout)).toEqual({ removed: 'sam', storiesUpdated: 2 });
    expect(JSON.parse(result.stderr)).toEqual({ warning: 'Assignee "sam" removed from 2 stories' });
  });

  it('list, edit and errors', async () => {
    const t = await tempRoot();
    expect((await runCli(['assignees', 'list'], { root: t.path })).stdout).toContain('No Assignees');
    await runCli(['assignees', 'add', 'sam', '--name', 'Sam', '--email', 'sam@example.com'], { root: t.path });

    const list = await runCli(['assignees', 'list'], { root: t.path });
    expect(list.stdout).toMatch(/HANDLE\s+NAME\s+EMAIL/);
    expect(list.stdout).toMatch(/sam\s+Sam\s+sam@example\.com/);

    const edited = await runCli(['assignees', 'edit', 'sam', '--name', 'Samantha', '--email', '', '--json'], {
      root: t.path,
    });
    expect(JSON.parse(edited.stdout)).toEqual({ handle: 'sam', name: 'Samantha' });

    const duplicate = await runCli(['assignees', 'add', 'sam', '--name', 'Sam'], { root: t.path });
    expect(duplicate.exitCode).toBe(4);
    const badEmail = await runCli(['assignees', 'add', 'ana', '--name', 'Ana', '--email', 'nope'], { root: t.path });
    expect(badEmail.exitCode).toBe(2);
    expect(badEmail.stderr).toContain('invalid Assignee: email');
    expect((await runCli(['assignees', 'edit', 'sam'], { root: t.path })).exitCode).toBe(2);
    expect((await runCli(['assignees', 'remove', 'ghost'], { root: t.path })).exitCode).toBe(3);
    expect((await runCli(['assignees', 'add', 'ana'], { root: t.path })).exitCode).toBe(2);
  });

  it('every verb has --help', async () => {
    for (const verb of ['list', 'add', 'edit', 'remove']) {
      const { stdout, exitCode } = await runCli(['assignees', verb, '--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain(`Usage: rowbly assignees ${verb}`);
    }
  });
});
