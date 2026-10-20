import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { type RunCliResult, runCli, tempRoot } from '../helpers';

/**
 * Task checks for the agent skills in skills/: each test runs a skill's documented workflow through
 * the built CLI, as an agent would (no TTY, `--json --no-prompt`), and checks the claims and the
 * mistakes the skill warns about. The Story Key conflict repair is covered in
 * test/commands/doctor.test.ts.
 */

/** A project directory with a Data Root and Board `web`, made the way rowbly-setup says. */
async function project() {
  const tmp = await tempRoot();
  const rowbly = (...args: string[]) => runCli([...args, '--no-prompt'], { cwd: tmp.dir });
  const json = async (...args: string[]) => {
    const result = await rowbly(...args, '--json');
    expect(result, `rowbly ${args.join(' ')}`).toMatchObject({ exitCode: 0 });
    return JSON.parse(result.stdout);
  };
  await json('boards', 'create', 'web', '--name', 'Website', '--prefix', 'WEB');
  return { tmp, rowbly, json };
}

/** The JSON error a failed `--json` command prints on stderr; stdout stays empty. */
function jsonError(result: RunCliResult): { code: string; details: Record<string, unknown> } {
  expect(result.stdout).toBe('');
  return JSON.parse(result.stderr).error;
}

describe('rowbly-cli', () => {
  it('fails fast instead of prompting, with exit codes and JSON errors on stderr', async () => {
    const { rowbly, json } = await project();
    const story = await json('stories', 'create', '--board', 'web', '--name', 'Login page');

    const missing = await rowbly('stories', 'create', '--board', 'web', '--json');
    expect(missing.exitCode).toBe(2);
    expect(jsonError(missing).code).toBe('USAGE');

    const unconfirmed = await rowbly('stories', 'delete', story.key);
    expect(unconfirmed.exitCode).toBe(2);
    expect(unconfirmed.stderr).toContain('--yes');
    expect(await json('stories', 'delete', story.key, '--yes')).toEqual({ deleted: story.key });

    const notFound = await rowbly('stories', 'show', 'WEB-99', '--json');
    expect(notFound.exitCode).toBe(3);
    expect(jsonError(notFound).code).toBe('NOT_FOUND');

    const badStage = await rowbly('stories', 'create', '--board', 'web', '--name', 'x', '--stage', 'nope', '--json');
    expect(badStage.exitCode).toBe(2);
    expect(jsonError(badStage).details.validStages).toEqual(['backlog', 'todo', 'in-progress', 'done']);
  });

  it('needs a Board in context, takes --root as the .rowbly folder, and exits 5 without a Data Root', async () => {
    const { tmp, rowbly, json } = await project();
    await json('boards', 'create', 'api', '--name', 'API', '--prefix', 'API');
    const noBoard = await rowbly('stories', 'list', '--json');
    expect(noBoard.exitCode).toBe(2);
    expect(jsonError(noBoard).code).toBe('USAGE');
    expect(await json('stories', 'list', '--board', 'api')).toEqual([]);

    const elsewhere = (...args: string[]) => runCli([...args, '--no-prompt', '--json']);
    expect((await elsewhere('--root', tmp.path, 'boards', 'list')).exitCode).toBe(0);
    expect((await elsewhere('stories', 'list')).exitCode).toBe(5);
  });
});

describe('rowbly-setup', () => {
  it('edits Stages at the level asked for, and a Board-level edit stops inheriting global changes', async () => {
    const { json } = await project();
    await json('boards', 'create', 'api', '--name', 'API', '--prefix', 'API');
    const stageKeys = async (board: string) =>
      (await json('config', 'show', '--board', board)).stages.map((s: { key: string }) => s.key);

    await json(
      'stages',
      'add',
      'review',
      '--name',
      'Review',
      '--after',
      'in-progress',
      '--board',
      'web',
      '--level',
      'board',
    );
    expect(await stageKeys('web')).toEqual(['backlog', 'todo', 'in-progress', 'review', 'done']);
    expect(await stageKeys('api')).toEqual(['backlog', 'todo', 'in-progress', 'done']);

    const global = await json('stages', 'add', 'blocked', '--name', 'Blocked', '--level', 'global');
    expect(global.affectedBoards).toEqual(['api']);
    expect(await stageKeys('api')).toContain('blocked');
    expect(await stageKeys('web')).not.toContain('blocked');
  });

  it('refuses a second Data Root and a clashing key prefix', async () => {
    const { rowbly } = await project();
    expect((await rowbly('init', '--json')).exitCode).toBe(4);
    expect((await rowbly('boards', 'create', 'www', '--name', 'W', '--prefix', 'web', '--json')).exitCode).toBe(4);
  });
});

