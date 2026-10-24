import { type PluginCommands, ValidationError } from '../../plugin-api';
import { configure, preferences } from './model';

export const commands: PluginCommands = (group, cli) => {
  group
    .command('show')
    .description('Show personal Git commit preferences and Git author defaults')
    .action((_opts, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        const result = { ...(await preferences(plugin)), defaults: await plugin.git.info() };
        print(
          result,
          (value) => `Automatic Commits: ${value.automaticCommits ? 'On' : 'Off'}\n${JSON.stringify(value, null, 2)}`,
        );
      }),
    );
  group
    .command('configure')
    .description('Configure personal automatic chore commits')
    .option('--automatic-commits <mode>', 'on or off; preserve pending changes while off')
    .option('--frequency <mode>', 'change or interval')
    .option('--interval <seconds>', 'interval in seconds (1–86400)')
    .option('--author-name <name>', 'commit author name; empty uses Git configuration')
    .option('--author-email <email>', 'commit author email; empty uses Git configuration')
    .action(
      (
        opts: {
          automaticCommits?: string;
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
          const value = await configure(plugin, {
            ...(opts.automaticCommits !== undefined ? { automaticCommits: opts.automaticCommits === 'on' } : {}),
            ...(opts.frequency !== undefined ? { frequency: opts.frequency } : {}),
            ...(opts.interval !== undefined ? { intervalSeconds: Number(opts.interval) } : {}),
            ...(opts.authorName !== undefined ? { authorName: opts.authorName || undefined } : {}),
            ...(opts.authorEmail !== undefined ? { authorEmail: opts.authorEmail || undefined } : {}),
          });
          print(
            value,
            () => `Updated Git commit preferences (Automatic Commits: ${value.automaticCommits ? 'On' : 'Off'})`,
          );
        }),
    );
};
