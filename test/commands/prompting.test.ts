import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBoards } from '../../src/commands/boards';
import { createRepositories } from '../../src/storage';
import { makeBoard, tempRoot } from '../helpers';

vi.mock('@clack/prompts', () => ({
  text: vi.fn(async () => 'Prompted Name'),
  select: vi.fn(),
  confirm: vi.fn(async () => true),
  isCancel: () => false,
}));

/** The program as `cli.ts` builds it, with only this package's commands. */
function program(): Command {
  const cli = new Command('rowbly')
    .option('--root <path>')
    .option('--json')
    .option('--yes')
    .option('--no-prompt')
    .exitOverride();
  registerBoards(cli);
  return cli;
}

/** Runs in-process with stdin and stdout pretending to be TTYs. */
describe('prompting with a TTY', () => {
  const tty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };
  beforeEach(() => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    process.stdin.isTTY = tty.stdin;
    process.stdout.isTTY = tty.stdout;
    vi.restoreAllMocks();
  });

  it('asks for a missing --name through Clack', async () => {
    const t = await tempRoot();
    await program().parseAsync(['boards', 'create', 'web', '--prefix', 'WEB', '--root', t.path], { from: 'user' });
    const { text } = await import('@clack/prompts');
    expect(text).toHaveBeenCalledWith(expect.objectContaining({ message: 'Board name' }));
    const repos = createRepositories(t.root);
    expect((await repos.boards.get('web')).name).toBe('Prompted Name');
  });

  it('confirms a delete through Clack', async () => {
    const t = await tempRoot();
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    await program().parseAsync(['boards', 'delete', 'web', '--root', t.path], { from: 'user' });
    const { confirm } = await import('@clack/prompts');
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'Delete Board web?' }));
    expect(await createRepositories(t.root).boards.list()).toEqual([]);
  });

  it('never prompts with --no-prompt', async () => {
    const t = await tempRoot();
    const run = program().parseAsync(['boards', 'create', 'web', '--prefix', 'WEB', '--no-prompt', '--root', t.path], {
      from: 'user',
    });
    await expect(run).rejects.toMatchObject({ code: 'USAGE', exitCode: 2 });
  });
});
