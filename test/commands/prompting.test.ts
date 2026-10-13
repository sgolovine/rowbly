import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAssignees } from '../../src/commands/assignees';
import { registerWorkspaces } from '../../src/commands/workspaces';
import { createRepositories } from '../../src/storage';
import { makeWorkspace, tempRoot } from '../helpers';

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
  registerWorkspaces(cli);
  registerAssignees(cli);
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
    await program().parseAsync(['workspaces', 'create', 'acme', '--root', t.path], { from: 'user' });
    await program().parseAsync(['assignees', 'add', 'sam', '--root', t.path], { from: 'user' });
    const { text } = await import('@clack/prompts');
    expect(text).toHaveBeenCalledWith(expect.objectContaining({ message: 'Workspace name' }));
    expect(text).toHaveBeenCalledWith(expect.objectContaining({ message: 'Assignee name' }));
    const workspace = await createRepositories(t.root).workspaces.get('acme');
    expect(workspace.name).toBe('Prompted Name');
    expect(workspace.assignees).toEqual([{ handle: 'sam', name: 'Prompted Name' }]);
  });

  it('confirms a delete through Clack', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    await program().parseAsync(['workspaces', 'delete', 'acme', '--root', t.path], { from: 'user' });
    const { confirm } = await import('@clack/prompts');
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'Delete Workspace "acme"?' }));
    expect(await createRepositories(t.root).workspaces.list()).toEqual([]);
  });

  it('never prompts with --no-prompt', async () => {
    const t = await tempRoot();
    const run = program().parseAsync(['workspaces', 'create', 'acme', '--no-prompt', '--root', t.path], {
      from: 'user',
    });
    await expect(run).rejects.toMatchObject({ code: 'USAGE', exitCode: 2 });
  });
});
