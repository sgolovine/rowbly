import type { Command } from 'commander';
import { UsageError } from '../core';
import { colorByCategory, colors, printResult, renderTable } from '../output';
import {
  type CustomFieldDef,
  type CustomFieldValue,
  type Priority,
  PrioritySchema,
  type Stage,
  type StageCategory,
  StageCategorySchema,
  type Story,
} from '../schemas';
import type { RankPosition, Services, StoryFilter, StoryPatch, StorySort } from '../services';
import {
  boardFlag,
  type ContextFlags,
  collect,
  confirmDestructive,
  parseFieldAssignments,
  parseRepeatable,
  promptIfMissing,
  readLongText,
  withContext,
  workspaceFlag,
} from './_shared';

const SORTS: readonly StorySort[] = ['rank', 'priority', 'created', 'updated', 'due'];

interface StoryOptions extends ContextFlags {
  name?: string;
  description?: string;
  descriptionFile?: string;
  edit?: boolean;
  stage?: string[] | string;
  category?: string;
  open?: boolean;
  assignee?: string[];
  addAssignee?: string[];
  removeAssignee?: string[];
  /** `--epic <id>` or `false` with `--no-epic`. */
  epic?: string | false;
  /** `--priority <P>` (repeatable on `list`) or `false` with `--no-priority`. */
  priority?: string[] | string | false;
  label?: string[];
  addLabel?: string[];
  removeLabel?: string[];
  /** `--due <date>` or `false` with `--no-due`. */
  due?: string | false;
  field?: string[];
  unsetField?: string[];
  search?: string;
  sort?: string;
  allBoards?: boolean;
  top?: boolean;
  bottom?: boolean;
  before?: string;
  after?: string;
}

const boardOption = ['--board <id>', 'the Board, or <workspace>/<board> (default: current context)'] as const;
const wsOption = ['--workspace <id>', 'the Workspace (default: current context)'] as const;

