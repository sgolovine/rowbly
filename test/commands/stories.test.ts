import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { StorySchema } from '../../src/schemas';
import { createRepositories } from '../../src/storage';
import { makeBoard, makeRootConfig, makeStory, runCli, tempRoot } from '../helpers';

const web = { boardId: 'web' };

async function setup() {
  const t = await tempRoot();
  await makeRootConfig(t.path, {
    assignees: [
      { handle: 'alice', name: 'Alice' },
      { handle: 'bob', name: 'Bob' },
    ],
  });
  await makeBoard(t.path, {
    id: 'web',
    keyPrefix: 'WEB',
    customFields: [{ key: 'estimate', name: 'Estimate', type: 'number', required: false }],
  });
  const cli = (...args: string[]) => runCli(args, { root: t.path, cwd: t.dir });
  return { t, cli };
}

describe('rowbly stories', () => {
  it('creates WEB-4 after WEB-1..3 and reuses WEB-4 after deleting it', async () => {
    const { t, cli } = await setup();
    for (const key of ['WEB-1', 'WEB-2', 'WEB-3']) await makeStory(t.path, { ...web, key });
    const created = await cli('stories', 'create', '--name', 'Four');
    expect(created).toMatchObject({ exitCode: 0, stdout: 'Created WEB-4: Four\n' });
    expect((await cli('stories', 'delete', 'WEB-4', '--no-prompt')).exitCode).toBe(2);
    expect((await cli('stories', 'delete', 'WEB-4', '--yes')).stdout).toBe('Deleted WEB-4\n');
    const again = await cli('stories', 'create', '--name', 'Again', '--json');
    expect(JSON.parse(again.stdout).key).toBe('WEB-4');
  });

  it('creates the stories folder on the first write', async () => {
    const { t, cli } = await setup();
    const result = await cli(
      'stories',
      'create',
      '--name',
      'First',
      '--assignee',
      'alice,bob',
      '--label',
      'ui',
      '--label',
      'api',
      '--priority',
      'p1',
      '--due',
      '2026-11-01',
      '--field',
      'estimate=3',
      '--description',
      'Some *markdown*',
      '--json',
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      key: 'WEB-1',
      stage: 'backlog',
      assignees: ['alice', 'bob'],
      labels: ['ui', 'api'],
      priority: 'P1',
      dueDate: '2026-11-01',
      customFields: { estimate: 3 },
      description: 'Some *markdown*',
    });
    expect(await readdir(`${t.path}/boards/web/stories`)).toEqual(['WEB-1']);
  });

  it('exits 2 for an unknown Assignee and lists the valid handles in details', async () => {
    const { cli } = await setup();
    const result = await cli('stories', 'create', '--name', 'X', '--assignee', 'nobody', '--json');
    expect(result.exitCode).toBe(2);
    const { error } = JSON.parse(result.stderr);
    expect(error.code).toBe('VALIDATION');
    expect(error.details.validHandles).toEqual(['alice', 'bob']);
    const human = await cli('stories', 'create', '--name', 'X', '--assignee', 'nobody');
    expect(human.stderr).toContain('valid handles: alice, bob');
  });

  it('exits 2 for an invalid number field or a missing required field', async () => {
    const { t, cli } = await setup();
    expect((await cli('stories', 'create', '--name', 'X', '--field', 'estimate=abc')).exitCode).toBe(2);
    await makeBoard(t.path, {
      id: 'api',
      keyPrefix: 'API',
      customFields: [{ key: 'team', name: 'Team', type: 'text', required: true }],
    });
    const missing = await cli('stories', 'create', '--name', 'X', '--board', 'api');
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain('Team is required');
    expect((await cli('stories', 'create', '--board', 'api', '--no-prompt')).stderr).toContain(
      'missing required --name',
    );
  });

  it('rank --before changes only the ranked Story file and list shows it first', async () => {
    const { t, cli } = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', rank: 'a0' });
    await makeStory(t.path, { ...web, key: 'WEB-2', rank: 'a1' });
    await makeStory(t.path, { ...web, key: 'WEB-3', rank: 'a2' });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: t.dir, encoding: 'utf8' });
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'seed');

    expect((await cli('stories', 'rank', 'WEB-3', '--before', 'WEB-1')).exitCode).toBe(0);
    const list = await cli('stories', 'list', '--json');
    expect(JSON.parse(list.stdout).map((s: { key: string }) => s.key)).toEqual(['WEB-3', 'WEB-1', 'WEB-2']);
    expect(git('diff', '--name-only').trim()).toBe('.rowbly/boards/web/stories/WEB-3/story.json');
    expect((await cli('stories', 'rank', 'WEB-3')).exitCode).toBe(2);
    expect((await cli('stories', 'rank', 'WEB-3', '--top', '--bottom')).exitCode).toBe(2);
  });

  it('move accepts a lower-case key and --top', async () => {
    const { t, cli } = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', stage: 'done', rank: 'a0' });
    await makeStory(t.path, { ...web, key: 'WEB-2' });
    const moved = await cli('stories', 'move', 'web-2', 'done', '--top');
    expect(moved).toMatchObject({ exitCode: 0, stdout: 'Moved WEB-2 to done\n' });
    const list = await cli('stories', 'list', '--stage', 'done', '--json');
    expect(JSON.parse(list.stdout).map((s: { key: string }) => s.key)).toEqual(['WEB-2', 'WEB-1']);
    expect((await cli('stories', 'move', 'WEB-2', 'nope')).exitCode).toBe(2);
    expect((await cli('stories', 'move', 'WEB-9', 'done')).exitCode).toBe(3);
  });

  it('list --open --assignee me works with Me set and exits 2 without it', async () => {
    const { t, cli } = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', assignees: ['alice'] });
    await makeStory(t.path, { ...web, key: 'WEB-2', assignees: ['alice'], stage: 'done' });
    await makeStory(t.path, { ...web, key: 'WEB-3', assignees: ['bob'] });
    const without = await cli('stories', 'list', '--open', '--assignee', 'me');
    expect(without.exitCode).toBe(2);
    expect(without.stderr).toContain('Me is not set');
    await createRepositories(t.root).localState.put({ version: 1, me: 'alice' });
    const result = await cli('stories', 'list', '--open', '--assignee', 'me', '--json');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).map((s: { key: string }) => s.key)).toEqual(['WEB-1']);
  });

  it('list renders the human table and validates enum flags', async () => {
    const { t, cli } = await setup();
    await makeStory(t.path, {
      ...web,
      key: 'WEB-1',
      name: 'Login',
      stage: 'in-progress',
      priority: 'P1',
      assignees: ['alice'],
      labels: ['ui'],
      dueDate: '2026-11-01',
    });
    await makeStory(t.path, { ...web, key: 'WEB-2', name: 'Other' });
    const table = await cli('stories', 'list');
    expect(table.stdout).toContain('KEY    NAME   STAGE');
    expect(table.stdout).toMatch(/WEB-1 +Login +● In Progress +P1 +alice +ui +2026-11-01/);
    const p1 = await cli('stories', 'list', '--priority', 'p1', '--json');
    expect(JSON.parse(p1.stdout).map((s: { key: string }) => s.key)).toEqual(['WEB-1']);
    expect((await cli('stories', 'list', '--sort', 'weird')).exitCode).toBe(2);
    expect((await cli('stories', 'list', '--category', 'weird')).exitCode).toBe(2);
    expect((await cli('stories', 'list', '--priority', 'P9')).exitCode).toBe(2);
    expect((await cli('stories', 'list', '--search', 'nothing-matches')).stdout).toBe('No Stories match.\n');
  });

  it('list --all-boards covers every Board', async () => {
    const { t, cli } = await setup();
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    await makeStory(t.path, { ...web, key: 'WEB-1' });
    await makeStory(t.path, { boardId: 'api', key: 'API-1' });
    expect((await cli('stories', 'list')).exitCode).toBe(2);
    const all = await cli('stories', 'list', '--all-boards', '--json');
    expect(JSON.parse(all.stdout).map((s: { key: string }) => s.key)).toEqual(['API-1', 'WEB-1']);
  });

  it('show --json round-trips through the Story schema; human mode summarises', async () => {
    const { t, cli } = await setup();
    await makeStory(t.path, {
      ...web,
      key: 'WEB-1',
      name: 'Login',
      description: 'The **login** page',
      customFields: { estimate: 5 },
      nextTaskNumber: 3,
      tasks: [
        {
          id: 'WEB-1.1',
          name: 'A',
          description: '',
          stage: 'done',
          createdAt: '2026-10-12T17:21:07.000Z',
          updatedAt: '2026-10-12T17:21:07.000Z',
        },
        {
          id: 'WEB-1.2',
          name: 'B',
          description: '',
          stage: 'todo',
          createdAt: '2026-10-12T17:21:07.000Z',
          updatedAt: '2026-10-12T17:21:07.000Z',
        },
      ],
    });
    const json = await cli('stories', 'show', 'web-1', '--json');
    const parsed = StorySchema.parse(JSON.parse(json.stdout));
    expect(parsed).toEqual(await createRepositories(t.root).stories.findByKey('WEB-1'));
    const human = await cli('stories', 'show', 'WEB-1');
    expect(human.stdout).toContain('WEB-1  Login');
    expect(human.stdout).toMatch(/Stage: +● Backlog/);
    expect(human.stdout).toMatch(/Estimate: +5/);
    expect(human.stdout).toContain('The **login** page');
    expect(human.stdout).toContain('Tasks: 1/2 done');
  });

  it('edit applies replace, add/remove, --no-* and field flags', async () => {
    const { t, cli } = await setup();
    await makeStory(t.path, {
      ...web,
      key: 'WEB-1',
      assignees: ['alice'],
      labels: ['ui'],
      priority: 'P2',
      dueDate: '2026-11-01',
      customFields: { estimate: 1 },
    });
    const edit = (...args: string[]) => cli('stories', 'edit', 'WEB-1', ...args, '--json');
    let story = JSON.parse((await edit('--add-assignee', 'bob', '--remove-label', 'ui', '--add-label', 'x')).stdout);
    expect(story).toMatchObject({ assignees: ['alice', 'bob'], labels: ['x'] });
    story = JSON.parse((await edit('--no-priority', '--no-due', '--unset-field', 'estimate', '--name', 'New')).stdout);
    expect(story).toMatchObject({ name: 'New', priority: null, dueDate: null, customFields: {} });
    story = JSON.parse((await edit('--assignee', 'bob', '--field', 'estimate=8', '--description-file', '-')).stdout);
    expect(story).toMatchObject({ assignees: ['bob'], customFields: { estimate: 8 } });
    expect((await cli('stories', 'edit', 'WEB-1')).stderr).toContain('nothing to change');
    expect((await cli('stories', 'edit', 'WEB-1', '--assignee', 'bob', '--add-assignee', 'alice')).exitCode).toBe(2);
    expect((await cli('stories', 'edit', 'WEB-1', '--due', 'tomorrow')).exitCode).toBe(2);
  });

  it('reads the description from stdin', async () => {
    const { t } = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1' });
    const result = await runCli(['stories', 'edit', 'WEB-1', '--description-file', '-'], {
      root: t.path,
      cwd: t.dir,
      stdin: 'From stdin\n\n',
    });
    expect(result.exitCode).toBe(0);
    expect((await createRepositories(t.root).stories.findByKey('WEB-1')).description).toBe('From stdin');
  });

  it('has --help for every verb', async () => {
    const { cli } = await setup();
    for (const verb of ['list', 'create', 'show', 'edit', 'move', 'rank', 'delete']) {
      const help = await cli('stories', verb, '--help');
      expect(help.exitCode).toBe(0);
      expect(help.stdout).toContain(`rowbly stories ${verb}`);
    }
  });
});
