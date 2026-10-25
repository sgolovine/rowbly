import { ConflictError, type PluginCommands, ValidationError } from '../../plugin-api';
import { configure, preferences, resolveSyncOptions } from './model';

export const commands: PluginCommands = (group, cli) => {
  group
    .command('sync')
    .description('Synchronize with the configured upstream when enabled')
    .action((_opts, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        const result = await plugin.git.requestSync(resolveSyncOptions);
        if (!result.active && !result.requested && result.last?.kind === 'failed')
          throw new ConflictError(result.last.message, {
            details: { synchronizationRun: result },
            hint: 'Resolve the reported cause, then retry `rowbly git sync`.',
          });
        print(result, (value) =>
          value.active
            ? `Synchronization ${value.active.phase}`
            : value.requested
              ? 'Synchronization pending'
              : value.last
                ? `${value.last.kind}: ${value.last.message}`
                : 'No synchronization admitted',
        );
      }),
    );
  group
    .command('show')
    .description('Show personal Git preferences, upstream and synchronization result')
    .action((_opts, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        const result = {
          ...(await preferences(plugin)),
          defaults: await plugin.git.info(),
          synchronizationRun: await plugin.git.syncStatus(resolveSyncOptions),
        };
        print(
          result,
          (value) =>
            `Automatic Commits: ${value.automaticCommits ? 'On' : 'Off'}\nAutomatic Merge Conflict Resolution: ${value.synchronization.enabled ? 'On' : 'Off'}\n${JSON.stringify(value, null, 2)}`,
        );
      }),
    );
  group
    .command('configure')
    .description('Configure independent Automatic Commits and Automatic Merge Conflict Resolution preferences')
    .option('--automatic-commits <mode>', 'on or off; preserve pending changes while off')
    .option('--automatic-merge-resolution <mode>', 'on or off; independent of Automatic Commits')
    .option('--merge-interval <seconds>', 'automatic merge interval in seconds (1–86400)')
    .option('--frequency <mode>', 'change or interval')
    .option('--interval <seconds>', 'interval in seconds (1–86400)')
    .option('--author-name <name>', 'commit author name; empty uses Git configuration')
    .option('--author-email <email>', 'commit author email; empty uses Git configuration')
    .action(
      (
        opts: {
          automaticCommits?: string;
          automaticMergeResolution?: string;
          mergeInterval?: string;
          frequency?: string;
          interval?: string;
          authorName?: string;
          authorEmail?: string;
        },
        cmd,
      ) =>
        cli.run(cmd, async ({ plugin, print }) => {
          if (opts.automaticCommits !== undefined && !['on', 'off'].includes(opts.automaticCommits))
            throw new ValidationError('Automatic Commits must be on or off');
          if (opts.automaticMergeResolution !== undefined && !['on', 'off'].includes(opts.automaticMergeResolution))
            throw new ValidationError('Automatic Merge Conflict Resolution must be on or off');
          const value = await configure(plugin, {
            ...(opts.automaticCommits !== undefined ? { automaticCommits: opts.automaticCommits === 'on' } : {}),
            ...(opts.automaticMergeResolution !== undefined || opts.mergeInterval !== undefined
              ? {
                  synchronization: {
                    ...(opts.automaticMergeResolution !== undefined
                      ? { enabled: opts.automaticMergeResolution === 'on' }
                      : {}),
                    ...(opts.mergeInterval !== undefined ? { intervalSeconds: Number(opts.mergeInterval) } : {}),
                  },
                }
              : {}),
            ...(opts.frequency !== undefined ? { frequency: opts.frequency } : {}),
            ...(opts.interval !== undefined ? { intervalSeconds: Number(opts.interval) } : {}),
            ...(opts.authorName !== undefined ? { authorName: opts.authorName || undefined } : {}),
            ...(opts.authorEmail !== undefined ? { authorEmail: opts.authorEmail || undefined } : {}),
          });
          print(
            value,
            () =>
              `Updated Git preferences\nAutomatic Commits: ${value.automaticCommits ? 'On' : 'Off'}\nAutomatic Merge Conflict Resolution: ${value.synchronization.enabled ? 'On' : 'Off'} (every ${value.synchronization.intervalSeconds} seconds)`,
          );
        }),
    );
};