export function registerStories(program: Command): void {
  const stories = program.command('stories').description('Manage Stories on a Board');

  stories
    .command('list')
    .description('List Stories, sorted by Stage order then Rank unless --sort is given')
    .option('--stage <key>', 'only these Stages (repeatable)', collect)
    .option('--category <category>', `only this Stage Category: ${StageCategorySchema.options.join(', ')}`)
    .option('--open', 'only Stories whose Stage Category is not done')
    .option('--assignee <handle>', 'only Stories with any of these Assignees; "me" is Me (repeatable)', collect)
    .option('--epic <id>', 'only Stories in this Epic')
    .option('--no-epic', 'only Stories without an Epic')
    .option('--label <label>', 'only Stories with any of these Labels (repeatable)', collect)
    .option('--priority <P>', 'only these Priorities, P0–P4 (repeatable)', collect)
    .option('--search <text>', 'case-insensitive match on name and description')
    .option('--sort <order>', `${SORTS.join('|')} (priority: most urgent first; updated: newest first)`)
    .option('--all-boards', 'every Board in the Workspace')
    .option(...boardOption)
    .option(...wsOption)
    .action(async (opts: StoryOptions, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const filter = listFilter(opts);
        const scope = opts.allBoards
          ? { workspaceId: await services.context.resolveWorkspace(workspaceFlag(opts)) }
          : await services.context.resolveBoard(boardFlag(opts), workspaceFlag(opts));
        const list = await services.stories.list(scope, filter);
        if (globals.json) return printResult(list, { json: true, human: () => '' });
        const stages = await stagesByBoard(services, list);
        printResult(list, { json: false, human: (l) => renderStories(l, stages) });
      }),
    );

  withStoryFields(
    stories
      .command('create')
      .description('Create a Story at the bottom of its Stage (default: the first Stage)')
      .option('--name <name>', 'Story name')
      .option('--stage <key>', 'Stage (default: the first effective Stage)')
      .option('--assignee <handle>', 'Assignee handle; "me" is Me (repeatable, comma-separated)', collect)
      .option('--epic <id>', 'Epic in the same Workspace')
      .option('--priority <P>', 'Priority P0–P4')
      .option('--label <label>', 'Label (repeatable, comma-separated)', collect)
      .option('--due <date>', 'due date, YYYY-MM-DD')
      .option('--field <key=value>', 'Custom Field value (repeatable)', collect)
      .option(...boardOption)
      .option(...wsOption),
  ).action(async (opts: StoryOptions, cmd: Command) =>
    withContext(cmd, async ({ services, globals }) => {
      const ref = await services.context.resolveBoard(boardFlag(opts), workspaceFlag(opts));
      const name = await promptIfMissing(opts.name, globals, { flag: '--name', message: 'Story name' });
      const description = await readDescription(opts);
      const story = await services.stories.create(ref, {
        name,
        description,
        stage: typeof opts.stage === 'string' ? opts.stage : undefined,
        assignees: parseRepeatable(opts.assignee),
        epicId: opts.epic || undefined,
        priority: opts.priority ? toPriority(String(opts.priority)) : undefined,
        labels: parseRepeatable(opts.label),
        dueDate: opts.due || undefined,
        customFields: parseFieldAssignments(opts.field),
      });
      printResult(story, { json: globals.json, human: (s) => `Created ${s.key}: ${s.name}` });
    }),
  );

  stories
    .command('show <key>')
    .description('Show a Story with its Custom Fields, description, Task summary and Comment count')
    .action(async (key: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const story = await services.stories.get(key);
        if (globals.json) return printResult(story, { json: true, human: () => '' });
        const config = await services.config.effective({ workspaceId: story.workspaceId, boardId: story.boardId });
        printResult(story, { json: false, human: (s) => renderStory(s, config.stages, config.customFields) });
      }),
    );

  withStoryFields(
    stories
      .command('edit <key>')
      .description('Edit a Story; list flags either replace the list or add/remove entries')
      .option('--name <name>', 'new name')
      .option('--assignee <handle>', 'replace the Assignees (repeatable, comma-separated)', collect)
      .option('--add-assignee <handle>', 'add Assignees (repeatable)', collect)
      .option('--remove-assignee <handle>', 'remove Assignees (repeatable)', collect)
      .option('--epic <id>', 'set the Epic')
      .option('--no-epic', 'remove the Epic')
      .option('--priority <P>', 'set the Priority, P0–P4')
      .option('--no-priority', 'remove the Priority')
      .option('--label <label>', 'replace the Labels (repeatable, comma-separated)', collect)
      .option('--add-label <label>', 'add Labels (repeatable)', collect)
      .option('--remove-label <label>', 'remove Labels (repeatable)', collect)
      .option('--due <date>', 'set the due date, YYYY-MM-DD')
      .option('--no-due', 'remove the due date')
      .option('--field <key=value>', 'set a Custom Field value (repeatable)', collect)
      .option('--unset-field <key>', 'remove a Custom Field value (repeatable)', collect),
  ).action(async (key: string, opts: StoryOptions, cmd: Command) =>
    withContext(cmd, async ({ services, globals }) => {
      const current = opts.edit ? await services.stories.get(key) : undefined;
      const patch = editPatch(opts, await readDescription(opts, current?.description));
      if (Object.values(patch).every((value) => value === undefined)) {
        throw new UsageError('nothing to change', { hint: 'see `rowbly stories edit --help`' });
      }
      const story = await services.stories.update(key, patch);
      printResult(story, { json: globals.json, human: (s) => `Updated ${s.key}` });
    }),
  );

  stories
    .command('move <key> <stage>')
    .description('Move a Story to another Stage, at the bottom unless --top')
    .option('--top', 'place it at the top of the Stage')
    .action(async (key: string, stage: string, opts: StoryOptions, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const story = await services.stories.move(key, stage, { top: opts.top ?? false });
        printResult(story, { json: globals.json, human: (s) => `Moved ${s.key} to ${s.stage}` });
      }),
    );

  stories
    .command('rank <key>')
    .description('Change the Rank of a Story within its Stage')
    .option('--before <key>', 'place it just above this Story')
    .option('--after <key>', 'place it just below this Story')
    .option('--top', 'place it at the top of its Stage')
    .option('--bottom', 'place it at the bottom of its Stage')
    .action(async (key: string, opts: StoryOptions, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const story = await services.stories.rank(key, rankPosition(opts));
        printResult(story, { json: globals.json, human: (s) => `Ranked ${s.key}` });
      }),
    );

  stories
    .command('delete <key>')
    .description('Delete a Story with its Tasks and Comments (its key may be reused)')
    .action(async (key: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const story = await services.stories.get(key);
        await confirmDestructive(`Delete ${story.key} "${story.name}"?`, globals);
        await services.stories.remove(story.key);
        printResult({ deleted: story.key }, { json: globals.json, human: () => `Deleted ${story.key}` });
      }),
    );
}

