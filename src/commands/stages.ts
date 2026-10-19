import type { Command } from 'commander';
import { UsageError } from '../core';
import { colorByCategory, colors, printResult, renderTable } from '../output';
import { type ConfigLevel, type Slug, type Stage, withFixedStages } from '../schemas';
import type { ConfigTarget, Position, RowblyContext, Services } from '../services';
import { affectedBoards, type ConfigListKey, readLevel } from '../services/_configTarget';
import { boardFlag, type ContextFlags, promptIfMissing, withContext } from './_shared';

const LEVELS = ['board', 'global'] as const;

/** `--board` and `--level`, shared by `stages` and `fields`. */
export interface LevelFlags extends ContextFlags {
  level?: string;
}

/** Adds `--board` and `--level` to a `stages`/`fields` verb. */
export function withLevelOptions(cmd: Command): Command {
  return cmd
    .option('--board <id>', 'the Board (default: current context)')
    .option('--level <level>', 'Configuration Cascade level to edit: board or global');
}

/**
 * The Configuration Cascade level to read or edit. `--level` wins; otherwise `board` when a Board is
 * in context, else `global` (contracts §3).
 */
export async function resolveConfigTarget(services: Services, opts: LevelFlags): Promise<ConfigTarget> {
  const level = opts.level;
  if (level !== undefined && !LEVELS.includes(level as (typeof LEVELS)[number])) {
    throw new UsageError(`invalid --level "${level}"`, { hint: 'expected board or global' });
  }
  if (level === 'global') return { level: 'global' };
  if (level === 'board') return { level: 'board', boardId: await services.context.resolveBoard(boardFlag(opts)) };
  try {
    return { level: 'board', boardId: await services.context.resolveBoard(boardFlag(opts)) };
  } catch (err) {
    // No Board in context: fall back to the global level.
    if (!(err instanceof UsageError)) throw err;
    return { level: 'global' };
  }
}

export function describeTarget(target: ConfigTarget): string {
  if (target.level === 'global') return 'global level';
  return `board level (${target.boardId})`;
}

/** The JSON/human result of every `stages`/`fields` mutation: the new list, the level and the Boards it applies to. */
export interface MutationResult<T> {
  level: ConfigTarget['level'];
  items: T[];
  affectedBoards: Slug[];
}

export async function mutationResult<T>(
  ctx: RowblyContext,
  target: ConfigTarget,
  key: ConfigListKey,
  items: T[],
): Promise<MutationResult<T>> {
  return { level: target.level, items, affectedBoards: await affectedBoards(ctx, target, key) };
}

export function affectsLine(target: ConfigTarget, boards: readonly Slug[]): string {
  return colors.dim(`${describeTarget(target)}; affects ${boards.length === 0 ? 'no Boards' : boards.join(', ')}`);
}

interface StageOptions extends LevelFlags {
  name?: string;
  before?: string;
  after?: string;
  first?: boolean;
  last?: boolean;
  moveTo?: string;
}