describe('rowbly-stories', () => {
  it('picks up and finishes a Story by Stage Category, with Tasks', async () => {
    const { json } = await project();
    await json('stages', 'add', 'doing', '--name', 'Doing', '--after', 'backlog', '--board', 'web', '--level', 'board');
    await json('stages', 'remove', 'in-progress', '--board', 'web');

    const created = await json(
      'stories',
      'create',
      '--board',
      'web',
      '--name',
      'Login page',
      '--priority',
      'P1',
      '--label',
      'auth,frontend',
    );
    expect(created).toMatchObject({ key: 'WEB-1', stage: 'backlog', priority: 'P1', labels: ['auth', 'frontend'] });
    // Tasks are a Built-in Plugin, off until the Data Root turns it on.
    await json('plugins', 'enable', 'tasks');
    const task = await json('tasks', 'create', created.key, '--name', 'Build the form');
    expect(task.id).toBe('WEB-1.1');

    const { stages } = await json('config', 'show', '--board', 'web');
    const first = (category: string) => stages.find((s: { category: string }) => s.category === category).key;
    expect(first('board')).toBe('doing');
    await json('stories', 'move', created.key, first('board'));
    await json('tasks', 'move', task.id, first('done'));
    expect((await json('stories', 'show', created.key)).stage).toBe('doing');
    await json('stories', 'move', created.key, first('done'));

    const finished = await json('stories', 'show', created.key);
    expect(finished.stage).toBe('done');
    expect(await json('tasks', 'list', created.key)).toEqual([
      expect.objectContaining({ id: 'WEB-1.1', stage: 'done' }),
    ]);
    expect(await json('stories', 'list', '--board', 'web', '--open')).toEqual([]);
  });

  it('adds one Label with --add-label, while --label replaces the list and a Title Case Label fails', async () => {
    const { rowbly, json } = await project();
    await json('stories', 'create', '--board', 'web', '--name', 'Login', '--label', 'auth');
    expect((await json('stories', 'edit', 'WEB-1', '--add-label', 'in-review')).labels).toEqual(['auth', 'in-review']);
    expect((await json('stories', 'edit', 'WEB-1', '--label', 'urgent')).labels).toEqual(['urgent']);
    const bad = await rowbly('stories', 'edit', 'WEB-1', '--add-label', 'Needs Review', '--json');
    expect(bad.exitCode).toBe(2);
    expect(jsonError(bad).code).toBe('VALIDATION');
  });

  it('keeps newlines from --description-file - and lists valid handles for an unknown Assignee', async () => {
    const { tmp, rowbly, json } = await project();
    const created = await runCli(
      ['stories', 'create', '--board', 'web', '--name', 'Doc', '--description-file', '-', '--json', '--no-prompt'],
      {
        cwd: tmp.dir,
        stdin: '## Goal\n\nSign in.\n\n',
      },
    );
    expect(JSON.parse(created.stdout).description).toBe('## Goal\n\nSign in.');

    // Assignees are a Plugin, off until the Data Root turns it on.
    expect((await rowbly('stories', 'edit', 'WEB-1', '--add-assignee', 'sam', '--json')).exitCode).toBe(2);
    await json('plugins', 'enable', 'assignees');
    await json('assignees', 'add', 'sam', '--name', 'Sam');
    const unknown = await rowbly('stories', 'edit', 'WEB-1', '--add-assignee', 'bob', '--json');
    expect(unknown.exitCode).toBe(2);
    expect(jsonError(unknown).details.validHandles).toEqual(['sam']);
    expect((await rowbly('stories', 'list', '--board', 'web', '--assignee', 'me', '--json')).exitCode).toBe(2);
  });
});

