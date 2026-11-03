import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { builtInPlugins } from '../../src/plugins';
import { applyBlock } from '../../src/plugins/software-factory/reportedCommands';
import { clearRun, endRun, startRun } from '../../src/plugins/software-factory/stageRuns';
import { FIXED_NOW, type RunCliResult, runCli, tempRoot } from '../helpers';
import { withPlugins } from '../plugins/helpers';

/**
 * Task checks for the agent skill in skills/rowbly: each test runs a documented workflow from its
 * SKILL.md or a page of its references/ through the built CLI, as an agent would (no TTY,
 * `--json --no-prompt`), and checks the claims and the mistakes the skill warns about.
 */

/** A project directory with a Data Root and Board `web`, made the way references/setup.md says. */
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

describe('rowbly skill: SKILL.md', () => {
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

describe('rowbly skill: references/setup.md', () => {
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

describe('rowbly skill: references/stories.md', () => {
  it('hands off a Story through configured ready and review Stages before completion, with Tasks', async () => {
    const { json } = await project();
    await json('stages', 'add', 'doing', '--name', 'Doing', '--after', 'todo', '--board', 'web', '--level', 'board');
    await json('stages', 'remove', 'in-progress', '--board', 'web');
    await json('stages', 'add', 'review', '--name', 'Review', '--after', 'doing', '--board', 'web', '--level', 'board');

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
    expect(stages.map((s: { key: string }) => s.key)).toEqual(['backlog', 'todo', 'doing', 'review', 'done']);
    // Refinement hands off to the ready Stage; development starts in Doing.
    await json('stories', 'move', created.key, first('board'));
    expect((await json('stories', 'show', created.key)).stage).toBe('todo');
    await json('stories', 'move', created.key, 'doing');
    await json('tasks', 'move', task.id, first('done'));
    expect((await json('stories', 'show', created.key)).stage).toBe('doing');
    // Completing implementation and its Tasks still leaves the Story open for review.
    await json('stories', 'move', created.key, 'review');
    expect((await json('stories', 'list', '--board', 'web', '--open')).map((s: { stage: string }) => s.stage)).toEqual([
      'review',
    ]);
    // Only after review is complete does the Story leave the open workflow.
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

describe('rowbly skill: references/plugins.md and plugin-*.md', () => {
  it('turns Plugins on and uses Epics, Specs and Comments as documented', async () => {
    const { tmp, rowbly, json } = await project();
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
      ['attachments', false, false],
      ['story-linking', false, false],
      ['git', false, false],
      ['software-factory', false, false],
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

    // plugin-software-factory.md: a Story with a Stage Run in this visit is left alone; a move ends the visit.
    await json('plugins', 'enable', 'software-factory');
    await json('software-factory', 'prompt', 'enable', 'todo', '--board', 'web');
    const worked = await json('stories', 'create', '--board', 'web', '--name', 'Signup', '--stage', 'todo');
    expect((await json('software-factory', 'run', 'start', worked.key, '--worker', 'w1')).stageRun).toMatchObject({
      stage: 'todo',
      status: 'running',
      attempt: 1,
    });
    expect(
      jsonError(await rowbly('software-factory', 'run', 'start', worked.key, '--worker', 'w2', '--json')).code,
    ).toBe('CONFLICT');
    await json('stories', 'move', worked.key, 'in-progress');
    await json('stories', 'move', worked.key, 'todo');
    expect((await json('software-factory', 'runs', '--board', 'web')).stories).toEqual([
      {
        key: worked.key,
        name: 'Signup',
        stage: 'todo',
        stageRun: null,
        runMetadata: { status: 'absent', current: false },
        eligibility: { eligible: true, reasons: [] },
      },
    ]);

    // A new incoming link invalidates launch eligibility without creating a Stage Run.
    await json('plugins', 'enable', 'story-linking');
    await json('stories', 'move', story.key, 'in-progress');
    await json('story-linking', 'add', story.key, '--blocks', worked.key);
    const blocked = {
      eligible: false,
      reasons: [
        {
          code: 'BLOCKED',
          message: `Blocked by ${story.key}`,
          blockers: [{ key: story.key, name: 'Login page', stage: 'in-progress' }],
        },
      ],
    };
    expect((await json('software-factory', 'runs', '--board', 'web')).stories[0].eligibility).toEqual(blocked);
    const refused = await rowbly('software-factory', 'run', 'start', worked.key, '--worker', 'w3', '--json');
    expect(refused.exitCode).toBe(4);
    expect(jsonError(refused)).toMatchObject({ code: 'CONFLICT', details: { eligibility: blocked } });
    expect((await json('software-factory', 'runs', '--board', 'web')).stories[0].stageRun).toBeNull();
    await json('stories', 'move', story.key, 'done');
    expect((await json('software-factory', 'runs', '--board', 'web')).stories[0].eligibility).toEqual({
      eligible: true,
      reasons: [],
    });
    await json('software-factory', 'run', 'start', worked.key, '--worker', 'w3');

    // A worker's reported block: a line that writes another Story refuses all of it; a move waits for `run finish`.
    const block = (...lines: string[]) => ['```rowbly', ...lines, '```'].join('\n');
    const own = `rowbly comments add ${worked.key} --body 'PR opened'`;
    const move = `rowbly stories move ${worked.key} done`;
    const storyJson = (key: string) => readFile(join(tmp.path, `boards/web/stories/${key}/story.json`), 'utf8');
    const blocker = await storyJson(story.key);
    const refusedBlock = jsonError(
      await rowbly(
        'software-factory',
        'apply',
        worked.key,
        '--text',
        block(
          own,
          `rowbly stories move ${story.key} todo`,
          `rowbly story-linking remove ${worked.key} --blocked-by=${story.key}`,
        ),
        '--json',
      ),
    );
    expect(refusedBlock.code).toBe('USAGE');
    expect((refusedBlock.details.commands as { decision: string }[]).map((c) => c.decision)).toEqual([
      'apply',
      'reject',
      'reject',
    ]);
    expect(await json('comments', 'list', worked.key)).toEqual([]);
    expect(await storyJson(story.key)).toBe(blocker);
    const applied = await json('software-factory', 'apply', worked.key, '--text', block(move, own));
    expect(applied.commands.map((c: { line: number; decision: string }) => [c.line, c.decision])).toEqual([
      [3, 'apply'],
      [2, 'hold'],
    ]);
    await json('software-factory', 'run', 'finish', worked.key);

    // The Stage Run is replaced between the block's Comment and its move: the move's own operation refuses it.
    const { services } = await withPlugins(tmp, builtInPlugins);
    const sf = services.plugins.context('software-factory');
    let replaced = '';
    const runCommand = async (argv: readonly string[]) => {
      if (argv[1] === 'move') {
        await json('software-factory', 'run', 'clear', worked.key);
        await json('software-factory', 'run', 'start', worked.key, '--worker', 'w4');
        replaced = await storyJson(worked.key);
      }
      const result = await rowbly(...argv, '--json');
      return { exitCode: result.exitCode, output: JSON.parse(result.exitCode ? result.stderr : result.stdout) };
    };
    await expect(applyBlock({ plugin: sf, runCommand }, worked.key, block(own, move), false)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await storyJson(worked.key)).toBe(replaced);
    // A Run with the same start but another attempt or Stage is not the Run a move names.
    await clearRun(sf, worked.key);
    await startRun(sf, worked.key, { worker: 'w5' });
    await endRun(sf, worked.key, { status: 'failed' });
    await startRun(sf, worked.key, { worker: 'w5', retry: true });
    await endRun(sf, worked.key, { status: 'finished' });
    const sameClock = await storyJson(worked.key);
    for (const ref of [`todo/1/${FIXED_NOW}`, `in-progress/2/${FIXED_NOW}`])
      expect(jsonError(await rowbly('stories', 'move', worked.key, 'done', '--finished-run', ref, '--json')).code).toBe(
        'CONFLICT',
      );
    expect(await storyJson(worked.key)).toBe(sameClock);

    const finalMove = await json('software-factory', 'apply', worked.key, '--text', move);
    expect(finalMove.commands[0].argv.slice(-2)).toEqual(['--finished-run', `todo/2/${FIXED_NOW}`]);
    const moved = await json('stories', 'show', worked.key);
    expect([moved.stage, moved.plugins['software-factory']]).toEqual(['done', undefined]);
    expect(await json('comments', 'list', worked.key)).toHaveLength(2);

    expect((await rowbly('plugins', 'disable', 'comments')).exitCode).toBe(0);
    expect((await json('stories', 'show', story.key)).plugins.comments.comments).toHaveLength(1);
  });
});

describe('rowbly skill: references/doctor.md', () => {
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
