import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeStory, runCli } from '../helpers';
import { readCommentThread } from './commentsHelpers';
import { pluginRoot } from './helpers';

async function setup(on = true) {
  const t = await pluginRoot(on ? { comments: true } : {});
  await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
  const cli = (args: string[], env: NodeJS.ProcessEnv = {}) => runCli(args, { root: t.path, cwd: t.dir, env });
  await cli(['tasks', 'create', 'WEB-1', '--name', 'One']);
  await cli(['tasks', 'create', 'WEB-1', '--name', 'Two']);
  const thread = (task?: number) => readCommentThread(t, 'WEB-1', task);
  return { t, cli, thread };
}

describe('rowbly comments', () => {
  it('is off by default', async () => {
    const { cli } = await setup(false);
    expect((await cli(['comments', 'list', 'WEB-1'])).exitCode).toBe(2);
    expect((await cli(['stories', 'show', 'WEB-1'])).stdout).not.toContain('Comments');
    expect((await cli(['plugins', 'enable', 'comments'])).exitCode).toBe(0);
    expect((await cli(['comments', 'list', 'WEB-1'])).stdout).toContain('No Comments yet.');
  });

  it('stores a Comment on a Task, not on its Story', async () => {
    const { cli, thread } = await setup();
    const result = await cli(['comments', 'add', 'WEB-1.2', '--body', 'hi', '--json']);
    expect(result.exitCode).toBe(0);
    const { id } = JSON.parse(result.stdout);
    expect(await thread()).toEqual([]);
    expect(await thread(1)).toEqual([expect.objectContaining({ id, body: 'hi', author: null })]);
  });

  it('counts Comments in stories show and tasks show', async () => {
    const { cli } = await setup();
    await cli(['comments', 'add', 'WEB-1', '--body', 'one']);
    await cli(['comments', 'add', 'WEB-1', '--body', 'two']);
    await cli(['comments', 'add', 'WEB-1.1', '--body', 'three']);
    expect((await cli(['stories', 'show', 'WEB-1'])).stdout).toMatch(/Comments:\s+2/);
    expect((await cli(['tasks', 'show', 'WEB-1.1'])).stdout).toMatch(/Comments:\s+1/);
    expect((await cli(['tasks', 'show', 'WEB-1.2'])).stdout).toMatch(/Comments:\s+0/);
  });

  it('stores the output of $EDITOR with --edit', async () => {
    const { t, cli, thread } = await setup();
    const editor = join(t.dir, 'editor.sh');
    await writeFile(editor, '#!/bin/sh\nprintf "from the editor\\n" > "$1"\n', { mode: 0o755 });
    const result = await cli(['comments', 'add', 'WEB-1', '--edit'], { EDITOR: editor });
    expect(result.exitCode).toBe(0);
    expect((await thread()).map((c) => c.body)).toEqual(['from the editor']);
  });

  it('requires --yes to delete when not interactive', async () => {
    const { cli, thread } = await setup();
    const { id } = JSON.parse((await cli(['comments', 'add', 'WEB-1', '--body', 'x', '--json'])).stdout);
    const refused = await cli(['comments', 'delete', 'WEB-1', id]);
    expect(refused.exitCode).toBe(2);
    expect(await thread()).toHaveLength(1);
    expect((await cli(['comments', 'delete', 'WEB-1', id, '--yes'])).stdout).toBe(`Deleted Comment ${id}\n`);
    expect(await thread()).toEqual([]);
    expect((await cli(['comments', 'delete', 'WEB-1', id, '--yes'])).exitCode).toBe(3);
  });

  it('lists oldest first, edits, and rejects an empty or missing body', async () => {
    const { t, cli } = await setup();
    await cli(['comments', 'add', 'WEB-1', '--body', 'first']);
    const bodyFile = join(t.dir, 'body.md');
    await writeFile(bodyFile, 'second\n');
    const second = await cli(['comments', 'add', 'web-1', '--body-file', bodyFile, '--json']);
    const { id } = JSON.parse(second.stdout);
    expect((await cli(['comments', 'edit', 'WEB-1', id, '--body', 'second, edited'])).stdout).toBe(
      `Updated Comment ${id}\n`,
    );
    const list = await cli(['comments', 'list', 'WEB-1']);
    expect(list.stdout.indexOf('first')).toBeLessThan(list.stdout.indexOf('second, edited'));
    expect(list.stdout).toContain('(edited)');
    expect((await cli(['comments', 'add', 'WEB-1', '--body', ''])).exitCode).toBe(2);
    expect((await cli(['comments', 'add', 'WEB-1'])).stderr).toContain('missing required --body');
    expect((await cli(['comments', 'list', 'WEB-1.9'])).exitCode).toBe(3);
  });
});
