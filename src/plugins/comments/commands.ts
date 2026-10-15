import { colors, type PluginCommandEnv, type PluginDefinition } from '../../plugin-api';
import { addComment, deleteComment, editComment, getComment, listComments } from './comments';
import type { Comment } from './model';

interface BodyOptions {
  body?: string;
  bodyFile?: string;
  edit?: boolean;
}

const TARGET = 'a Story Key (WEB-42) or a Task id (WEB-42.1)';

export const commands: NonNullable<PluginDefinition['commands']> = (group, cli) => {
  group.addHelpText('after', `\n<target> is ${TARGET}.`);

  group
    .command('list <target>')
    .description('List the Comments on a Story or Task, oldest first')
    .action((target: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(await listComments(plugin, target), renderComments);
      }),
    );

  withBody(group.command('add <target>').description('Add a Comment to a Story or Task')).action(
    (target: string, opts: BodyOptions, cmd) =>
      cli.run(cmd, async (env) => {
        const comment = await addComment(env.plugin, target, await readBody(env, opts));
        env.print(comment, (c) => `Added Comment ${c.id}`);
      }),
  );

  withBody(group.command('edit <target> <comment-id>').description('Change the body of a Comment')).action(
    (target: string, id: string, opts: BodyOptions, cmd) =>
      cli.run(cmd, async (env) => {
        const current = await getComment(env.plugin, target, id);
        const body = await readBody(env, opts, current.body);
        env.print(await editComment(env.plugin, target, id, body), (c) => `Updated Comment ${c.id}`);
      }),
  );

  group
    .command('delete <target> <comment-id>')
    .description('Delete a Comment')
    .action((target: string, id: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print, confirm }) => {
        await getComment(plugin, target, id);
        await confirm(`Delete Comment ${id}?`);
        print(await deleteComment(plugin, target, id), () => `Deleted Comment ${id}`);
      }),
    );
};

function withBody<C extends { option(flags: string, description: string): C }>(cmd: C): C {
  return cmd
    .option('--body <text>', 'Comment body (markdown)')
    .option('--body-file <path>', 'read the body from a file, or - for stdin')
    .option('--edit', 'write the body in $VISUAL/$EDITOR');
}

/** The body from its flags; prompts for it when none is given and prompting is allowed. */
async function readBody(env: PluginCommandEnv<unknown>, opts: BodyOptions, initial?: string): Promise<string> {
  const body = await env.readText({ text: opts.body, file: opts.bodyFile, edit: opts.edit }, { name: 'body', initial });
  return env.prompt(body, { flag: '--body', message: 'Comment' });
}

function renderComments(comments: readonly Comment[]): string {
  if (comments.length === 0) return colors.dim('No Comments yet.');
  return comments
    .map((c) => {
      const edited = c.updatedAt !== c.createdAt ? colors.dim(' (edited)') : '';
      const header = `${colors.bold(c.author ?? 'unknown')} ${colors.dim(`${c.createdAt} · ${c.id}`)}${edited}`;
      return `${header}\n${c.body.replace(/^/gm, '  ')}`;
    })
    .join('\n\n');
}
