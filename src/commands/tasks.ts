import type { Command } from 'commander';
import { UsageError } from '../core';
import { colorByCategory, colors, printResult, renderTable } from '../output';
import type { Stage, Story, Task } from '../schemas';
import type { Services } from '../services';
import { confirmDestructive, promptIfMissing, readLongText, withContext } from './_shared';

interface TaskOptions {
  name?: string;
  description?: string;
  descriptionFile?: string;
  edit?: boolean;
  stage?: string;
}

export function registerTasks(program: Command): void {
  const tasks = program.command('tasks').description('Manage the Tasks of a Story');

  tasks
    .command('list <key>')
    .description('List the Tasks of a Story in creation order')
    .action(async (key: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const story = await services.stories.get(key);
        if (globals.json) return printResult(story.tasks, { json: true, human: () => '' });
        const stages = await stagesOf(services, story);
        printResult(story.tasks, { json: false, human: (list) => renderTasks(list, stages) });
      }),
    );

  withDescription(
    tasks
      .command('create <key>')
      .description('Create a Task in a Story (default Stage: the first effective Stage)')
      .option('--name <name>', 'Task name')
      .option('--stage <key>', 'Stage (default: the first effective Stage)'),
  ).action(async (key: string, opts: TaskOptions, cmd: Command) =>
    withContext(cmd, async ({ services, globals }) => {
      const story = await services.stories.get(key);
      const name = await promptIfMissing(opts.name, globals, { flag: '--name', message: 'Task name' });
      const task = await services.tasks.create(story.key, {
        name,
        description: await readDescription(opts),
        stage: opts.stage,
      });
      printResult(task, { json: globals.json, human: (t) => `Created ${t.id}: ${t.name}` });
    }),
  );

  tasks
    .command('show <task-id>')
    .description("Show a Task with its Stage, description, Comments and the Story's Assignees")
    .action(async (taskId: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const { story, task } = await services.tasks.get(taskId);
        if (globals.json) return printResult(task, { json: true, human: () => '' });
        const stages = await stagesOf(services, story);
        printResult(task, { json: false, human: (t) => renderTask(t, story, stages) });
      }),
    );

  withDescription(
    tasks
      .command('edit <task-id>')
      .description('Edit the name or description of a Task')
      .option('--name <name>', 'new name'),
  ).action(async (taskId: string, opts: TaskOptions, cmd: Command) =>
    withContext(cmd, async ({ services, globals }) => {
      const current = opts.edit ? (await services.tasks.get(taskId)).task : undefined;
      const description = await readDescription(opts, current?.description);
      if (opts.name === undefined && description === undefined) {
        throw new UsageError('nothing to change', { hint: 'see `rowbly tasks edit --help`' });
      }
      const task = await services.tasks.update(taskId, { name: opts.name, description });
      printResult(task, { json: globals.json, human: (t) => `Updated ${t.id}` });
    }),
  );

  tasks
    .command('move <task-id> <stage>')
    .description("Move a Task to another of its Board's Stages")
    .action(async (taskId: string, stage: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const task = await services.tasks.move(taskId, stage);
        printResult(task, { json: globals.json, human: (t) => `Moved ${t.id} to ${t.stage}` });
      }),
    );

  tasks
    .command('delete <task-id>')
    .description('Delete a Task with its Comments (its id is never reused)')
    .action(async (taskId: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const { task } = await services.tasks.get(taskId);
        await confirmDestructive(`Delete ${task.id} "${task.name}"?`, globals);
        await services.tasks.remove(task.id);
        printResult({ deleted: task.id }, { json: globals.json, human: () => `Deleted ${task.id}` });
      }),
    );
}

/** The long-text description flags shared by `create` and `edit`. */
function withDescription(cmd: Command): Command {
  return cmd
    .option('--description <text>', 'description (markdown)')
    .option('--description-file <path>', 'read the description from a file, or - for stdin')
    .option('--edit', 'write the description in $VISUAL/$EDITOR');
}

function readDescription(opts: TaskOptions, initial?: string): Promise<string | undefined> {
  return readLongText(
    { text: opts.description, file: opts.descriptionFile, edit: opts.edit },
    { name: 'description', initial },
  );
}

async function stagesOf(services: Services, story: Story): Promise<Stage[]> {
  return (await services.config.effective(story.boardId)).stages;
}

/** A Stage name coloured by its Stage Category; an unknown Stage (drift) shows its key in red. */
function stageBadge(stages: readonly Stage[], key: string): string {
  const stage = stages.find((s) => s.key === key);
  return stage ? colorByCategory(stage.category, `● ${stage.name}`) : colors.red(`● ${key}?`);
}

function renderTasks(tasks: readonly Task[], stages: readonly Stage[]): string {
  if (tasks.length === 0) return colors.dim('No Tasks yet.');
  return renderTable(
    ['ID', 'NAME', 'STAGE', 'COMMENTS'],
    tasks.map((t) => [t.id, t.name, stageBadge(stages, t.stage), String(t.comments.length)]),
  );
}

function renderTask(task: Task, story: Story, stages: readonly Stage[]): string {
  const none = colors.dim('—');
  const rows: [string, string][] = [
    ['Story', `${story.key} ${story.name}`],
    ['Stage', stageBadge(stages, task.stage)],
    ['Assignees', story.assignees.length ? `${story.assignees.join(', ')} ${colors.dim('(from the Story)')}` : none],
    ['Created', task.createdAt],
    ['Updated', task.updatedAt],
  ];
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  const lines = [
    `${colors.bold(task.id)}  ${colors.bold(task.name)}`,
    ...rows.map(([label, value]) => `${colors.dim(`${label}:`.padEnd(width))}${value}`),
  ];
  if (task.description.trim()) lines.push('', colors.bold('Description'), task.description);
  lines.push('', `Comments: ${task.comments.length}`);
  return lines.join('\n');
}
