import { describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/storage';
import { makeBoard, makeStory, makeWorkspace, runCli, tempRoot } from '../helpers';

const web = { workspaceId: 'acme', boardId: 'web' };

async function setup() {
  const t = await tempRoot();
  await makeWorkspace(t.path, { id: 'acme', assignees: [{ handle: 'alice', name: 'Alice' }] });
  await makeBoard(t.path, { ...web, id: 'web', keyPrefix: 'WEB' });
  await makeStory(t.path, { ...web, key: 'WEB-1', name: 'Login', assignees: ['alice'] });
  const cli = (...args: string[]) => runCli(args, { root: t.path, cwd: t.dir });
  return { t, cli };
}

describe('rowbly tasks', () => {
  it('creates WEB-1.4 after deleting WEB-1.3', async () => {
    const { t, cli } = await setup();
    for (const name of ['One', 'Two', 'Three']) {
      expect((await cli('tasks', 'create', 'WEB-1', '--name', name)).exitCode).toBe(0);
    }
    expect((await cli('tasks', 'delete', 'WEB-1.3', '--no-prompt')).exitCode).toBe(2);
    expect((await cli('tasks', 'delete', 'web-1.3', '--yes')).stdout).toBe('Deleted WEB-1.3\n');
    expect(await cli('tasks', 'create', 'web-1', '--name', 'Four')).toMatchObject({
      exitCode: 0,
      stdout: 'Created WEB-1.4: Four\n',
    });
    const story = await createRepositories(t.root).stories.findByKey('WEB-1');
    expect(story.tasks.map((task) => task.id)).toEqual(['WEB-1.1', 'WEB-1.2', 'WEB-1.4']);
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

  it('lists, shows with inherited Assignees, and edits', async () => {
    const { cli } = await setup();
    await cli('tasks', 'create', 'WEB-1', '--name', 'One', '--stage', 'todo', '--description', 'Do it');
    const list = await cli('tasks', 'list', 'WEB-1');
    expect(list.stdout).toMatch(/WEB-1\.1\s+│?\s*One\s+│?\s*● Todo/);
    const show = await cli('tasks', 'show', 'WEB-1.1');
    expect(show.stdout).toContain('WEB-1.1  One');
    expect(show.stdout).toMatch(/Assignees: +alice \(from the Story\)/);
    expect(show.stdout).toContain('Do it');
    expect((await cli('tasks', 'edit', 'WEB-1.1')).exitCode).toBe(2);
    const edited = await cli('tasks', 'edit', 'WEB-1.1', '--name', 'Renamed', '--json');
    expect(JSON.parse(edited.stdout)).toMatchObject({ id: 'WEB-1.1', name: 'Renamed', description: 'Do it' });
    expect(JSON.parse((await cli('tasks', 'list', 'WEB-1', '--json')).stdout)).toHaveLength(1);
  });

  it('exits 3 for an unknown Task and 2 when --name is missing', async () => {
    const { cli } = await setup();
    expect((await cli('tasks', 'show', 'WEB-1.5')).exitCode).toBe(3);
    expect((await cli('tasks', 'create', 'WEB-1')).stderr).toContain('missing required --name');
  });
});