export function registerStages(program: Command): void {
  const stages = program.command('stages').description('Manage the Stages of a Board');

  withLevelOptions(stages.command('list').description('List Stages in order, with the level they come from')).action(
    async (opts: StageOptions, cmd: Command) =>
      withContext(cmd, async ({ ctx, services, globals }) => {
        const target = await resolveConfigTarget(services, opts);
        const { items, source } = await readLevel(ctx, target, 'stages');
        printResult(
          { level: target.level, stages: withFixedStages(items), source },
          { json: globals.json, human: (d) => renderStageList(target, d.stages, d.source) },
        );
      }),
  );

  withLevelOptions(
    stages
      .command('add <key>')
      .description('Add a Stage between Backlog and Done (default: just before Done)')
      .option('--name <name>', 'display name')
      .option('--before <key>', 'insert before this Stage')
      .option('--after <key>', 'insert after this Stage'),
  ).action(async (key: string, opts: StageOptions, cmd: Command) =>
    withContext(cmd, async ({ ctx, services, globals }) => {
      const target = await resolveConfigTarget(services, opts);
      const name = await promptIfMissing(opts.name, globals, { flag: '--name', message: 'Stage name' });
      const position = parsePosition(opts, false) ?? 'last';
      const list = await services.stages.add(target, { key, name }, position);
      printMutation(await mutationResult(ctx, target, 'stages', list), globals.json, target, `Added Stage ${key}`);
    }),
  );

  withLevelOptions(
    stages
      .command('edit <key>')
      .description("Edit a Stage's name (Backlog and Done are fixed)")
      .option('--name <name>', 'new display name'),
  ).action(async (key: string, opts: StageOptions, cmd: Command) =>
    withContext(cmd, async ({ ctx, services, globals }) => {
      if (opts.name === undefined) throw new UsageError('nothing to change', { hint: 'pass --name' });
      const target = await resolveConfigTarget(services, opts);
      const list = await services.stages.update(target, key, { name: opts.name });
      printMutation(await mutationResult(ctx, target, 'stages', list), globals.json, target, `Updated Stage ${key}`);
    }),
  );

  withLevelOptions(
    stages
      .command('move <key>')
      .description('Move a Stage to a new position')
      .option('--before <key>', 'move before this Stage')
      .option('--after <key>', 'move after this Stage')
      .option('--first', 'move to just after Backlog')
      .option('--last', 'move to just before Done'),
  ).action(async (key: string, opts: StageOptions, cmd: Command) =>
    withContext(cmd, async ({ ctx, services, globals }) => {
      const position = parsePosition(opts, true);
      if (position === undefined) throw new UsageError('pass one of --before, --after, --first or --last');
      const target = await resolveConfigTarget(services, opts);
      const list = await services.stages.move(target, key, position);
      printMutation(await mutationResult(ctx, target, 'stages', list), globals.json, target, `Moved Stage ${key}`);
    }),
  );

  withLevelOptions(
    stages
      .command('remove <key>')
      .description('Remove a Stage (refused while Stories use it, unless --move-to)')
      .option('--move-to <key>', 'move its Stories (to the bottom) to this Stage first'),
  ).action(async (key: string, opts: StageOptions, cmd: Command) =>
    withContext(cmd, async ({ ctx, services, globals }) => {
      const target = await resolveConfigTarget(services, opts);
      const affected = await affectedBoards(ctx, target, 'stages');
      const moved = await services.stages.remove(target, key, { moveTo: opts.moveTo });
      const { items } = await readLevel(ctx, target, 'stages');
      const result = { level: target.level, items: withFixedStages(items), affectedBoards: affected, ...moved };
      printResult(result, {
        json: globals.json,
        human: (r) =>
          [
            `Removed Stage ${key}${r.storiesMoved > 0 ? `; moved ${r.storiesMoved} Stories to ${opts.moveTo}` : ''}`,
            affectsLine(target, r.affectedBoards),
          ].join('\n'),
      });
    }),
  );
}

function printMutation(result: MutationResult<Stage>, json: boolean, target: ConfigTarget, done: string): void {
  printResult(result, {
    json,
    human: (r) => [done, renderStageTable(r.items), affectsLine(target, r.affectedBoards)].join('\n'),
  });
}

function renderStageList(target: ConfigTarget, stages: readonly Stage[], source: ConfigLevel): string {
  return [colors.dim(`${describeTarget(target)}; from ${source}`), renderStageTable(stages)].join('\n');
}

function renderStageTable(stages: readonly Stage[]): string {
  return renderTable(
    ['#', 'KEY', 'NAME', 'CATEGORY'],
    stages.map((s, i) => [String(i + 1), s.key, colorByCategory(s.category, s.name), s.category]),
  );
}

/** At most one of `--before`, `--after` (and, for `move`, `--first`, `--last`). */
function parsePosition(opts: StageOptions, allowEnds: boolean): Position | undefined {
  const given: Position[] = [];
  if (opts.before !== undefined) given.push({ before: opts.before });
  if (opts.after !== undefined) given.push({ after: opts.after });
  if (allowEnds && opts.first) given.push('first');
  if (allowEnds && opts.last) given.push('last');
  if (given.length > 1) throw new UsageError('pass only one position flag');
  return given[0];
}
