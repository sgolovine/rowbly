import { type PluginDefinition, renderTable, UsageError } from '../../plugin-api';
import { createEpic, deleteEpic, editEpic, getEpic, listEpics, progressText, setEpicClosed, showEpic } from './service';

type DescriptionOptions = { description?: string; descriptionFile?: string; edit?: boolean; name?: string };

export const commands: NonNullable<PluginDefinition['commands']> = (group, cli) => {
  group
    .command('list')
    .description('List open Epics')
    .option('--closed', 'only closed Epics')
    .option('--all', 'open and closed Epics')
    .action((opts: { closed?: boolean; all?: boolean }, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        if (opts.closed && opts.all) throw new UsageError('Use either --closed or --all');
        const epics = await listEpics(plugin, opts.all ? 'all' : opts.closed ? 'closed' : 'open');
        print(epics, (rows) =>
          rows.length
            ? renderTable(
                ['Epic', 'Name', 'Closed'],
                rows.map((e) => [e.id, e.name, e.closed ? 'yes' : 'no']),
              )
            : 'No Epics.',
        );
      }),
    );
  group
    .command('create <id>')
    .description('Create an Epic')
    .option('--name <name>', 'the Epic name')
    .option('--description <text>', 'the Epic description')
    .option('--description-file <path>', 'read the description from a file, or - for stdin')
    .option('--edit', 'edit the description in $EDITOR')
    .action((id: string, opts: DescriptionOptions, cmd) =>
      cli.run(cmd, async (env) => {
        const name = await env.prompt(opts.name, { flag: '--name', message: 'Epic name' });
        const description = await env.readText(
          { text: opts.description, file: opts.descriptionFile, edit: opts.edit },
          { name: 'description' },
        );
        env.print(await createEpic(env.plugin, { id, name, description }), (e) => `Created Epic ${e.id}: ${e.name}`);
      }),
    );
  group
    .command('show <id>')
    .description('Show an Epic, its Stories by Board, and Epic Progress')
    .action((id: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(await showEpic(plugin, id), (e) =>
          [
            `Epic: ${e.id}`,
            `Name: ${e.name}`,
            `Closed: ${e.closed ? 'yes' : 'no'}`,
            `Epic Progress: ${progressText(e.progress)}`,
            e.description,
            ...e.boards.map(
              ({ board, stories }) =>
                `\nBoard: ${board.name} (${board.id})\n${renderTable(
                  ['Story Key', 'Name', 'Stage'],
                  stories.map((s) => [s.key, s.name, s.stage]),
                )}`,
            ),
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }),
    );
  group
    .command('edit <id>')
    .description('Edit an Epic')
    .option('--name <name>', 'the Epic name')
    .option('--description <text>', 'the Epic description')
    .option('--description-file <path>', 'read the description from a file, or - for stdin')
    .option('--edit', 'edit the description in $EDITOR')
    .action((id: string, opts: DescriptionOptions, cmd) =>
      cli.run(cmd, async (env) => {
        const epic = await getEpic(env.plugin, id);
        const description = await env.readText(
          { text: opts.description, file: opts.descriptionFile, edit: opts.edit },
          { name: 'description', initial: epic.description },
        );
        if (opts.name === undefined && description === undefined)
          throw new UsageError('Provide --name or description flags');
        env.print(await editEpic(env.plugin, id, { name: opts.name, description }), (e) => `Updated Epic ${e.id}`);
      }),
    );
  for (const closed of [true, false]) {
    group
      .command(`${closed ? 'close' : 'reopen'} <id>`)
      .description(`${closed ? 'Close' : 'Reopen'} an Epic`)
      .action((id: string, _opts: unknown, cmd) =>
        cli.run(cmd, async ({ plugin, print }) => {
          print(await setEpicClosed(plugin, id, closed), (e) => `${closed ? 'Closed' : 'Reopened'} Epic ${e.id}`);
        }),
      );
  }
  group
    .command('delete <id>')
    .description('Delete an Epic and unlink its Stories')
    .action((id: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print, confirm }) => {
        await getEpic(plugin, id);
        await confirm(`Delete Epic "${id}"? Its Stories will be unlinked.`);
        print(await deleteEpic(plugin, id), (result) => `Deleted Epic ${result.id}`);
      }),
    );
};