/** The long-text description flags shared by `create` and `edit`. */
function withStoryFields(cmd: Command): Command {
  return cmd
    .option('--description <text>', 'description (markdown)')
    .option('--description-file <path>', 'read the description from a file, or - for stdin')
    .option('--edit', 'write the description in $VISUAL/$EDITOR');
}

function readDescription(opts: StoryOptions, initial?: string): Promise<string | undefined> {
  return readLongText(
    { text: opts.description, file: opts.descriptionFile, edit: opts.edit },
    { name: 'description', initial },
  );
}

function listFilter(opts: StoryOptions): StoryFilter {
  if (opts.category !== undefined && !StageCategorySchema.options.includes(opts.category as StageCategory)) {
    throw new UsageError(`invalid --category "${opts.category}"`, {
      hint: `expected one of: ${StageCategorySchema.options.join(', ')}`,
    });
  }
  if (opts.sort !== undefined && !SORTS.includes(opts.sort as StorySort)) {
    throw new UsageError(`invalid --sort "${opts.sort}"`, { hint: `expected one of: ${SORTS.join(', ')}` });
  }
  const priorities = Array.isArray(opts.priority) ? parseRepeatable(opts.priority).map(toPriority) : [];
  const stages = Array.isArray(opts.stage) ? parseRepeatable(opts.stage) : [];
  const assignees = parseRepeatable(opts.assignee);
  const labels = parseRepeatable(opts.label);
  return {
    ...(stages.length ? { stages } : {}),
    ...(opts.category ? { category: opts.category as StageCategory } : {}),
    ...(opts.open ? { open: true } : {}),
    ...(assignees.length ? { assignees } : {}),
    ...(opts.epic === false ? { epicId: null } : opts.epic ? { epicId: opts.epic } : {}),
    ...(labels.length ? { labels } : {}),
    ...(priorities.length ? { priorities } : {}),
    ...(opts.search ? { search: opts.search } : {}),
    ...(opts.sort ? { sort: opts.sort as StorySort } : {}),
  };
}

/** `undefined` for every flag that was not given; `false` from a `--no-*` flag becomes `null` (clear). */
function editPatch(opts: StoryOptions, description: string | undefined): StoryPatch {
  const list = (values: string[] | undefined) => (values === undefined ? undefined : parseRepeatable(values));
  const fields = opts.field === undefined ? undefined : parseFieldAssignments(opts.field);
  const clearable = <T>(value: string | false | undefined, map: (v: string) => T) =>
    value === undefined ? undefined : value === false ? null : map(value);
  return {
    name: opts.name,
    description,
    assignees: list(opts.assignee),
    addAssignees: list(opts.addAssignee),
    removeAssignees: list(opts.removeAssignee),
    epicId: clearable(opts.epic, (v) => v),
    priority: clearable(opts.priority as string | false | undefined, toPriority),
    labels: list(opts.label),
    addLabels: list(opts.addLabel),
    removeLabels: list(opts.removeLabel),
    dueDate: clearable(opts.due, (v) => v),
    customFields: fields,
    unsetFields: list(opts.unsetField),
  };
}

