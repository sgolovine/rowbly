import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { type RunCliResult, runCli, tempRoot } from '../helpers';

/**
 * Task checks for the agent skills in skills/: each test runs a skill's documented workflow through
 * the built CLI, as an agent would (no TTY, `--json --no-prompt`), and checks the claims and the
 * mistakes the skill warns about.
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
});

describe('rowbly-setup', () => {
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
    ]);

    await json('epics', 'create', 'auth', '--name', 'Authentication');
    const story = await json('stories', 'create', '--board', 'web', '--name', 'Login page', '--epic', 'auth');
    expect(story.plugins.epics).toEqual({ epic: 'auth' });

    await json('specs', 'create', '--story', story.key, '--title', 'Login page', '--text', 'Email only.');
    expect(await json('specs', 'show', '--story', story.key.toLowerCase())).toEqual({
      title: 'Login page',
      text: '# Login page\n\nEmail only.',
    });
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
});
