import type { Command } from 'commander';
import { UsageError } from '../../core';
import { printResult } from '../../output';
import { StageCategorySchema } from '../../schemas';
import { pluginStoryRows } from '../../services';
import {
  boardFlag,
  collect,
  confirmDestructive,
  parseFieldAssignments,
  parseRepeatable,
  pluginOptions,
  promptIfMissing,
  withContext,
} from '../shared';
import {
  renderJsonOnly,
  renderStories,
  renderStory,
  renderStoryCreated,
  renderStoryDeleted,
  renderStoryMoved,
  renderStoryRanked,
  renderStoryUpdated,
} from './render';
import type { StoryOptions } from './types';
import {
  boardOption,
  editPatch,
  listFilter,
  rankPosition,
  readDescription,
  SORTS,
  stagesByBoard,
  toPriority,
} from './util';

export function registerStories(program: Command): void {
  const stories = program.command('stories').description('Manage Stories on a Board');

  stories
    .command('list')
    .description('List Stories, sorted by Stage order then Rank unless --sort is given')
    .option('--stage <key>', 'only these Stages (repeatable)', collect)
    .option('--category <category>', `only this Stage Category: ${StageCategorySchema.options.join(', ')}`)
    .option('--open', 'only Stories whose Stage Category is not done')
    .option('--label <label>', 'only Stories with any of these Labels (repeatable)', collect)
    .option('--priority <P>', 'only these Priorities, P0–P4 (repeatable)', collect)
    .option('--search <text>', 'case-insensitive match on name and description')
    .option('--sort <order>', `${SORTS.join('|')} (priority: most urgent first; updated: newest first)`)
    .option('--all-boards', 'every Board')
    .option(...boardOption)
    .action(async (opts: StoryOptions, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const filter = { ...listFilter(opts), ...pluginOptions(cmd) };
        const boardId = opts.allBoards ? null : await services.context.resolveBoard(boardFlag(opts));
        const list = await services.stories.list(boardId, filter);
        if (globals.json) return printResult(list, { json: true, human: renderJsonOnly });
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
      .option('--priority <P>', 'Priority P0–P4')
      .option('--label <label>', 'Label (repeatable, comma-separated)', collect)
      .option('--due <date>', 'due date, YYYY-MM-DD')
      .option('--field <key=value>', 'Custom Field value (repeatable)', collect)
      .option(...boardOption),
  ).action(async (opts: StoryOptions, cmd: Command) =>
    withContext(cmd, async ({ services, globals }) => {
      const boardId = await services.context.resolveBoard(boardFlag(opts));
      const name = await promptIfMissing(opts.name, globals, { flag: '--name', message: 'Story name' });
      const description = await readDescription(opts);
      const story = await services.stories.create(boardId, {
        name,
        description,
        stage: typeof opts.stage === 'string' ? opts.stage : undefined,
        priority: opts.priority ? toPriority(String(opts.priority)) : undefined,
        labels: parseRepeatable(opts.label),
        dueDate: opts.due || undefined,
        customFields: parseFieldAssignments(opts.field),
        ...pluginOptions(cmd),
      });
      printResult(story, { json: globals.json, human: renderStoryCreated });
    }),
  );

  stories
    .command('show <key>')
    .description('Show a Story with its Custom Fields and description')
    .action(async (key: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ ctx, services, globals }) => {
        const story = await services.stories.get(key);
        if (globals.json) return printResult(story, { json: true, human: renderJsonOnly });
        const config = await services.config.effective(story.boardId);
        const rows = (await pluginStoryRows(ctx, services, story)).map((r): [string, string] => [r.label, r.value]);
        printResult(story, { json: false, human: (s) => renderStory(s, config.stages, config.customFields, rows) });
      }),
    );

  withStoryFields(
    stories
      .command('edit <key>')
      .description('Edit a Story; list flags either replace the list or add/remove entries')
      .option('--name <name>', 'new name')
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
      const patch = { ...editPatch(opts, await readDescription(opts, current?.description)), ...pluginOptions(cmd) };
      if (Object.values(patch).every((value) => value === undefined)) {
        throw new UsageError('nothing to change', { hint: 'see `rowbly stories edit --help`' });
      }
      const story = await services.stories.update(key, patch);
      printResult(story, { json: globals.json, human: renderStoryUpdated });
    }),
  );

  stories
    .command('move <key> <stage>')
    .description('Move a Story to another Stage, at the bottom unless --top')
    .option('--top', 'place it at the top of the Stage')
    .action(async (key: string, stage: string, opts: StoryOptions, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const story = await services.stories.move(key, stage, { top: opts.top ?? false, ...pluginOptions(cmd) });
        printResult(story, { json: globals.json, human: renderStoryMoved });
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
        const story = await services.stories.rank(key, rankPosition(opts), pluginOptions(cmd));
        printResult(story, { json: globals.json, human: renderStoryRanked });
      }),
    );

  stories
    .command('delete <key>')
    .description('Delete a Story (its key may be reused)')
    .action(async (key: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const story = await services.stories.get(key);
        await confirmDestructive(`Delete ${story.key} "${story.name}"?`, globals);
        await services.stories.remove(story.key, pluginOptions(cmd));
        printResult({ deleted: story.key }, { json: globals.json, human: renderStoryDeleted });
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
