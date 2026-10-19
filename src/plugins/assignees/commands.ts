import { colors, type PluginCommands, renderTable, UsageError } from '../../plugin-api';
import type { Assignee } from './model';
import { listAssignees } from './roster';
import { addAssignee, editAssignee, removeAssignee } from './service';

interface AssigneeFlags {
  name?: string;
  email?: string;
}

function renderAssignee(a: Assignee): string {
  return `${colors.bold(a.handle)}  ${a.name}${a.email ? ` <${a.email}>` : ''}`;
}

export const commands: PluginCommands = (group, cli) => {
  group
    .command('list')
    .description('List Assignees')
    .action((_opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(await listAssignees(plugin), (rows) =>
          rows.length === 0
            ? 'No Assignees yet. Add one with `rowbly assignees add <handle> --name <name>`.'
            : renderTable(
                ['', 'HANDLE', 'NAME', 'EMAIL'],
                rows.map((a) => [a.handle === plugin.me ? '*' : '', a.handle, a.name, a.email ?? '']),
              ),
        );
      }),
    );

  group
    .command('add <handle>')
    .description('Add an Assignee')
    .option('--name <name>', 'display name (prompted for when missing)')
    .option('--email <email>', 'email address')
    .action((handle: string, opts: AssigneeFlags, cmd) =>
      cli.run(cmd, async ({ plugin, print, prompt }) => {
        const name = await prompt(opts.name, { flag: '--name', message: 'Assignee name' });
        const assignee = await addAssignee(plugin, { handle, name, email: opts.email });
        print(assignee, (a) => `Added Assignee ${renderAssignee(a)}`);
      }),
    );

  group
    .command('edit <handle>')
    .description('Edit an Assignee')
    .option('--name <name>', 'new display name')
    .option('--email <email>', 'new email address; an empty value removes it')
    .action((handle: string, opts: AssigneeFlags, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        if (opts.name === undefined && opts.email === undefined) {
          throw new UsageError('nothing to change', { hint: 'pass --name or --email' });
        }
        const email = opts.email === undefined ? undefined : opts.email || null;
        const assignee = await editAssignee(plugin, handle, { name: opts.name, email });
        print(assignee, (a) => `Updated Assignee ${renderAssignee(a)}`);
      }),
    );

  group
    .command('remove <handle>')
    .description('Remove an Assignee from the roster and from every Story')
    .action((handle: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        const { storiesUpdated } = await removeAssignee(plugin, handle);
        print({ removed: handle, storiesUpdated }, () => `Removed Assignee ${handle}`);
      }),
    );
};
