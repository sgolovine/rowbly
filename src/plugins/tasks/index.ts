import {
  ConflictError,
  definePlugin,
  type PluginFinding,
  type PluginHookContext,
  type StageConfig,
  type Story,
  toTimestamp,
  ValidationError,
  withFixedStages,
} from '../../plugin-api';
import { commands } from './commands';
import { TasksBag, TasksCreateInput } from './model';
import { reconcile } from './reconcile';
import { checkStage, doneCount, stagesOf, storedTasks, updateTasks } from './tasks';

/** Where `stages.remove` removes a Stage: the Data Root's list, or one Board's. */
type StageLevel = { level: 'global' } | { level: 'board'; boardId: string };

/**
 * The stored Stories whose Tasks are in Stage `key` on the Boards that use the Stage list at `target`,
 * with how many of their Tasks are. A Story whose bag is invalid is left out: doctor reports it.
 */
async function storiesUsing(
  plugin: PluginHookContext,
  target: StageLevel,
  key: string,
): Promise<{ story: Story; count: number }[]> {
  const boards =
    target.level === 'board'
      ? [target.boardId]
      : (await plugin.services.boards.list()).filter((b) => b.stages === undefined).map((b) => b.id);
  const using: { story: Story; count: number }[] = [];
  for (const boardId of boards) {
    for (const story of await plugin.services.stories.list(boardId, {})) {
      const count = plugin.readBag(story, TasksBag)?.tasks.filter((t) => t.stage === key).length ?? 0;
      if (count > 0) using.push({ story, count });
    }
  }
  return using;
}

function plural(n: number): string {
  return `${n} ${n === 1 ? 'Task' : 'Tasks'}`;
}

/** The Board Stages that `story`'s Tasks may use, from the records doctor read. */
function doctorStages(config: { stages?: StageConfig[] } | null, board: { stages?: StageConfig[] } | undefined) {
  const configured = board?.stages ?? config?.stages;
  return configured && withFixedStages(configured);
}

export const tasks = definePlugin({
  reconcile,
  id: 'tasks',
  name: 'Tasks',
  description: 'Tasks inside Stories, each with its own Stage',
  bags: { story: TasksBag },
  commands,
  inputs: { 'stories.create': TasksCreateInput },
  options: {
    'stories create': {
      options: [
        { flags: '--task <name>', description: 'create a Task in the first Stage (repeatable)', repeatable: true },
      ],
      input: ({ task }) =>
        task === undefined
          ? undefined
          : {
              tasks: (Array.isArray(task) ? task : [String(task)]).map((name) => ({ name })),
            },
    },
  },
  hooks: {
    'stories.create': {
      async transform({ changes, result, pluginInput, plugin }) {
        if (!pluginInput) return;
        const stages = await stagesOf(plugin, result);
        const now = toTimestamp(plugin.now());
        await updateTasks(plugin, changes, result.key, (bag) => {
          const tasks = pluginInput.tasks.map((draft, index) => {
            const stage = draft.stage ?? stages[0]?.key;
            if (stage === undefined) throw new ValidationError('the Board has no Stages');
            checkStage(stages, stage);
            return {
              ...draft,
              stage,
              description: draft.description ?? '',
              number: bag.nextNumber + index,
              createdAt: now,
              updatedAt: now,
            };
          });
          return { nextNumber: bag.nextNumber + tasks.length, tasks: [...bag.tasks, ...tasks] };
        });
      },
    },
    'stages.remove': {
      // With `--move-to`, a Stage's Tasks move along with its Stories.
      async transform({ input, changes, plugin }) {
        const { moveTo } = input;
        if (moveTo === undefined) return;
        const using = await storiesUsing(plugin, input.target, input.key);
        const updatedAt = toTimestamp(plugin.now());
        for (const { story } of using) {
          await updateTasks(plugin, changes, story.key, (bag) => ({
            ...bag,
            tasks: bag.tasks.map((t) => (t.stage === input.key ? { ...t, stage: moveTo, updatedAt } : t)),
          }));
        }
        const moved = using.reduce((n, u) => n + u.count, 0);
        if (moved > 0) plugin.warn(`moved ${plural(moved)} to ${moveTo}`);
      },
      // Without it, a Stage that Tasks still use is not removed.
      async guard({ input, plugin }) {
        if (input.moveTo !== undefined) return;
        const count = (await storiesUsing(plugin, input.target, input.key)).reduce((n, u) => n + u.count, 0);
        if (count === 0) return;
        // `needsMoveTo` tells the TUI to offer a Stage to move them to, as core does for Stories.
        throw new ConflictError(`Stage "${input.key}" is used by ${plural(count)}`, {
          details: { tasks: count, needsMoveTo: true },
          hint: 'pass --move-to <stage> to move them first',
        });
      },
    },
  },
  async storyRows(story, plugin) {
    const list = storedTasks(plugin, story);
    if (list === null) return [{ label: 'Tasks', value: 'unavailable (invalid)' }];
    const done = doneCount(list, await stagesOf(plugin, story));
    return [{ label: 'Tasks', value: `${done}/${list.length} done` }];
  },
  doctor: {
    check({ data, plugin }) {
      return data.stories.flatMap((story): PluginFinding[] => {
        const bag = plugin.readBag(story, TasksBag);
        if (!bag) return [];
        const path = `boards/${story.boardId}/stories/${story.key}/story.json`;
        const findings: PluginFinding[] = [];
        const stages = doctorStages(
          data.config,
          data.boards.find((b) => b.id === story.boardId),
        );
        for (const task of bag.tasks) {
          if (!stages || stages.some((s) => s.key === task.stage)) continue;
          const id = `${story.key}.${task.number}`;
          findings.push({
            code: 'UNKNOWN_STAGE',
            severity: 'error',
            path,
            message: `${id} is in unknown Stage "${task.stage}"`,
            details: { hint: `run \`rowbly tasks move ${id} <stage>\`` },
          });
        }
        const highest = Math.max(0, ...bag.tasks.map((t) => t.number));
        if (bag.nextNumber <= highest) {
          findings.push({
            code: 'COUNTER_BEHIND',
            severity: 'warning',
            path,
            message: `${story.key} next Task number ${bag.nextNumber} ≤ highest Task ${highest}`,
            async fix(changes) {
              await updateTasks(plugin, changes, story.key, (b) => ({
                ...b,
                nextNumber: Math.max(b.nextNumber, ...b.tasks.map((t) => t.number + 1)),
              }));
              return `set ${story.key} next Task number to ${highest + 1}`;
            },
          });
        }
        return findings;
      });
    },
  },
  tui: () => import('./tui').then((m) => m.tui),
});
