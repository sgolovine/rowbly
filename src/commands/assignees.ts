import type { Command } from 'commander';
import { UsageError } from '../core';
import { colors, printResult, renderTable } from '../output';
import type { Assignee } from '../schemas';
import { type ContextFlags, promptIfMissing, withContext, workspaceFlag } from './_shared';

interface AssigneeFlags extends ContextFlags {
  name?: string;
  email?: string;
}

function withWorkspace(cmd: Command): Command {
  return cmd.option('--workspace <id>', 'Workspace whose roster to use');
}

function renderAssignee(a: Assignee): string {
  return `${colors.bold(a.handle)}  ${a.name}${a.email ? ` <${a.email}>` : ''}`;
}

export function registerAssignees(program: Command): void {
  const assignees = program.command('assignees').description('Manage the Assignee roster of a Workspace');

  withWorkspace(assignees.command('list').description('List Assignees')).action((opts: ContextFlags, cmd: Command) =>
    withContext(cmd, async ({ ctx, services, globals }) => {
      const ws = await services.context.resolveWorkspace(workspaceFlag(opts));
      const list = await services.assignees.list(ws);
      printResult(list, {
        json: globals.json,
        human: (rows) =>
          rows.length === 0
            ? `No Assignees in Workspace "${ws}". Add one with \`rowbly assignees add <handle> --name <name>\`.`
            : renderTable(
                ['', 'HANDLE', 'NAME', 'EMAIL'],
                rows.map((a) => [a.handle === ctx.me ? '*' : '', a.handle, a.name, a.email ?? '']),
              ),
      });
    }),
  );

  withWorkspace(
    assignees
      .command('add <handle>')
      .description('Add an Assignee')
      .option('--name <name>', 'display name (prompted for when missing)')
      .option('--email <email>', 'email address, used to recognise Me from `git config user.email`'),
  ).action((handle: string, opts: AssigneeFlags, cmd: Command) =>
    withContext(cmd, async ({ services, globals }) => {
      const ws = await services.context.resolveWorkspace(workspaceFlag(opts));
      const name = await promptIfMissing(opts.name, globals, { flag: '--name', message: 'Assignee name' });
      const assignee = await services.assignees.add(ws, { handle, name, email: opts.email });
      printResult(assignee, { json: globals.json, human: (a) => `Added Assignee ${renderAssignee(a)}` });
    }),
  );

  withWorkspace(
    assignees
      .command('edit <handle>')
      .description('Edit an Assignee')
      .option('--name <name>', 'new display name')
      .option('--email <email>', 'new email address; an empty value removes it'),
  ).action((handle: string, opts: AssigneeFlags, cmd: Command) =>
    withContext(cmd, async ({ services, globals }) => {
      if (opts.name === undefined && opts.email === undefined) {
        throw new UsageError('nothing to change', { hint: 'pass --name or --email' });
      }
      const ws = await services.context.resolveWorkspace(workspaceFlag(opts));
      const email = opts.email === undefined ? undefined : opts.email || null;
      const assignee = await services.assignees.update(ws, handle, { name: opts.name, email });
      printResult(assignee, { json: globals.json, human: (a) => `Updated Assignee ${renderAssignee(a)}` });
    }),
  );

  withWorkspace(
    assignees
      .command('remove <handle>')
      .description('Remove an Assignee from the roster and from every Story in the Workspace'),
  ).action((handle: string, opts: ContextFlags, cmd: Command) =>
    withContext(cmd, async ({ services, globals }) => {
      const ws = await services.context.resolveWorkspace(workspaceFlag(opts));
      const result = await services.assignees.remove(ws, handle);
      printResult(
        { removed: handle, ...result },
        { json: globals.json, human: () => `Removed Assignee ${handle} from Workspace ${ws}` },
      );
    }),
  );
}
