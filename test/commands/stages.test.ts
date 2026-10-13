import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGES } from '../../src/schemas';
import { createRepositories } from '../../src/storage';
import { makeBoard, makeStory, makeWorkspace, runCli, tempRoot } from '../helpers';

const web = { workspaceId: 'acme', boardId: 'web' };

/** Global stages are the defaults; Workspace acme has one Board, web, which inherits them. */
async function setup() {
  const t = await tempRoot();
  await createRepositories(t.root).rootConfig.put({ version: 1, stages: [...DEFAULT_STAGES] });
  await makeWorkspace(t.path, { id: 'acme' });
  await makeBoard(t.path, { ...web, id: 'web', keyPrefix: 'WEB' });
  const cli = (...args: string[]) => runCli(args, { root: t.path, cwd: t.dir });
  const read = async (path: string) => JSON.parse(await readFile(join(t.path, path), 'utf8'));
  return { t, cli, read };
}

describe('rowbly stages', () => {
  it('add --after on a Board that inherits global Stages copies them to board.config.json', async () => {
    const { t, cli, read } = await setup();
    const globalBefore = await readFile(join(t.path, 'rowbly.config.json'), 'utf8');
    const result = await cli(
      'stages',
      'add',
      'qa',
      '--name',
      'QA',
      '--category',
      'in_progress',
      '--after',
      'in-progress',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Added Stage qa');
    expect(result.stdout).toContain('board level (acme/web); affects acme/web');
    const board = await read('workspaces/acme/boards/web/board.config.json');
    expect(board.stages.map((s: { key: string }) => s.key)).toEqual(['backlog', 'todo', 'in-progress', 'qa', 'done']);
    expect(await readFile(join(t.path, 'rowbly.config.json'), 'utf8')).toBe(globalBefore);
  });

  it('remove refuses a Stage with Stories (exit 4); --move-to moves them below the Stories already there', async () => {
    const { t, cli } = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', stage: 'backlog', rank: 'a0' });
    await makeStory(t.path, { ...web, key: 'WEB-2', stage: 'backlog', rank: 'a1' });
    await makeStory(t.path, { ...web, key: 'WEB-3', stage: 'todo', rank: 'a0' });
    await makeStory(t.path, { ...web, key: 'WEB-4', stage: 'todo', rank: 'Zz' });

    const refused = await cli('stages', 'remove', 'todo');
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain('Stage "todo" is used by 2 Stories and 0 Tasks');

    const moved = await cli('stages', 'remove', 'todo', '--move-to', 'backlog', '--json');
    expect(moved.exitCode).toBe(0);
    expect(JSON.parse(moved.stdout)).toMatchObject({ storiesMoved: 2, tasksMoved: 0, level: 'board' });

    const stories = await createRepositories(t.root).stories.allInBoard(web);
    expect(stories.every((s) => s.stage === 'backlog')).toBe(true);
    const byRank = [...stories].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)).map((s) => s.key);
    expect(byRank).toEqual(['WEB-1', 'WEB-2', 'WEB-4', 'WEB-3']);
  });

  it('defaults to the Workspace level when no Board is in context, and --level selects one', async () => {
    const { t, cli, read } = await setup();
    await makeBoard(t.path, { id: 'api', workspaceId: 'acme', keyPrefix: 'API' });
    const added = await cli('stages', 'add', 'qa', '--name', 'QA', '--category', 'in_progress', '--json');
    expect(JSON.parse(added.stdout)).toMatchObject({ level: 'workspace', affectedBoards: [{ boardId: 'api' }, web] });
    expect((await read('workspaces/acme/workspace.config.json')).stages).toHaveLength(5);

    const global = await cli('stages', 'list', '--level', 'global', '--json');
    expect(JSON.parse(global.stdout)).toMatchObject({ level: 'global', source: 'global' });
    expect((await cli('stages', 'list', '--level', 'nope')).exitCode).toBe(2);
  });

  it('edit and move', async () => {
    const { cli } = await setup();
    expect((await cli('stages', 'edit', 'todo', '--category', 'in_progress', '--name', 'Next')).exitCode).toBe(0);
    const moved = await cli('stages', 'move', 'done', '--first', '--json');
    expect(JSON.parse(moved.stdout).items.map((s: { key: string }) => s.key)).toEqual([
      'done',
      'backlog',
      'todo',
      'in-progress',
    ]);
    const list = await cli('stages', 'list');
    expect(list.stdout).toContain('board level (acme/web); from board');
    expect(list.stdout).toMatch(/3\s+todo\s+Next\s+in_progress/);
    expect((await cli('stages', 'move', 'done')).exitCode).toBe(2);
    expect((await cli('stages', 'edit', 'nope', '--name', 'x')).exitCode).toBe(3);
    expect((await cli('stages', 'add', 'x', '--name', 'X', '--category', 'later')).exitCode).toBe(2);
  });

  it('has --help for every verb', async () => {
    const { cli } = await setup();
    for (const verb of ['list', 'add', 'edit', 'move', 'remove']) {
      const help = await cli('stages', verb, '--help');
      expect(help.exitCode, verb).toBe(0);
      expect(help.stdout).toContain('--level <level>');
    }
  });
});
