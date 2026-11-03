import type { PluginCommands } from '../../plugin-api';
import { fetchStatus, statusText } from './status';

export const commands: PluginCommands = (group, cli) => {
  group
    .command('status <key>')
    .description('Fetch the linked GitHub PR once with gh')
    .action((key: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        const status = await fetchStatus(plugin, await plugin.services.stories.get(key));
        print(status, (value) => `${statusText(value)}\n${value.title}\n${value.url}`);
      }),
    );
};
