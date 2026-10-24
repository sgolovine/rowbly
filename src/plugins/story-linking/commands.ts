import { type Command, type PluginCommands, UsageError } from '../../plugin-api';
import { addLink, listLinks, removeLink } from './links';
import { directionLabel, type LinkPair, type StoryLink } from './model';

interface DirectionOptions {
  blocks?: string;
  blockedBy?: string;
}

export const commands: PluginCommands = (group, cli) => {
  group
    .command('list <key>')
    .description('Show the blocking relationships of a Story')
    .action((key: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(await listLinks(plugin, key), renderLinks);
      }),
    );
  withDirection(group.command('add <key>').description('Link two Stories on the same Board')).action(
    (key: string, opts: DirectionOptions, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        const pair = directionPair(key, opts);
        print(await addLink(plugin, pair.blocker, pair.blocked), renderPair);
      }),
  );
  withDirection(group.command('remove <key>').description('Remove a blocking relationship')).action(
    (key: string, opts: DirectionOptions, cmd) =>
      cli.run(cmd, async ({ plugin, print, confirm }) => {
        const pair = directionPair(key, opts);
        await confirm(`Remove the link: ${renderPair(pair)}?`);
        print(
          await removeLink(plugin, pair.blocker, pair.blocked),
          (removed) => `Removed link: ${renderPair(removed)}`,
        );
      }),
  );
};

function withDirection(command: Command): Command {
  return command
    .option('--blocks <key>', 'the Story blocked by this Story')
    .option('--blocked-by <key>', 'the Story blocking this Story');
}

function directionPair(key: string, opts: DirectionOptions): LinkPair {
  if ((opts.blocks === undefined) === (opts.blockedBy === undefined)) {
    throw new UsageError('give exactly one of --blocks or --blocked-by');
  }
  return opts.blocks !== undefined
    ? { blocker: key, blocked: opts.blocks }
    : { blocker: opts.blockedBy as string, blocked: key };
}

function renderPair(pair: LinkPair): string {
  return `${pair.blocker} blocks ${pair.blocked}`;
}

function renderLinks(links: readonly StoryLink[]): string {
  return links.length
    ? links
        .map(
          (link) => `${directionLabel(link.relation)} ${link.key} · ${link.name ?? 'unavailable (run rowbly doctor)'}`,
        )
        .join('\n')
    : 'No Story links.';
}
