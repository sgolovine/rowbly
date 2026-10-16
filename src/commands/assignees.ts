import type { Command } from 'commander';
import { UsageError } from '../core';
import { colors, printResult, renderTable } from '../output';
import type { Assignee } from '../schemas';
import { pluginOptions, promptIfMissing, withContext } from './_shared';

interface AssigneeFlags {
  name?: string;
  email?: string;
}

function renderAssignee(a: Assignee): string {
  return `${colors.bold(a.handle)}  ${a.name}${a.email ? ` <${a.email}>` : ''}`;
}

export function registerAssignees(program: Command): void {
  const assignees = program.command('assignees').description('Manage the Assignee roster');

  assignees
    .command('list')
    .description('List Assignees')
    .action((_opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ ctx, services, globals }) => {
        const list = await services.assignees.list();
        printResult(list, {
          json: globals.json,
          human: (rows) =>
            rows.length === 0
              ? `No Assignees yet. Add one with \`rowbly assignees add <handle> --name <name>\`.`
              : renderTable(
                  ['', 'HANDLE', 'NAME', 'EMAIL'],
                  rows.map((a) => [a.handle === ctx.me ? '*' : '', a.handle, a.name, a.email ?? '']),
                ),
        });
      }),
    );

  assignees
    .command('add <handle>')
    .description('Add an Assignee')
    .option('--name <name>', 'display name (prompted for when missing)')
    .option('--email <email>', 'email address, used to recognise Me from `git config user.email`')
    .action((handle: string, opts: AssigneeFlags, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const name = await promptIfMissing(opts.name, globals, { flag: '--name', message: 'Assignee name' });
        const assignee = await services.assignees.add({ handle, name, email: opts.email, ...pluginOptions(cmd) });
        printResult(assignee, { json: globals.json, human: (a) => `Added Assignee ${renderAssignee(a)}` });
      }),
    );

  assignees
    .command('edit <handle>')
    .description('Edit an Assignee')
    .option('--name <name>', 'new display name')
    .option('--email <email>', 'new email address; an empty value removes it')
    .action((handle: string, opts: AssigneeFlags, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const operationOptions = pluginOptions(cmd);
        if (opts.name === undefined && opts.email === undefined && !operationOptions.plugins) {
          throw new UsageError('nothing to change', { hint: 'pass --name or --email' });
        }
        const email = opts.email === undefined ? undefined : opts.email || null;
        const assignee = await services.assignees.update(handle, { name: opts.name, email, ...operationOptions });
        printResult(assignee, { json: globals.json, human: (a) => `Updated Assignee ${renderAssignee(a)}` });
      }),
    );

  assignees
    .command('remove <handle>')
    .description('Remove an Assignee from the roster and from every Story')
    .action((handle: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const result = await services.assignees.remove(handle, pluginOptions(cmd));
        printResult({ removed: handle, ...result }, { json: globals.json, human: () => `Removed Assignee ${handle}` });
      }),
    );
}
