import type { Command } from 'commander';
import { UsageError } from '../core';
import { colorByCategory, colors, printResult, renderTable } from '../output';
import type { Stage } from '../schemas';
import type { EpicPatch, EpicView } from '../services';
import { stagesByBoard, storiesByBoard } from '../services/epics';
import { confirmDestructive, promptIfMissing, readLongText, withContext, workspaceFlag } from './_shared';

interface WorkspaceOpts {
  workspace?: string;
}

interface DescriptionOpts {
  description?: string;
  descriptionFile?: string;
  edit?: boolean;
}

export function registerEpics(program: Command): void {
  const epics = program.command('epics').description('Manage Epics in a Workspace');

  verb(epics, 'list', 'List Epics (open ones by default)')
    .option('--closed', 'show only closed Epics')
    .option('--all', 'show open and closed Epics')
    .action(async (opts: WorkspaceOpts & { closed?: boolean; all?: boolean }, cmd: Command) => {
      if (opts.closed && opts.all) throw new UsageError('use only one of --closed and --all');
      await withContext(cmd, async ({ services, globals }) => {
        const ws = await services.context.resolveWorkspace(workspaceFlag(opts));
        const list = await services.epics.list(ws, { closed: opts.all ? 'all' : Boolean(opts.closed) });
        const empty = opts.all ? 'No Epics.' : opts.closed ? 'No closed Epics.' : 'No open Epics.';
        printResult(list, { json: globals.json, human: (views) => (views.length ? epicTable(views) : empty) });
      });
    });

  descriptionOptions(verb(epics, 'create <id>', 'Create an Epic'))
    .option('--name <name>', 'display name')
    .action(async (id: string, opts: WorkspaceOpts & DescriptionOpts & { name?: string }, cmd: Command) => {
      await withContext(cmd, async ({ services, globals }) => {
        const ws = await services.context.resolveWorkspace(workspaceFlag(opts));
        const name = await promptIfMissing(opts.name, globals, { flag: '--name', message: 'Epic name' });
        const description = await readDescription(opts);
        const epic = await services.epics.create(ws, { id, name, description });
        printResult(epic, { json: globals.json, human: (e) => `Created Epic ${e.id}` });
      });
    });

  verb(epics, 'show <id>', 'Show an Epic and its Stories, grouped by Board').action(
    async (id: string, opts: WorkspaceOpts, cmd: Command) => {
      await withContext(cmd, async ({ services, globals }) => {
        const ws = await services.context.resolveWorkspace(workspaceFlag(opts));
        const view = await services.epics.get(ws, id);
        const stages = await stagesByBoard(services.config, view);
        printResult(view, { json: globals.json, human: (v) => epicDetail(v, stages) });
      });
    },
  );

  descriptionOptions(verb(epics, 'edit <id>', 'Edit an Epic'))
    .option('--name <name>', 'new display name')
    .action(async (id: string, opts: WorkspaceOpts & DescriptionOpts & { name?: string }, cmd: Command) => {
      await withContext(cmd, async ({ services, globals }) => {
        const ws = await services.context.resolveWorkspace(workspaceFlag(opts));
        const initial = opts.edit ? (await services.epics.get(ws, id)).description : '';
        const patch: EpicPatch = { name: opts.name, description: await readDescription(opts, initial) };
        if (patch.name === undefined && patch.description === undefined) {
          throw new UsageError('nothing to edit', { hint: 'pass --name or a description flag' });
        }
        const epic = await services.epics.update(ws, id, patch);
        printResult(epic, { json: globals.json, human: (e) => `Updated Epic ${e.id}` });
      });
    });

  for (const [name, closed] of [
    ['close', true],
    ['reopen', false],
  ] as const) {
    verb(epics, `${name} <id>`, closed ? 'Close an Epic' : 'Reopen a closed Epic').action(
      async (id: string, opts: WorkspaceOpts, cmd: Command) => {
        await withContext(cmd, async ({ services, globals }) => {
          const ws = await services.context.resolveWorkspace(workspaceFlag(opts));
          const epic = await services.epics.setClosed(ws, id, closed);
          printResult(epic, { json: globals.json, human: (e) => `${closed ? 'Closed' : 'Reopened'} Epic ${e.id}` });
        });
      },
    );
  }

  verb(epics, 'delete <id>', 'Delete an Epic and unlink its Stories').action(
    async (id: string, opts: WorkspaceOpts, cmd: Command) => {
      await withContext(cmd, async ({ services, globals }) => {
        const ws = await services.context.resolveWorkspace(workspaceFlag(opts));
        await services.epics.get(ws, id);
        await confirmDestructive(`Delete Epic "${id}"?`, globals);
        const result = await services.epics.remove(ws, id);
        printResult(result, { json: globals.json, human: () => `Deleted Epic ${id}` });
      });
    },
  );
}

