import type { Command } from 'commander';
import { NotFoundError } from '../core';
import { colors, printResult } from '../output';
import type { Comment } from '../schemas';
import type { Services } from '../services';
import { confirmDestructive, type GlobalOptions, promptIfMissing, readLongText, withContext } from './_shared';

interface BodyOptions {
  body?: string;
  bodyFile?: string;
  edit?: boolean;
}

const TARGET = 'a Story Key (WEB-42) or a Task id (WEB-42.1)';

export function registerComments(program: Command): void {
  const comments = program.command('comments').description(`Manage Comments on a Story or Task; <target> is ${TARGET}`);

  comments
    .command('list <target>')
    .description('List the Comments on a Story or Task, oldest first')
    .action(async (target: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const list = await services.comments.list(target);
        printResult(list, { json: globals.json, human: renderComments });
      }),
    );

  withBody(comments.command('add <target>').description('Add a Comment to a Story or Task')).action(
    async (target: string, opts: BodyOptions, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const body = await readBody(opts, globals);
        const comment = await services.comments.add(target, body);
        printResult(comment, { json: globals.json, human: (c) => `Added Comment ${c.id}` });
      }),
  );

  withBody(comments.command('edit <target> <comment-id>').description('Change the body of a Comment')).action(
    async (target: string, id: string, opts: BodyOptions, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        const initial = opts.edit ? (await find(services, target, id)).body : undefined;
        const body = await readBody(opts, globals, initial);
        const comment = await services.comments.update(target, id, body);
        printResult(comment, { json: globals.json, human: (c) => `Updated Comment ${c.id}` });
      }),
  );

  comments
    .command('delete <target> <comment-id>')
    .description('Delete a Comment')
    .action(async (target: string, id: string, _opts: unknown, cmd: Command) =>
      withContext(cmd, async ({ services, globals }) => {
        await find(services, target, id);
        await confirmDestructive(`Delete Comment ${id}?`, globals);
        await services.comments.remove(target, id);
        printResult({ deleted: id }, { json: globals.json, human: () => `Deleted Comment ${id}` });
      }),
    );
}

function withBody(cmd: Command): Command {
  return cmd
    .option('--body <text>', 'Comment body (markdown)')
    .option('--body-file <path>', 'read the body from a file, or - for stdin')
    .option('--edit', 'write the body in $VISUAL/$EDITOR');
}

/** The body from its flags; prompts for it when none is given and prompting is allowed. */
async function readBody(opts: BodyOptions, globals: GlobalOptions, initial?: string): Promise<string> {
  const body = await readLongText({ text: opts.body, file: opts.bodyFile, edit: opts.edit }, { name: 'body', initial });
  return promptIfMissing(body, globals, { flag: '--body', message: 'Comment', initialValue: initial });
}

/** Checks that the Comment exists before asking for anything. */
async function find(services: Services, target: string, id: string): Promise<Comment> {
  const comment = (await services.comments.list(target)).find((c) => c.id === id);
  if (comment) return comment;
  throw new NotFoundError(`Comment "${id}" not found on ${target.toUpperCase()}`, {
    hint: `run \`rowbly comments list ${target.toUpperCase()}\``,
  });
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