function rankPosition(opts: StoryOptions): RankPosition {
  const given = [opts.before !== undefined, opts.after !== undefined, opts.top, opts.bottom].filter(Boolean);
  if (given.length !== 1) throw new UsageError('pass exactly one of --before, --after, --top and --bottom');
  if (opts.before !== undefined) return { before: opts.before };
  if (opts.after !== undefined) return { after: opts.after };
  return opts.top ? 'top' : 'bottom';
}

function toPriority(value: string): Priority {
  const result = PrioritySchema.safeParse(value.trim().toUpperCase());
  if (!result.success) throw new UsageError(`invalid Priority "${value}"`, { hint: 'expected P0, P1, P2, P3 or P4' });
  return result.data;
}

async function stagesByBoard(services: Services, stories: readonly Story[]): Promise<Map<string, Stage[]>> {
  const stages = new Map<string, Stage[]>();
  for (const story of stories) {
    const id = `${story.workspaceId}/${story.boardId}`;
    if (stages.has(id)) continue;
    const config = await services.config.effective({ workspaceId: story.workspaceId, boardId: story.boardId });
    stages.set(id, config.stages);
  }
  return stages;
}

/** A Stage name coloured by its Stage Category; an unknown Stage (drift) shows its key in red. */
function stageBadge(stages: readonly Stage[], key: string): string {
  const stage = stages.find((s) => s.key === key);
  return stage ? colorByCategory(stage.category, `● ${stage.name}`) : colors.red(`● ${key}?`);
}

function renderStories(stories: readonly Story[], stages: Map<string, Stage[]>): string {
  if (stories.length === 0) return colors.dim('No Stories match.');
  return renderTable(
    ['KEY', 'NAME', 'STAGE', 'PRIORITY', 'ASSIGNEES', 'LABELS', 'DUE'],
    stories.map((s) => [
      s.key,
      s.name,
      stageBadge(stages.get(`${s.workspaceId}/${s.boardId}`) ?? [], s.stage),
      s.priority ?? '',
      s.assignees.join(', '),
      s.labels.join(', '),
      s.dueDate ?? '',
    ]),
  );
}

function renderStory(story: Story, stages: readonly Stage[], fields: readonly CustomFieldDef[]): string {
  const none = colors.dim('—');
  const rows: [string, string][] = [
    ['Stage', stageBadge(stages, story.stage)],
    ['Priority', story.priority ?? none],
    ['Assignees', story.assignees.join(', ') || none],
    ['Epic', story.epicId ?? none],
    ['Labels', story.labels.join(', ') || none],
    ['Due', story.dueDate ?? none],
    ['Created', `${story.createdAt}${story.createdBy ? ` by ${story.createdBy}` : ''}`],
    ['Updated', story.updatedAt],
  ];
  const lines = [`${colors.bold(story.key)}  ${colors.bold(story.name)}`, ...labelled(rows)];
  const values = Object.entries(story.customFields);
  if (values.length > 0) {
    lines.push('', colors.bold('Custom Fields'));
    lines.push(
      ...labelled(values.map(([key, value]) => [fields.find((f) => f.key === key)?.name ?? key, show(value)])),
    );
  }
  if (story.description.trim()) lines.push('', colors.bold('Description'), story.description);
  const done = story.tasks.filter((t) => stages.find((s) => s.key === t.stage)?.category === 'done').length;
  lines.push('', `Tasks: ${done}/${story.tasks.length} done`, `Comments: ${story.comments.length}`);
  return lines.join('\n');
}

function labelled(rows: readonly [string, string][]): string[] {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return rows.map(([label, value]) => `${colors.dim(`${label}:`.padEnd(width))}${value}`);
}

function show(value: CustomFieldValue): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}
