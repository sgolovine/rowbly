import { ConflictError, NotFoundError, rankAfter, toTimestamp, UsageError, ValidationError } from '../core';
import { isFixedStage, type Stage, type StageConfig, StageConfigSchema, type Story, withFixedStages } from '../schemas';
import { type Repositories, resolveCascade } from '../storage';
import { insertIndex, openLevel } from './_configTarget';
import type { CoreChangeSet } from './plugins/changeSet';
import { type Finalizer, type OperationRunner, resultRemoved } from './plugins/runtime';
import type { RootConfigChange } from './plugins/types';
import type { ConfigTarget, Position, RowblyContext, StagesService } from './types';

export function createStagesService(ctx: RowblyContext, repos: Repositories, ops: OperationRunner): StagesService {
  const open = (target: ConfigTarget) => openLevel(ctx, repos, target, 'stages');

  return {
    async list(boardId) {
      const { stages, stagesSource } = await resolveCascade(ctx.root, boardId);
      return { stages, source: stagesSource };
    },

    add: (target, input, position = 'last', opts = {}) =>
      ops.run(
        'stages.add',
        { target, stage: input, position, ...opts },
        async (changes) => {
          const stage = parseStage(input);
          const level = await open(target);
          if (level.items.some((s) => s.key === stage.key)) {
            throw new ConflictError(`Stage "${stage.key}" already exists`);
          }
          const next = [...level.items];
          next.splice(insertIndex(keysOf(next), configuredPosition(position), stageNotFound), 0, stage);
          await level.save(changes, next);
          return withFixedStages(next);
        },
        latestStages(target),
      ),
    update: (target, key, patch) =>
      ops.run(
        'stages.update',
        { target, key, ...patch },
        async (changes) => {
          const { plugins: _plugins, ...fields } = patch;
          assertConfigurable(key);
          const level = await open(target);
          const current = findStage(level.items, key);
          const updated = parseStage({ ...current, ...definedOnly(fields) });
          const next = level.items.map((s) => (s.key === key ? updated : s));
          await level.save(changes, next);
          return withFixedStages(next);
        },
        latestStages(target),
      ),
    move: (target, key, position, opts = {}) =>
      ops.run(
        'stages.move',
        { target, key, position, ...opts },
        async (changes) => {
          assertConfigurable(key);
          const level = await open(target);
          const stage = findStage(level.items, key);
          if (typeof position === 'object' && ('before' in position ? position.before : position.after) === key) {
            throw new UsageError(`cannot move Stage "${key}" relative to itself`);
          }
          const rest = level.items.filter((s) => s.key !== key);
          rest.splice(insertIndex(keysOf(rest), configuredPosition(position), stageNotFound), 0, stage);
          await level.save(changes, rest);
          return withFixedStages(rest);
        },
        latestStages(target),
      ),
    remove: (target, key, opts) =>
      ops.run('stages.remove', { target, key, ...opts }, async (changes) => {
        const { moveTo } = opts;
        assertConfigurable(key);
        const level = await open(target);
        findStage(level.items, key);
        if (moveTo !== undefined) {
          if (moveTo === key) throw new UsageError('--move-to must name a different Stage');
          if (!isFixedStage(moveTo)) findStage(level.items, moveTo);
        }

        const boards = await Promise.all(level.affected.map((boardId) => repos.stories.allInBoard(boardId)));
        const all = boards.flat();
        const storiesUsing = all.filter((story) => story.stage === key).length;

        if (moveTo === undefined) {
          if (storiesUsing > 0) {
            // `needsMoveTo` tells the TUI to offer a Stage to move to; Plugins refuse the same way.
            throw new ConflictError(`Stage "${key}" is used by ${plural(storiesUsing, 'Story', 'Stories')}`, {
              details: { stage: key, stories: storiesUsing, needsMoveTo: true },
              hint: 'pass --move-to <stage> to move them first',
            });
          }
        } else {
          // Move first, so a failure leaves the Stage in place rather than Stories pointing at nothing.
          for (const stories of boards) await moveStage(changes, stories, key, moveTo);
        }
        await level.save(
          changes,
          level.items.filter((s) => s.key !== key),
        );
        return { storiesMoved: storiesUsing };
      }),
  };

  /** Moves a Board's Stories from `from` to `to`, to the bottom of `to`. */
  async function moveStage(changes: CoreChangeSet, stories: Story[], from: string, to: string): Promise<void> {
    const now = toTimestamp(ctx.now());
    let last = stories
      .filter((s) => s.stage === to)
      .map((s) => s.rank)
      .reduce<string | null>((max, rank) => (max === null || rank > max ? rank : max), null);
    const moving = stories.filter((s) => s.stage === from).sort((a, b) => compare(a.rank, b.rank));
    for (const story of moving) {
      last = rankAfter(last);
      await changes.putStory({ ...story, stage: to, rank: last, updatedAt: now });
    }
  }
}

/** The Stage list at `target` that the operation saves, as the transforms left it (ARCH-42). */
function latestStages(target: ConfigTarget): Finalizer<Stage[]> {
  return (changes, stages) => {
    if (target.level === 'global') {
      const root = changes.changes.find((c): c is RootConfigChange => c.type === 'rootConfig');
      return root?.after.stages ? withFixedStages(root.after.stages) : stages;
    }
    const board = changes.board(target.boardId);
    if (board && board.after === null) resultRemoved(`Board ${target.boardId}`);
    return board?.after?.stages ? withFixedStages(board.after.stages) : stages;
  };
}

/** Backlog and Done are fixed (ADR-0024). */
function assertConfigurable(key: string): void {
  if (isFixedStage(key)) {
    throw new UsageError(`Stage "${key}" is fixed`, { hint: 'every Board starts with Backlog and ends with Done' });
  }
}

/** A position among the configured Stages: right after Backlog is first, right before Done is last. */
function configuredPosition(position: Position): Position {
  if (position === 'first' || position === 'last') return position;
  if ('after' in position && position.after === 'backlog') return 'first';
  if ('before' in position && position.before === 'done') return 'last';
  const anchor = 'before' in position ? position.before : position.after;
  if (isFixedStage(anchor)) throw new UsageError('a Stage cannot go before Backlog or after Done');
  return position;
}

function parseStage(input: unknown): StageConfig {
  const result = StageConfigSchema.safeParse(input);
  if (!result.success) throw new ValidationError('invalid Stage', { details: { issues: result.error.issues } });
  return result.data;
}

function findStage(stages: readonly StageConfig[], key: string): StageConfig {
  const stage = stages.find((s) => s.key === key);
  if (!stage) throw stageNotFound(key);
  return stage;
}

function stageNotFound(key: string): NotFoundError {
  return new NotFoundError(`Stage "${key}" not found`);
}

function keysOf(stages: readonly StageConfig[]): string[] {
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
