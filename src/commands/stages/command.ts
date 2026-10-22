import type { Command } from 'commander';
import { UsageError } from '../../core';
import { printResult } from '../../output';
import { withFixedStages } from '../../schemas';
import { affectedBoards, readLevel } from '../../services/_configTarget';
import { promptIfMissing, withContext } from '../shared';
import { renderMutation, renderStageList, renderStageRemoved } from './render';
import type { StageOptions } from './types';
import { mutationResult, parsePosition, resolveConfigTarget } from './util';

/** Adds `--board` and `--level` to a `stages`/`fields` verb. */
export function withLevelOptions(cmd: Command): Command {
  return cmd
    .option('--board <id>', 'the Board (default: current context)')
    .option('--level <level>', 'Configuration Cascade level to edit: board or global');
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
      printResult(await mutationResult(ctx, target, 'stages', list), {
        json: globals.json,
        human: (result) => renderMutation(result, target, key, 'Added'),
      });
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
      printResult(await mutationResult(ctx, target, 'stages', list), {
        json: globals.json,
        human: (result) => renderMutation(result, target, key, 'Updated'),
      });
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
      printResult(await mutationResult(ctx, target, 'stages', list), {
        json: globals.json,
        human: (result) => renderMutation(result, target, key, 'Moved'),
      });
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
        human: (r) => renderStageRemoved(target, key, opts.moveTo, r),
      });
    }),
  );
}
