import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../helpers';

/** Each contracts §6 exit code, produced by a real command against a real Data Root. */
describe('exit codes (contracts §6)', () => {
  let dir: string;
  const rowbly = (...args: string[]) => runCli(args, { cwd: dir });
  const config = () => join(dir, '.rowbly/boards/web/board.config.json');

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rowbly-exit-'));
    expect((await rowbly('init', '--board', 'web', '--board-name', 'Web', '--prefix', 'WEB')).exitCode).toBe(0);
    expect((await rowbly('stories', 'create', '--name', 'One')).exitCode).toBe(0);
    expect((await rowbly('plugins', 'enable', 'assignees')).exitCode).toBe(0);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const cases: { code: string | null; exit: number; args: string[]; setup?: () => Promise<void>; why: string }[] = [
    { code: null, exit: 0, args: ['stories', 'show', 'WEB-1'], why: 'success' },
    { code: 'USAGE', exit: 2, args: ['stories', 'create'], why: 'a required flag is missing and there is no TTY' },
    { code: 'USAGE', exit: 2, args: ['stories', 'list', '--bogus'], why: 'an unknown flag' },
    { code: 'USAGE', exit: 2, args: ['stories', 'delete', 'WEB-1'], why: 'destructive without --yes and no TTY' },
    {
      code: 'VALIDATION',
      exit: 2,
      args: ['boards', 'create', 'Bad Id', '--name', 'X', '--prefix', 'BAD'],
      why: 'not a slug',
    },
    {
      code: 'VALIDATION',
      exit: 2,
      args: ['stories', 'create', '--name', 'X', '--assignee', 'nobody'],
      why: 'an Assignee that is not in the roster',
    },
    { code: 'NOT_FOUND', exit: 3, args: ['stories', 'show', 'WEB-99'], why: 'unknown Story Key' },
    {
      code: 'CONFLICT',
      exit: 4,
      args: ['boards', 'create', 'web', '--name', 'Again', '--prefix', 'AGN'],
      why: 'the id exists',
    },
    {
      code: 'CONFLICT',
      exit: 4,
      args: ['boards', 'create', 'www', '--name', 'W', '--prefix', 'WEB'],
      why: 'the prefix exists',
    },
    {
      code: 'NO_DATA_ROOT',
      exit: 5,
      args: ['stories', 'list', '--root', join(tmpdir(), 'rowbly-missing')],
      why: 'no Data Root',
    },
    {
      code: 'DATA_INTEGRITY',
      exit: 6,
      args: ['boards', 'show', 'web'],
      setup: () => writeFile(config(), '{ not json'),
      why: 'a file that is not valid JSON',
    },
  ];

  it.each(cases)('exit $exit ($code): $why', async ({ code, exit, args, setup }) => {
    await setup?.();
    const human = await rowbly(...args);
    expect(human.exitCode).toBe(exit);
    const json = await rowbly(...args, '--json');
    expect(json.exitCode).toBe(exit);
    if (code === null) {
      expect(json.stderr).toBe('');
      return;
    }
    expect(human.stderr).toMatch(/^error: /);
    expect(json.stdout).toBe('');
    expect(JSON.parse(json.stderr).error.code).toBe(code);
  });

  it.skipIf(process.getuid?.() === 0)(
    'exit 1 (INTERNAL): an unexpected failure such as an unreadable file',
    async () => {
      await writeFile(config(), '{}');
      await chmod(config(), 0o000);
      try {
        const result = await rowbly('boards', 'show', 'web', '--json');
        expect(result.exitCode).toBe(1);
        expect(JSON.parse(result.stderr).error.code).toBe('INTERNAL');
      } finally {
        await chmod(config(), 0o644);
      }
    },
  );
});
