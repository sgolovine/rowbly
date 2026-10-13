import type { Command } from 'commander';
import { UsageError } from '../core';
import { colors, describeCascadeLevels, printResult, renderTable } from '../output';
import type { WorkspaceConfig } from '../schemas';
import { assertWorkspaceRemovable, workspaceOverview } from '../services/workspaces';
import {
  type ContextFlags,
  confirmDestructive,
  promptIfMissing,
  readLongText,
  withContext,
  workspaceFlag,
} from './_shared';

interface DescriptionFlags {
  name?: string;
  description?: string;
  descriptionFile?: string;
  edit?: boolean;
}

function descriptionOptions(cmd: Command): Command {
  return cmd
    .option('--description <text>', 'description (markdown)')
    .option('--description-file <path>', 'read the description from a file, or - for stdin')
    .option('--edit', 'write the description in $VISUAL/$EDITOR');
}

function renderWorkspace(ws: WorkspaceConfig): string {
  return `${colors.bold(ws.id)}  ${ws.name}`;
}

export function registerWorkspaces(program: Command): void {
  const workspaces = program.command('workspaces').description('Manage Workspaces');

  workspaces
    .command('list')
    .description('List Workspaces')
    .action((_opts, cmd: Command) =>
      withContext(cmd, async ({ ctx, services, globals }) => {
        const list = await services.workspaces.list();
        printResult(list, {
          json: globals.json,
          human: (rows) =>
            rows.length === 0
              ? 'No Workspaces yet. Create one with `rowbly workspaces create <id> --name <name>`.'
              : renderTable(
                  ['', 'ID', 'NAME', 'ASSIGNEES', 'DESCRIPTION'],
                  rows.map((ws) => [
                    ws.id === ctx.local.workspace ? '*' : '',
                    ws.id,
                    ws.name,
                    String(ws.assignees.length),
                    firstLine(ws.description),
                  ]),
                ),
        });
      }),
    );

  descriptionOptions(
    workspaces
      .command('create <id>')
      .description('Create a Workspace')
      .option('--name <name>', 'display name (prompted for when missing)'),
  ).action((id: string, opts: DescriptionFlags, cmd: Command) =>
    withContext(cmd, async ({ services, globals }) => {
      const name = await promptIfMissing(opts.name, globals, { flag: '--name', message: 'Workspace name' });
      const description = await readLongText(
        { text: opts.description, file: opts.descriptionFile, edit: opts.edit },
        { name: 'description' },
      );
      const workspace = await services.workspaces.create({ id, name, description });
      printResult(workspace, { json: globals.json, human: (ws) => `Created Workspace ${renderWorkspace(ws)}` });
    }),
  );

  workspaces
    .command('show [id]')
    .description('Show a Workspace (default: the current one)')
    .option('--workspace <id>', 'Workspace to show when no id is given')
    .action((id: string | undefined, opts: ContextFlags, cmd: Command) =>
      withContext(cmd, async ({ ctx, services, globals }) => {
        const workspaceId = await services.context.resolveWorkspace(id ?? workspaceFlag(opts));
        const overview = await workspaceOverview(ctx, workspaceId);
        printResult(overview, {
          json: globals.json,
          human: (o) =>
            [
              renderWorkspace(o.workspace),
              ...(o.workspace.description ? ['', o.workspace.description, ''] : []),
              `Boards         ${o.boards}`,
              `Epics          ${o.epics}`,
              `Assignees      ${o.assignees}`,
              `Stages         ${describeCascadeLevels(o.overrides.stages, 'built-in defaults')}`,
              `Custom Fields  ${describeCascadeLevels(o.overrides.customFields, 'none')}`,
            ].join('\n'),
        });
      }),
    );

  descriptionOptions(
    workspaces.command('edit <id>').description('Edit a Workspace').option('--name <name>', 'new display name'),
  ).action((id: string, opts: DescriptionFlags, cmd: Command) =>
    withContext(cmd, async ({ services, globals }) => {
      const current = await services.workspaces.get(id);
      const description = await readLongText(
        { text: opts.description, file: opts.descriptionFile, edit: opts.edit },
        { name: 'description', initial: current.description },
      );
      if (opts.name === undefined && description === undefined) {
        throw new UsageError('nothing to change', { hint: 'pass --name or --description' });
      }
      const workspace = await services.workspaces.update(id, { name: opts.name, description });
      printResult(workspace, { json: globals.json, human: (ws) => `Updated Workspace ${renderWorkspace(ws)}` });
    }),
  );

  workspaces
    .command('delete <id>')
    .description('Delete a Workspace')
    .option('--force', 'also delete its Boards, Stories and Epics')
    .action((id: string, opts: { force?: boolean }, cmd: Command) =>
      withContext(cmd, async ({ ctx, services, globals }) => {
        const force = opts.force ?? false;
        const overview = await workspaceOverview(ctx, id);
        assertWorkspaceRemovable(id, overview, force);
        const contents = overview.boards + overview.epics > 0 ? ' and everything in it' : '';
        await confirmDestructive(`Delete Workspace "${id}"${contents}?`, globals);
        await services.workspaces.remove(id, { force });
        printResult({ deleted: id }, { json: globals.json, human: () => `Deleted Workspace ${id}` });
      }),
    );
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? '';
}