function verb(parent: Command, nameAndArgs: string, description: string): Command {
  return parent
    .command(nameAndArgs)
    .description(description)
    .option('--workspace <id>', 'Workspace (default: current context)');
}

function descriptionOptions(cmd: Command): Command {
  return cmd
    .option('--description <text>', 'description (markdown)')
    .option('--description-file <path>', 'read the description from a file, or - for stdin')
    .option('--edit', 'write the description in $VISUAL/$EDITOR');
}

function readDescription(opts: DescriptionOpts, initial = ''): Promise<string | undefined> {
  return readLongText(
    { text: opts.description, file: opts.descriptionFile, edit: opts.edit },
    { name: 'description', initial },
  );
}

const BAR_WIDTH = 10;

/** `3/8 ███░░░░░░░` */
export function progressText({ done, total }: EpicView['progress']): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * BAR_WIDTH);
  return `${done}/${total} ${colors.green('█'.repeat(filled))}${colors.dim('░'.repeat(BAR_WIDTH - filled))}`;
}

function boardsSpanned(view: EpicView): string {
  return [...storiesByBoard(view.stories).keys()].sort().join(', ') || '—';
}

function epicTable(views: EpicView[]): string {
  return renderTable(
    ['ID', 'NAME', 'PROGRESS', 'BOARDS', 'CLOSED'],
    views.map((v) => [v.id, v.name, progressText(v.progress), boardsSpanned(v), v.closed ? 'yes' : 'no']),
  );
}

function stageBadge(stageKey: string, stages: readonly Stage[] | undefined): string {
  const stage = stages?.find((s) => s.key === stageKey);
  return stage ? colorByCategory(stage.category, `● ${stage.name}`) : colors.dim(`? ${stageKey}`);
}

function epicDetail(view: EpicView, stages: Map<string, Stage[]>): string {
  const lines = [
    `${colors.bold(view.name)} ${colors.dim(`(${view.id})`)}${view.closed ? ` ${colors.dim('[closed]')}` : ''}`,
    `Progress  ${progressText(view.progress)}`,
  ];
  if (view.description.trim()) lines.push('', view.description.trimEnd());
  lines.push('');
  if (view.stories.length === 0) lines.push(colors.dim('No Stories in this Epic.'));
  for (const [boardId, stories] of storiesByBoard(view.stories)) {
    lines.push(colors.bold(boardId));
    const rows = stories.map((s) => ({ s, badge: stageBadge(s.stage, stages.get(boardId)) }));
    const keyWidth = Math.max(...stories.map((s) => s.key.length));
    const badgeWidth = Math.max(...rows.map((r) => visibleLength(r.badge)));
    for (const { s, badge } of rows) {
      lines.push(`  ${s.key.padEnd(keyWidth)}  ${badge}${' '.repeat(badgeWidth - visibleLength(badge))}  ${s.name}`);
    }
  }
  return lines.join('\n');
}

function visibleLength(text: string): number {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes.
  return text.replace(/\u001B\[[0-9;]*m/g, '').length;
}
