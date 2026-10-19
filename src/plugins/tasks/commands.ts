import {
  type Command,
  colorByCategory,
  colors,
  type PluginCommandEnv,
  type PluginCommands,
  renderTable,
  type Stage,
  type Story,
  UsageError,
} from '../../plugin-api';
import type { Task } from './model';
import { createTask, deleteTask, getTask, listTasks, moveTask, stagesOf, updateTask } from './tasks';

interface TaskOptions {
  name?: string;
  description?: string;
  descriptionFile?: string;
  edit?: boolean;
  stage?: string;
}

export const commands: PluginCommands = (group, cli) => {
  group
    .command('list <key>')
    .description('List the Tasks of a Story in creation order')
    .action((key: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, json, print }) => {
        const tasks = await listTasks(plugin, key);
        if (json) return print(tasks, () => '');
        const stages = await stagesOf(plugin, await plugin.services.stories.get(key));
        print(tasks, (list) => renderTasks(list, stages));
      }),
    );

  withDescription(
    group
      .command('create <key>')
      .description('Create a Task in a Story (default Stage: the first effective Stage)')
      .option('--name <name>', 'Task name')
      .option('--stage <key>', 'Stage (default: the first effective Stage)'),
  ).action((key: string, opts: TaskOptions, cmd) =>
    cli.run(cmd, async (env) => {
      const story = await env.services.stories.get(key);
      const name = await env.prompt(opts.name, { flag: '--name', message: 'Task name' });
      const task = await createTask(env.plugin, story.key, {
        name,
        description: await readDescription(env, opts),
        stage: opts.stage,
      });
      env.print(task, (t) => `Created ${t.id}: ${t.name}`);
    }),
  );

  group
    .command('show <task-id>')
    .description("Show a Task with its Stage, description and the Story's Assignees")
    .action((taskId: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, json, print }) => {
        const { story, task } = await getTask(plugin, taskId);
        if (json) return print(task, () => '');
        const stages = await stagesOf(plugin, story);
        print(task, (t) => renderTask(t, story, stages));
      }),
    );

  withDescription(
    group
      .command('edit <task-id>')
      .description('Edit the name or description of a Task')
      .option('--name <name>', 'new name'),
  ).action((taskId: string, opts: TaskOptions, cmd) =>
    cli.run(cmd, async (env) => {
      const current = opts.edit ? (await getTask(env.plugin, taskId)).task : undefined;
      const description = await readDescription(env, opts, current?.description);
      if (opts.name === undefined && description === undefined) {
        throw new UsageError('nothing to change', { hint: 'see `rowbly tasks edit --help`' });
      }
      const task = await updateTask(env.plugin, taskId, { name: opts.name, description });
      env.print(task, (t) => `Updated ${t.id}`);
    }),
  );

  group
    .command('move <task-id> <stage>')
    .description("Move a Task to another of its Board's Stages")
    .action((taskId: string, stage: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(await moveTask(plugin, taskId, stage), (t) => `Moved ${t.id} to ${t.stage}`);
      }),
    );

  group
    .command('delete <task-id>')
    .description('Delete a Task (its id is never reused)')
    .action((taskId: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print, confirm }) => {
        const { task } = await getTask(plugin, taskId);
        await confirm(`Delete ${task.id} "${task.name}"?`);
        print(await deleteTask(plugin, task.id), () => `Deleted ${task.id}`);
      }),
    );
};

/** The long-text description flags shared by `create` and `edit`. */
function withDescription(cmd: Command): Command {
  return cmd
    .option('--description <text>', 'description (markdown)')
    .option('--description-file <path>', 'read the description from a file, or - for stdin')
    .option('--edit', 'write the description in $VISUAL/$EDITOR');
}

function readDescription(env: PluginCommandEnv<unknown>, opts: TaskOptions, initial?: string) {
  return env.readText(
    { text: opts.description, file: opts.descriptionFile, edit: opts.edit },
    { name: 'description', initial },
  );
}

/** A Stage name coloured by its Stage Category; an unknown Stage (drift) shows its key in red. */
function stageBadge(stages: readonly Stage[], key: string): string {
  const stage = stages.find((s) => s.key === key);
  return stage ? colorByCategory(stage.category, `● ${stage.name}`) : colors.red(`● ${key}?`);
}

function renderTasks(tasks: readonly Task[], stages: readonly Stage[]): string {
  if (tasks.length === 0) return colors.dim('No Tasks yet.');
  return renderTable(
    ['ID', 'NAME', 'STAGE'],
    tasks.map((t) => [t.id, t.name, stageBadge(stages, t.stage)]),
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
  return lines.join('\n');
}
