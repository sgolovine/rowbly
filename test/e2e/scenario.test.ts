import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Story } from '../../src/schemas';
import { createRepositories } from '../../src/storage';
import { type RunCliResult, runCli } from '../helpers';

/** The Assignees the Assignees Plugin keeps on a Story. */
function assigneesOf(record: Pick<Story, 'plugins'>): string[] {
  return (record.plugins?.assignees?.assignees ?? []) as string[];
}

/** The Comments the Comments Plugin keeps on a Story or Task. */
function thread(record: Pick<Story, 'plugins'> | undefined): { author: string | null; body: string }[] {
  return (record?.plugins?.comments?.comments ?? []) as { author: string | null; body: string }[];
}

/**
 * The whole product end to end, through the built CLI only, as CI runs it: no TTY (runCli closes
 * stdin) and NO_COLOR=1. Each step builds on the previous one, so they run in order.
 */
describe('end-to-end scenario', () => {
  let dir: string;
  const repos = () => createRepositories({ path: join(dir, '.rowbly'), kind: 'local' });

  /** Runs `rowbly …` in the project directory, so the Data Root is discovered from cwd. */
  async function rowbly(...args: string[]): Promise<RunCliResult> {
    const result = await runCli(args, { cwd: dir, env: { NO_COLOR: '1' } });
    // biome-ignore lint/suspicious/noControlCharactersInRegex: no colour codes with NO_COLOR.
    expect(result.stdout + result.stderr).not.toMatch(/\u001B\[/);
    return result;
  }

  /** Runs a command that must succeed and returns its stdout. */
  async function ok(...args: string[]): Promise<string> {
    const result = await rowbly(...args);
    expect(result, `rowbly ${args.join(' ')}`).toMatchObject({ exitCode: 0 });
    return result.stdout;
  }

  const json = async (...args: string[]) => JSON.parse(await ok(...args, '--json'));
  const story = (key: string) => repos().stories.findByKey(key);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rowbly-e2e-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('1. init with flags creates the Data Root and a Board, and uses it', async () => {
    const out = await ok('init', '--board', 'web', '--board-name', 'Web', '--prefix', 'WEB');
    expect(out).toContain(`Created Data Root ${join(dir, '.rowbly')}`);
    expect(out).toContain('Created Board web (WEB)');
    expect(out).toContain('Now using web');
    await ok('boards', 'create', 'api', '--name', 'API', '--prefix', 'API');
    expect(await repos().localState.get()).toEqual({ version: 1, board: 'web' });
  });

  it('2. turns the Assignees Plugin on, adds two Assignees and claims Me with whoami', async () => {
    await ok('plugins', 'enable', 'assignees');
    await ok('assignees', 'add', 'alice', '--name', 'Alice', '--email', 'alice@example.com');
    await ok('assignees', 'add', 'bob', '--name', 'Bob');
    expect(await ok('whoami', 'alice')).toBe('You are alice\n');
    expect(await ok('whoami')).toBe('alice\n');
  });

  it('3. adds a board-level Stage and a select Custom Field', async () => {
    const stages = await json(
      'stages',
      'add',
      'review',
      '--name',
      'Review',
      '--category',
      'in_progress',
      '--after',
      'in-progress',
    );
    expect(stages.level).toBe('board');
    expect(stages.items.map((s: { key: string }) => s.key)).toEqual([
      'backlog',
      'todo',
      'in-progress',
      'review',
      'done',
    ]);
    await ok('fields', 'add', 'size', '--name', 'Size', '--type', 'select', '--options', 's,m,l');
    const board = await repos().boards.get('web');
    expect(board.stages?.map((s) => s.key)).toContain('review');
    expect(board.customFields).toEqual([
      { key: 'size', name: 'Size', type: 'select', options: ['s', 'm', 'l'], required: false },
    ]);
    // The other Board still inherits the defaults.
    expect((await repos().boards.get('api')).stages).toBeUndefined();
  });

  it('4. creates 5 Stories with mixed fields across two Boards', async () => {
    const created = [
      await json(
        'stories',
        'create',
        '--name',
        'Login page',
        '--priority',
        'P1',
        '--label',
        'ui,auth',
        '--assignee',
        'alice',
        '--field',
        'size=m',
        '--due',
        '2026-11-01',
      ),
      await json('stories', 'create', '--name', 'Signup', '--assignee', 'bob', '--field', 'size=s'),
      await json('stories', 'create', '--name', 'Footer', '--label', 'ui'),
      await json(
        'stories',
        'create',
        '--name',
        'Auth API',
        '--board',
        'api',
        '--priority',
        'P0',
        '--assignee',
        'alice',
        '--assignee',
        'bob',
      ),
      await json('stories', 'create', '--name', 'Rate limit', '--board', 'api'),
    ] as Story[];
    expect(created.map((s) => s.key)).toEqual(['WEB-1', 'WEB-2', 'WEB-3', 'API-1', 'API-2']);
    expect(created[0]).toMatchObject({
      stage: 'backlog',
      priority: 'P1',
      labels: ['ui', 'auth'],
      plugins: { assignees: { assignees: ['alice'] } },
      dueDate: '2026-11-01',
      customFields: { size: 'm' },
      createdBy: 'alice',
    });
    expect(created[3]).toMatchObject({ boardId: 'api', customFields: {} });
    expect(assigneesOf(created[3] as Story)).toEqual(['alice', 'bob']);
    // A Custom Field defined only on web is not valid on api.
    const invalid = await rowbly('stories', 'create', '--name', 'X', '--board', 'api', '--field', 'size=m');
    expect(invalid.exitCode).toBe(2);
  });

  it('5. moves and ranks Stories', async () => {
    await ok('stories', 'rank', 'WEB-3', '--top');
    expect((await json('stories', 'list', '--stage', 'backlog')).map((s: Story) => s.key)).toEqual([
      'WEB-3',
      'WEB-1',
      'WEB-2',
    ]);
    await ok('stories', 'rank', 'WEB-1', '--before', 'WEB-3');
    expect((await json('stories', 'list')).map((s: Story) => s.key)).toEqual(['WEB-1', 'WEB-3', 'WEB-2']);

    expect(await ok('stories', 'move', 'WEB-1', 'done')).toContain('WEB-1');
    await ok('stories', 'move', 'web-2', 'review');
    await ok('stories', 'move', 'API-1', 'done');
    expect((await story('WEB-1')).stage).toBe('done');
    expect((await story('WEB-2')).stage).toBe('review');
    const open = (await json('stories', 'list', '--open')).map((s: Story) => s.key);
    expect(open).toEqual(['WEB-3', 'WEB-2']);
    const all = (await json('stories', 'list', '--all-boards', '--sort', 'priority')).map((s: Story) => s.key);
    expect(all.slice(0, 2)).toEqual(['API-1', 'WEB-1']);
  });

  it('6. adds Tasks, and Comments with the Comments Plugin on', async () => {
    const task = await json('tasks', 'create', 'WEB-2', '--name', 'Write tests');
    expect(task).toMatchObject({ id: 'WEB-2.1', stage: 'backlog' });
    await ok('tasks', 'create', 'WEB-2', '--name', 'Fix copy', '--stage', 'todo');
    await ok('tasks', 'move', 'WEB-2.1', 'done');
    await ok('plugins', 'enable', 'comments');
    await ok('comments', 'add', 'WEB-2', '--body', 'Looks good');
    const piped = await runCli(['comments', 'add', 'WEB-2.1', '--body-file', '-'], { cwd: dir, stdin: 'From stdin\n' });
    expect(piped.exitCode).toBe(0);

    const saved = await story('WEB-2');
    expect(saved.tasks.map((t) => [t.id, t.stage])).toEqual([
      ['WEB-2.1', 'done'],
      ['WEB-2.2', 'todo'],
    ]);
    expect(thread(saved)).toMatchObject([{ author: 'alice', body: 'Looks good' }]);
    expect(thread(saved.tasks[0]).map((c) => c.body.trim())).toContain('From stdin');
  });

  it('7. removes a Stage with --move-to', async () => {
    const refused = await rowbly('stages', 'remove', 'review');
    expect(refused.exitCode).toBe(4);
    const removed = await json('stages', 'remove', 'review', '--move-to', 'in-progress');
    expect(removed).toMatchObject({ storiesMoved: 1, tasksMoved: 0 });
    expect((await story('WEB-2')).stage).toBe('in-progress');
    expect((await repos().boards.get('web')).stages?.map((s) => s.key)).not.toContain('review');
  });

  it('8. removes an Assignee and warns with the Story count', async () => {
    const result = await rowbly('assignees', 'remove', 'bob');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('warning: Assignee "bob" removed from 2 stories');
    expect(assigneesOf(await story('API-1'))).toEqual(['alice']);
    expect(assigneesOf(await story('WEB-2'))).toEqual([]);
  });

  it('9. doctor finds nothing wrong', async () => {
    const result = await rowbly('doctor');
    expect(result.exitCode).toBe(0);
    const report = await json('doctor');
    expect(report.findings).toEqual([]);
  });

  it('10. --json from every list command round-trips the files on disk', async () => {
    const r = repos();
    const webConfig = await r.boards.get('web');
    const webStories = await r.stories.allInBoard('web');
    const apiStories = await r.stories.allInBoard('api');
    const allStories = [...webStories, ...apiStories];
    const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
    const sortByKey = <T extends { key: string }>(items: T[]) => [...items].sort(byKey);
    const signup = await r.stories.findByKey('WEB-2');

    const roster = JSON.parse(await readFile(join(dir, '.rowbly/plugins/assignees/roster.json'), 'utf8'));
    expect(await json('assignees', 'list')).toEqual(roster.assignees);
    expect(await json('boards', 'list')).toEqual(await r.boards.list());
    expect(await json('stages', 'list')).toEqual({ level: 'board', source: 'board', stages: webConfig.stages });
    expect(await json('fields', 'list')).toEqual({ level: 'board', source: 'board', fields: webConfig.customFields });
    expect(sortByKey(await json('stories', 'list'))).toEqual(sortByKey(webStories));
    expect(sortByKey(await json('stories', 'list', '--all-boards'))).toEqual(sortByKey(allStories));
    expect(await json('tasks', 'list', 'WEB-2')).toEqual(signup.tasks);
    expect(await json('comments', 'list', 'WEB-2')).toEqual(thread(signup));
    expect(await json('comments', 'list', 'WEB-2.1')).toEqual(thread(signup.tasks[0]));
  });
});
