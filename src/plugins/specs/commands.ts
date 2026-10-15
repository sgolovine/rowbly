import { type PluginDefinition, UsageError } from '../../plugin-api';
import { deleteSpec, getSpec, listSpecs, resolveTarget, saveSpec, titledText } from './specs';

interface Options {
  board?: string;
  story?: string;
  title?: string;
  text?: string;
  file?: string;
  edit?: boolean;
}

export const commands: NonNullable<PluginDefinition['commands']> = (group, cli) => {
  group
    .command('list')
    .description("List the Board's Board Specs")
    .option('--board <id>', 'the Board')
    .action((opts: Options, cmd) =>
      cli.run(cmd, async ({ plugin, print, resolveBoard }) => {
        const specs = await listSpecs(plugin, await resolveBoard(opts.board));
        print(specs, (items) => items.map((s) => `${s.slug}  ${s.title}`).join('\n') || 'No Board Specs.');
      }),
    );
  for (const verb of ['create', 'show', 'edit', 'delete'] as const) {
    const command = group
      .command(`${verb} [slug]`)
      .description(`${verb[0]?.toUpperCase()}${verb.slice(1)} a Board Spec or Story Spec`)
      .option('--board <id>', 'the Board')
      .option('--story <KEY>', 'the Story Spec of this Story');
    if (verb === 'create' || verb === 'edit') {
      command
        .option('--title <t>', 'the Spec title')
        .option('--text <md>', 'markdown text')
        .option('--file <path|->', 'read markdown from a file or stdin')
        .option('--edit', 'open $VISUAL or $EDITOR');
    }
    command.action((slug: string | undefined, opts: Options, cmd) =>
      cli.run(cmd, async (env) => {
        const { plugin, print } = env;
        const target = await resolveTarget(plugin, slug, opts, env.resolveBoard);
        if (verb === 'show') {
          print(await getSpec(plugin, target), (s) => s.text);
        } else if (verb === 'delete') {
          await getSpec(plugin, target);
          await env.confirm(
            `Delete Spec "${target.story ?? target.slug}"?${target.story ? '' : ' Board Spec links will be removed.'}`,
          );
          const unlinked = await deleteSpec(plugin, target);
          print({ deleted: target.story ?? target.slug, unlinked }, (s) => `Deleted Spec ${s.deleted}`);
        } else {
          if ([opts.text !== undefined, opts.file !== undefined, !!opts.edit].filter(Boolean).length > 1)
            throw new UsageError('Use only one of --text, --file and --edit');
          const initial = verb === 'edit' ? (await getSpec(plugin, target)).text : '';
          const title =
            verb === 'create' ? await env.prompt(opts.title, { flag: '--title', message: 'Spec title' }) : opts.title;
          const text = opts.edit
            ? await env.editText(titledText(initial, title))
            : titledText(
                (await env.readText({ text: opts.text, file: opts.file }, { name: 'text' })) ?? initial,
                title,
              );
          const saved = await saveSpec(plugin, target, text, verb === 'create');
          print(
            saved,
            (s) => `${verb === 'create' ? 'Created' : 'Edited'} Spec ${target.story ?? target.slug}: ${s.title}`,
          );
        }
      }),
    );
  }
};
