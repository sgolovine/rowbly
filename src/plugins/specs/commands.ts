import { type PluginCommands, UsageError } from '../../plugin-api';
import {
  createSpec,
  deleteSpec,
  editSpec,
  getSpec,
  listSpecs,
  listStorySpecs,
  resolveTarget,
  STORY_SPEC_SLUG,
  specLine,
  specTargetName,
  titledText,
} from './specs';

interface SpecOptions {
  board?: string;
  story?: string;
  title?: string;
  text?: string;
  file?: string;
  edit?: boolean;
}

export const commands: PluginCommands = (group, cli) => {
  group
    .command('list')
    .description("List the Board's Board Specs, or a Story's Story Specs")
    .option('--board <id>', 'the Board')
    .option('--story <KEY>', 'the Story Specs of this Story')
    .action((opts: SpecOptions, cmd) =>
      cli.run(cmd, async ({ plugin, print, resolveBoard }) => {
        if (opts.story) {
          if (opts.board) throw new UsageError('Use --story without --board to list Story Specs');
          const specs = await listStorySpecs(plugin, await plugin.services.stories.get(opts.story));
          print(specs, (items) => items.map(specLine).join('\n') || 'No Story Specs.');
          return;
        }
        const specs = await listSpecs(plugin, await resolveBoard(opts.board));
        print(specs, (items) => items.map(specLine).join('\n') || 'No Board Specs.');
      }),
    );
  for (const verb of ['create', 'show', 'edit', 'delete'] as const) {
    const command = group
      .command(`${verb} [slug]`)
      .description(`${verb[0]?.toUpperCase()}${verb.slice(1)} a Board Spec or Story Spec`)
      .option('--board <id>', 'the Board')
      .option('--story <KEY>', `a Story Spec of this Story; its slug defaults to "${STORY_SPEC_SLUG}"`);
    if (verb === 'create' || verb === 'edit') {
      command
        .option('--title <title>', 'the Spec title')
        .option('--text <text>', 'markdown text')
        .option('--file <path|->', 'read markdown from a file or stdin')
        .option('--edit', 'open $VISUAL or $EDITOR');
    }
    command.action((slug: string | undefined, opts: SpecOptions, cmd) =>
      cli.run(cmd, async (env) => {
        const { plugin, print } = env;
        const target = await resolveTarget(plugin, slug, opts, env.resolveBoard);
        const name = specTargetName(target);
        if (verb === 'show') {
          print(await getSpec(plugin, target), (s) => s.text);
        } else if (verb === 'delete') {
          await getSpec(plugin, target);
          await env.confirm(`Delete Spec "${name}"?${target.story ? '' : ' Board Spec links will be removed.'}`);
          const unlinked = await deleteSpec(plugin, target);
          print({ deleted: name, unlinked }, (s) => `Deleted Spec ${s.deleted}`);
        } else {
          // Specs' own flags: `readText` would name `--text-file`, which Specs does not have.
          if ([opts.text !== undefined, opts.file !== undefined, !!opts.edit].filter(Boolean).length > 1)
            throw new UsageError('Use only one of --text, --file and --edit');
          const initial = verb === 'edit' ? (await getSpec(plugin, target)).text : '';
          const title =
            verb === 'create' ? await env.prompt(opts.title, { flag: '--title', message: 'Spec title' }) : opts.title;
          // The title seeds the editor once; a heading changed in the editor is kept as written.
          const text = opts.edit
            ? await env.editText(titledText(initial, title))
            : titledText(
                (await env.readText({ text: opts.text, file: opts.file }, { name: 'text' })) ?? initial,
                title,
              );
          const saved =
            verb === 'create' ? await createSpec(plugin, target, text) : await editSpec(plugin, target, text);
          print(saved, (s) => `${verb === 'create' ? 'Created' : 'Edited'} Spec ${name}: ${s.title}`);
        }
      }),
    );
  }
};