describe('rowbly-plugins', () => {
  it('turns Plugins on and uses Epics, Specs and Comments as documented', async () => {
    const { rowbly, json } = await project();
    const off = await rowbly('epics', 'list');
    expect(off.exitCode).toBe(2);
    expect(off.stderr).toContain('rowbly plugins enable epics');

    for (const id of ['epics', 'specs', 'comments'])
      expect(await json('plugins', 'enable', id)).toEqual({ id, enabled: true });
    const plugins = await json('plugins', 'list');
    expect(plugins.map((p: { id: string; enabled: boolean; loaded: boolean }) => [p.id, p.enabled, p.loaded])).toEqual([
      ['assignees', false, false],
      ['tasks', false, false],
      ['epics', true, true],
      ['specs', true, true],
      ['comments', true, true],
      ['git', false, false],
    ]);

    await json('epics', 'create', 'auth', '--name', 'Authentication');
    const story = await json('stories', 'create', '--board', 'web', '--name', 'Login page', '--epic', 'auth');
    expect(story.plugins.epics).toEqual({ epic: 'auth' });

    await json('specs', 'create', '--story', story.key, '--title', 'Login page', '--text', 'Email only.');
    expect(await json('specs', 'show', '--story', story.key.toLowerCase())).toEqual({
      slug: 'spec',
      title: 'Login page',
      text: '# Login page\n\nEmail only.',
    });
    // A second Story Spec needs its own slug: without one, --story means the Story Spec `spec` again.
    expect((await rowbly('specs', 'create', '--story', story.key, '--title', 'Again', '--json')).exitCode).toBe(4);
    await json('specs', 'create', 'design', '--story', story.key, '--title', 'Design', '--text', 'One form.');
    expect(
      (await json('specs', 'list', '--story', story.key)).map((s: { slug: string; title: string }) => s.slug),
    ).toEqual(['design', 'spec']);
    expect((await json('specs', 'show', 'design', '--story', story.key)).text).toBe('# Design\n\nOne form.');
    expect((await rowbly('specs', 'show', story.key.toLowerCase(), '--board', 'web', '--json')).exitCode).toBe(3);
    await json('specs', 'create', 'auth-flow', '--board', 'web', '--title', 'Auth flow', '--text', 'Tokens.');
    await json('specs', 'create', 'api', '--board', 'web', '--title', 'API', '--text', 'Routes.');
    await json('stories', 'edit', story.key, '--add-spec', 'auth-flow');
    expect((await json('stories', 'edit', story.key, '--add-spec', 'api')).plugins.specs).toEqual({
      specs: ['auth-flow', 'api'],
    });

    const comment = await json('comments', 'add', story.key, '--body', 'Blocked on the token endpoint.');
    expect(comment).toMatchObject({ id: expect.stringMatching(/^.{8}$/), author: null });
    expect((await rowbly('comments', 'delete', story.key, comment.id)).exitCode).toBe(2);

    await json('stories', 'move', story.key, 'done');
    expect((await rowbly('epics', 'show', 'auth')).stdout).toContain('1/1 Stories done');

    expect((await rowbly('plugins', 'disable', 'comments')).exitCode).toBe(0);
    expect((await json('stories', 'show', story.key)).plugins.comments.comments).toHaveLength(1);
  });
});

describe('rowbly-doctor', () => {
  it('blocks commands with exit 6 on a merge conflict until doctor --fix renumbers the later Story', async () => {
    const { tmp, rowbly, json } = await project();
    const git = (...args: string[]) =>
      promisify(execFile)('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
        cwd: tmp.dir,
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      });
    await json('stories', 'create', '--board', 'web', '--name', 'Base');
    await git('init', '-q', '-b', 'main');
    await git('add', '-A');
    await git('commit', '-qm', 'base');
    await git('checkout', '-qb', 'feature');
    await json('stories', 'create', '--board', 'web', '--name', 'From feature');
    await git('add', '-A');
    await git('commit', '-qm', 'feature story');
    await git('checkout', '-q', 'main');
    await json('stories', 'create', '--board', 'web', '--name', 'From main');
    await git('add', '-A');
    await git('commit', '-qm', 'main story');
    await expect(git('merge', 'feature')).rejects.toMatchObject({
      stdout: expect.stringContaining('CONFLICT (add/add)'),
    });

    const blocked = await rowbly('stories', 'list', '--board', 'web', '--json');
    expect(blocked.exitCode).toBe(6);
    expect(jsonError(blocked).code).toBe('DATA_INTEGRITY');
    const check = await rowbly('doctor', '--json');
    expect(check.exitCode).toBe(6);
    expect(JSON.parse(check.stdout).findings).toEqual([
      expect.objectContaining({ code: 'STORY_KEY_CONFLICT', fixable: true }),
    ]);

    await json('doctor', '--fix');
    expect(await json('doctor')).toMatchObject({ findings: [], summary: { errors: 0 } });
    const names = (await json('stories', 'list', '--board', 'web')).map(
      (s: { key: string; name: string }) => `${s.key} ${s.name}`,
    );
    expect(names.sort()).toEqual(['WEB-1 Base', 'WEB-2 From feature', 'WEB-3 From main']);
  });

  it('reports a Story in a Stage that no longer exists as an error that a move repairs', async () => {
    const { tmp, json, rowbly } = await project();
    await json('stories', 'create', '--board', 'web', '--name', 'Login');
    const file = join(tmp.path, 'boards/web/stories/WEB-1/story.json');
    await writeFile(file, (await readFile(file, 'utf8')).replace('"stage": "backlog"', '"stage": "gone"'));

    const check = await rowbly('doctor', '--json');
    expect(check.exitCode).toBe(6);
    expect(JSON.parse(check.stdout).findings).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_STAGE', fixable: false }),
    ]);
    expect((await rowbly('doctor', '--fix', '--json')).exitCode).toBe(6);
    await json('stories', 'move', 'WEB-1', 'todo');
    expect((await rowbly('doctor', '--json')).exitCode).toBe(0);
  });
});
