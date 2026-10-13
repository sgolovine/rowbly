import { ConflictError, NotFoundError, rankAfter, toTimestamp, UsageError, ValidationError } from '../core';
import { type Stage, StageSchema, type Story } from '../schemas';
import { type Repositories, resolveCascade } from '../storage';
import { insertIndex, openLevel } from './_configTarget';
import type { ConfigTarget, RowblyContext, StagesService } from './types';

export function createStagesService(ctx: RowblyContext, repos: Repositories): StagesService {
  const open = (target: ConfigTarget) => openLevel(ctx, repos, target, 'stages');

  return {
    async list(boardId) {
      const { stages, stagesSource } = await resolveCascade(ctx.root, boardId);
      return { stages, source: stagesSource };
    },

    async add(target, input, position = 'last') {
      const stage = parseStage(input);
      const level = await open(target);
      if (level.items.some((s) => s.key === stage.key)) {
        throw new ConflictError(`Stage "${stage.key}" already exists`);
      }
      const next = [...level.items];
      next.splice(insertIndex(keysOf(next), position, stageNotFound), 0, stage);
      await level.save(next);
      return next;
    },

    async update(target, key, patch) {
      const level = await open(target);
      const current = findStage(level.items, key);
      const updated = parseStage({ ...current, ...definedOnly(patch) });
      const next = level.items.map((s) => (s.key === key ? updated : s));
      await level.save(next);
      return next;
    },

    async move(target, key, position) {
      const level = await open(target);
      const stage = findStage(level.items, key);
      if (typeof position === 'object' && ('before' in position ? position.before : position.after) === key) {
        throw new UsageError(`cannot move Stage "${key}" relative to itself`);
      }
      const rest = level.items.filter((s) => s.key !== key);
      rest.splice(insertIndex(keysOf(rest), position, stageNotFound), 0, stage);
      await level.save(rest);
      return rest;
    },

    async remove(target, key, { moveTo }) {
      const level = await open(target);
      findStage(level.items, key);
      if (level.items.length === 1) throw new ConflictError(`cannot remove "${key}": it is the last Stage`);
      if (moveTo !== undefined) {
        if (moveTo === key) throw new UsageError('--move-to must name a different Stage');
        findStage(level.items, moveTo);
      }

      const boards = await Promise.all(level.affected.map((boardId) => repos.stories.allInBoard(boardId)));
      const all = boards.flat();
      const storiesUsing = all.filter((story) => story.stage === key).length;
      const tasksUsing = all.flatMap((story) => story.tasks).filter((task) => task.stage === key).length;

      if (moveTo === undefined) {
        if (storiesUsing + tasksUsing > 0) {
          throw new ConflictError(
            `Stage "${key}" is used by ${plural(storiesUsing, 'Story', 'Stories')} and ${plural(tasksUsing, 'Task', 'Tasks')}`,
            {
              details: { stage: key, stories: storiesUsing, tasks: tasksUsing },
              hint: 'pass --move-to <stage> to move them first',
            },
          );
        }
      } else {
        // Move first, so a failure leaves the Stage in place rather than Stories pointing at nothing.
        for (const stories of boards) await moveStage(stories, key, moveTo);
      }
      await level.save(level.items.filter((s) => s.key !== key));
      return { storiesMoved: storiesUsing, tasksMoved: tasksUsing };
    },
  };

  /** Moves a Board's Stories and Tasks from `from` to `to`; moved Stories go to the bottom of `to`. */
  async function moveStage(stories: Story[], from: string, to: string): Promise<void> {
    const now = toTimestamp(ctx.now());
    let last = stories
      .filter((s) => s.stage === to)
      .map((s) => s.rank)
      .reduce<string | null>((max, rank) => (max === null || rank > max ? rank : max), null);
    const moving = stories.filter((s) => s.stage === from).sort((a, b) => compare(a.rank, b.rank));
    const changed = new Map<string, Story>();
    for (const story of moving) {
      last = rankAfter(last);
      changed.set(story.key, { ...story, stage: to, rank: last, updatedAt: now });
    }
    for (const story of stories) {
      if (!story.tasks.some((task) => task.stage === from)) continue;
      const base = changed.get(story.key) ?? { ...story, updatedAt: now };
      const tasks = base.tasks.map((task) => (task.stage === from ? { ...task, stage: to, updatedAt: now } : task));
      changed.set(story.key, { ...base, tasks });
    }
    for (const story of changed.values()) await repos.stories.put(story);
  }
}

function parseStage(input: unknown): Stage {
  const result = StageSchema.safeParse(input);
  if (!result.success) throw new ValidationError('invalid Stage', { details: { issues: result.error.issues } });
  return result.data;
}

function findStage(stages: readonly Stage[], key: string): Stage {
  const stage = stages.find((s) => s.key === key);
  if (!stage) throw stageNotFound(key);
  return stage;
}

function stageNotFound(key: string): NotFoundError {
  return new NotFoundError(`Stage "${key}" not found`);
}

function keysOf(stages: readonly Stage[]): string[] {
  return stages.map((s) => s.key);
}

function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** Rank keys compare by code unit, not locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
