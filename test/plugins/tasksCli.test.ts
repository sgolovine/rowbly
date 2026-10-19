import { describe, expect, it } from 'vitest';
import { TasksBag } from '../../src/plugins/tasks/model';
import { createRepositories } from '../../src/storage';
import { makeStory, runCli } from '../helpers';
import { pluginRoot } from './helpers';

async function setup(on = true) {
  const t = await pluginRoot(on ? { tasks: true } : {});
  await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login' });
  const cli = (...args: string[]) => runCli(args, { root: t.path, cwd: t.dir });
  const bag = async () => TasksBag.parse((await createRepositories(t.root).stories.findByKey('WEB-1')).plugins?.tasks);
  return { t, cli, bag };
}

describe('rowbly tasks', () => {
  it('is off by default', async () => {
    const { cli } = await setup(false);
    expect((await cli('tasks', 'list', 'WEB-1')).exitCode).toBe(2);
    expect((await cli('stories', 'show', 'WEB-1')).stdout).not.toContain('Tasks');
    expect((await cli('plugins', 'enable', 'tasks')).exitCode).toBe(0);
    expect((await cli('tasks', 'list', 'WEB-1')).stdout).toContain('No Tasks yet.');
  });

  it('creates WEB-1.4 after deleting WEB-1.3', async () => {
    const { cli, bag } = await setup();
    for (const name of ['One', 'Two', 'Three']) {
      expect((await cli('tasks', 'create', 'WEB-1', '--name', name)).exitCode).toBe(0);
    }
    expect((await cli('tasks', 'delete', 'WEB-1.3', '--no-prompt')).exitCode).toBe(2);
    expect((await cli('tasks', 'delete', 'web-1.3', '--yes')).stdout).toBe('Deleted WEB-1.3\n');
    expect(await cli('tasks', 'create', 'web-1', '--name', 'Four')).toMatchObject({
      exitCode: 0,
      stdout: 'Created WEB-1.4: Four\n',
    });
    expect((await bag()).tasks.map((task) => task.number)).toEqual([1, 2, 4]);
  });

  it('exits 2 when moving to an unknown Stage', async () => {
    const { cli } = await setup();
    await cli('tasks', 'create', 'WEB-1', '--name', 'One');
    const result = await cli('tasks', 'move', 'WEB-1.1', 'unknown-stage', '--json');
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr).error).toMatchObject({
      code: 'VALIDATION',
      message: 'unknown Stage "unknown-stage"',
    });
    expect((await cli('tasks', 'move', 'WEB-1.1', 'done')).stdout).toBe('Moved WEB-1.1 to done\n');
  });

  it('lists, shows and edits', async () => {
    const { cli } = await setup();
    await cli('tasks', 'create', 'WEB-1', '--name', 'One', '--stage', 'todo', '--description', 'Do it');
    const list = await cli('tasks', 'list', 'WEB-1');
    expect(list.stdout).toMatch(/WEB-1\.1\s+│?\s*One\s+│?\s*● Todo/);
    const show = await cli('tasks', 'show', 'WEB-1.1');
    expect(show.stdout).toContain('WEB-1.1  One');
    expect(show.stdout).toContain('Do it');
    expect((await cli('tasks', 'edit', 'WEB-1.1')).exitCode).toBe(2);
    const edited = await cli('tasks', 'edit', 'WEB-1.1', '--name', 'Renamed', '--json');
    expect(JSON.parse(edited.stdout)).toMatchObject({ id: 'WEB-1.1', name: 'Renamed', description: 'Do it' });
    expect(JSON.parse((await cli('tasks', 'list', 'WEB-1', '--json')).stdout)).toHaveLength(1);
  });

  it('exits 3 for an unknown Task and 2 when --name is missing', async () => {
    const { cli } = await setup();
    expect((await cli('tasks', 'show', 'WEB-1.5')).exitCode).toBe(3);
    expect((await cli('tasks', 'create', 'WEB-1', '--no-prompt')).stderr).toContain('--name');
  });

  it('summarises Tasks in stories show', async () => {
    const { cli } = await setup();
    await cli('tasks', 'create', 'WEB-1', '--name', 'One');
    await cli('tasks', 'create', 'WEB-1', '--name', 'Two', '--stage', 'done');
    expect((await cli('stories', 'show', 'WEB-1')).stdout).toMatch(/Tasks:\s+1\/2 done/);
  });

  it('refuses to remove a Stage that Tasks use, and moves them with --move-to', async () => {
    const { cli, bag } = await setup();
    await cli('tasks', 'create', 'WEB-1', '--name', 'One', '--stage', 'todo');
    const refused = await cli('stages', 'remove', 'todo', '--level', 'global', '--json');
    expect(refused.exitCode).toBe(4);
    expect(JSON.parse(refused.stderr).error).toMatchObject({
      code: 'CONFLICT',
      message: 'Stage "todo" is used by 1 Task',
      details: { tasks: 1, needsMoveTo: true, plugin: 'tasks' },
    });
    const moved = await cli('stages', 'remove', 'todo', '--level', 'global', '--move-to', 'backlog');
    expect(moved.exitCode).toBe(0);
    expect(moved.stderr).toContain('moved 1 Task to backlog');
    expect((await bag()).tasks[0]?.stage).toBe('backlog');
  });
});
