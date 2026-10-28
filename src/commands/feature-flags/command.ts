import type { Command } from 'commander';
import { UsageError } from '../../core';
import { printResult } from '../../output';
import { withContext } from '../shared';
import { renderFeatureFlags } from './render';

export function registerFeatureFlags(program: Command): void {
  const flags = program
    .command('feature-flags')
    .description('List and configure Experimental Features for this Data Root');
  flags
    .command('list')
    .description('List Experimental Features and their effective values')
    .action((_opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        printResult(await services.featureFlags.list(), { json: globals.json, human: renderFeatureFlags });
      }),
    );
  flags
    .command('set <key> <true|false>')
    .description('Turn an Experimental Feature on or off for this Data Root')
    .action((key: string, value: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        if (value !== 'true' && value !== 'false')
          throw new UsageError('Experimental feature value must be true or false');
        const result = await services.featureFlags.set(key, value === 'true');
        printResult(result, {
          json: globals.json,
          human: (flag) => `Turned ${flag.enabled ? 'on' : 'off'} ${flag.name}`,
        });
      }),
    );
}
