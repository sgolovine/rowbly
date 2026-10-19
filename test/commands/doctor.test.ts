import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { StorySchema } from '../../src/schemas';
import type { DoctorReport } from '../../src/services';
import { makeBoard, makeStory, runCli, tempRoot } from '../helpers';

const STORIES = 'boards/web/stories';

/** Mirrors `DoctorReport`; strict, so unexpected keys fail too. */
const DoctorReportSchema = z.strictObject({
  findings: z.array(
    z.strictObject({
      code: z.string(),
      severity: z.enum(['error', 'warning', 'info']),
      path: z.string(),
      message: z.string(),
      fixable: z.boolean(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  fixed: z.array(z.strictObject({ code: z.string(), path: z.string(), message: z.string() })),
  summary: z.strictObject({ errors: z.number(), warnings: z.number(), info: z.number() }),
});

function parseReport(stdout: string): DoctorReport {
  return DoctorReportSchema.parse(JSON.parse(stdout)) as DoctorReport;
}

async function setup() {
  const tmp = await tempRoot();
  await makeBoard(tmp.path, { id: 'web', keyPrefix: 'WEB' });
  const cli = (...args: string[]) => runCli(args, { root: tmp.path });
  return { tmp, cli };
}

/** Runs git in `cwd` without reading the user's or system git config. */
function git(cwd: string, ...args: string[]) {
  return promisify(execFile)('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
}

describe('rowbly doctor', () => {
  it('prints "No problems found" and exits 0 for a healthy Data Root', async () => {
    const { tmp, cli } = await setup();
    await makeStory(tmp.path, { key: 'WEB-1', boardId: 'web' });
    expect(await cli('doctor')).toEqual({ stdout: 'No problems found\n', stderr: '', exitCode: 0 });
    const json = await cli('doctor', '--json');
    expect(json.exitCode).toBe(0);
    expect(parseReport(json.stdout)).toEqual({ findings: [], fixed: [], summary: { errors: 0, warnings: 0, info: 0 } });
  });

  it('repairs an add/add Story Key conflict from two merged git branches', async () => {
    const { tmp, cli } = await setup();
    await writeFile(join(tmp.path, '.gitignore'), 'local.json\n.lock\n.lock.break\n.txn/\n');
    for (let n = 1; n <= 3; n++) expect((await cli('stories', 'create', '--name', `Base ${n}`)).exitCode).toBe(0);
    await git(tmp.dir, 'init', '-q', '-b', 'main');
    await git(tmp.dir, 'add', '-A');
    await git(tmp.dir, 'commit', '-qm', 'base');

    await git(tmp.dir, 'checkout', '-qb', 'login');
    expect((await cli('stories', 'create', '--name', 'Login page')).stdout).toContain('WEB-4');
    await git(tmp.dir, 'add', '-A');
    await git(tmp.dir, 'commit', '-qm', 'login');
    await git(tmp.dir, 'checkout', '-q', 'main');
    await git(tmp.dir, 'checkout', '-qb', 'signup');
    expect((await cli('stories', 'create', '--name', 'Signup page')).stdout).toContain('WEB-4');
    await git(tmp.dir, 'add', '-A');
    await git(tmp.dir, 'commit', '-qm', 'signup');
    await git(tmp.dir, 'checkout', '-q', 'login');
    await expect(git(tmp.dir, 'merge', 'signup')).rejects.toMatchObject({
      stdout: expect.stringMatching(/CONFLICT \(add\/add\).*WEB-4\/story\.json/),
    });

    const check = await cli('doctor');
    expect(check.exitCode).toBe(6);
    expect(check.stdout).toContain('STORY_KEY_CONFLICT');
    expect(check.stdout).toContain('hint: run `rowbly doctor --fix` to fix 1 finding');
    const json = await cli('doctor', '--json');
    expect(json.exitCode).toBe(6);
    expect(parseReport(json.stdout).findings).toEqual([
      expect.objectContaining({ code: 'STORY_KEY_CONFLICT', severity: 'error', path: `${STORIES}/WEB-4/story.json` }),
    ]);

    const fix = await cli('doctor', '--fix', '--json');
    expect(fix.exitCode).toBe(0);
    expect(parseReport(fix.stdout).fixed[0]?.message).toBe(
      'kept WEB-4 ("Login page") and renumbered "Signup page" to WEB-5',
    );
    const files = await readdir(join(tmp.path, STORIES));
    expect(files.sort()).toEqual(['WEB-1', 'WEB-2', 'WEB-3', 'WEB-4', 'WEB-5']);
    const read = async (key: string) =>
      StorySchema.parse(JSON.parse(await readFile(join(tmp.path, STORIES, key, 'story.json'), 'utf8')));
    expect((await read('WEB-4')).name).toBe('Login page');
    expect((await read('WEB-5')).name).toBe('Signup page');
    expect((await cli('stories', 'show', 'WEB-5')).exitCode).toBe(0);

    expect(await cli('doctor')).toEqual({ stdout: 'No problems found\n', stderr: '', exitCode: 0 });
  });

  it('groups findings by severity and exits 6 while errors remain after --fix', async () => {
    const { tmp, cli } = await setup();
    await makeStory(tmp.path, { key: 'WEB-1', boardId: 'web', stage: 'gone', customFields: { ghost: 1 } });
    await writeFile(join(tmp.path, 'notes.txt'), 'hi');
    const { stdout, exitCode } = await cli('doctor');
    expect(exitCode).toBe(6);
    expect(stdout).toBe(
      [
        'Errors (1)',
        `  UNKNOWN_STAGE  ${STORIES}/WEB-1/story.json`,
        '    WEB-1 is in unknown Stage "gone"',
        '    hint: run `rowbly stories move WEB-1 <stage>`',
        '',
        'Warnings (1)',
        `  UNKNOWN_FIELD  ${STORIES}/WEB-1/story.json (fixable)`,
        '    WEB-1 has a value for unknown Custom Field "ghost"',
        '',
        'Info (1)',
        '  UNKNOWN_FILE  notes.txt',
        '    file is not part of the Data Root layout; Rowbly ignores it',
        '',
        '1 error, 1 warning, 1 info',
        'hint: run `rowbly doctor --fix` to fix 1 finding',
        '',
      ].join('\n'),
    );

    const fix = await cli('doctor', '--fix');
    expect(fix.exitCode).toBe(6);
    expect(fix.stdout).toMatch(
      /^Fixed \(1\)\n {2}UNKNOWN_FIELD {2}\S+WEB-1\/story\.json\n {4}stripped unknown Custom Field "ghost" from WEB-1\n/,
    );
    expect(fix.stdout).toContain('1 error, 0 warnings, 1 info');
    expect(fix.stdout).not.toContain('hint: run `rowbly doctor --fix`');
  });

  it('reports a Story the board view hides because its Stage is no longer configured', async () => {
    const { tmp, cli } = await setup();
    expect((await cli('stories', 'create', '--name', 'Ship it', '--stage', 'in-progress')).exitCode).toBe(0);
    // A hand edit or merge drops the Stage from the Board without moving its Stories.
    const boardFile = join(tmp.path, 'boards/web/board.config.json');
    const board = JSON.parse(await readFile(boardFile, 'utf8'));
    board.stages = [
      { key: 'todo', name: 'Todo', category: 'todo' },
      { key: 'done', name: 'Done', category: 'done' },
    ];
    await writeFile(boardFile, JSON.stringify(board, null, 2));

    const json = await cli('doctor', '--json');
    expect(json.exitCode).toBe(6);
    expect(parseReport(json.stdout).findings).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_STAGE',
        severity: 'error',
        path: `${STORIES}/WEB-1/story.json`,
        message: 'WEB-1 is in unknown Stage "in-progress"',
        fixable: false,
      }),
    ]);
    expect((await cli('stories', 'move', 'WEB-1', 'done')).exitCode).toBe(0);
    expect((await cli('doctor')).exitCode).toBe(0);
  });

  it('has help text', async () => {
    const { stdout, exitCode } = await runCli(['doctor', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--fix');
    expect(stdout).toContain('Exits 0 when no errors remain and 6 when errors remain');
  });
});
