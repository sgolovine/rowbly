import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/storage';
import { makeBoard, makeRootConfig, makeStory, runCli, tempRoot } from '../helpers';

const web = { boardId: 'web' };

async function setup() {
  const t = await tempRoot();
  await makeRootConfig(t.path, { assignees: [{ handle: 'alice', name: 'Alice' }] });
  await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
  await makeStory(t.path, { ...web, key: 'WEB-1' });
  const cli = (args: string[], env: NodeJS.ProcessEnv = {}) => runCli(args, { root: t.path, cwd: t.dir, env });
  await cli(['tasks', 'create', 'WEB-1', '--name', 'One']);
  await cli(['tasks', 'create', 'WEB-1', '--name', 'Two']);
  const story = () => createRepositories(t.root).stories.findByKey('WEB-1');
  return { t, cli, story };
}

describe('rowbly comments', () => {
  it('stores a Comment on a Task, not on its Story', async () => {
    const { cli, story } = await setup();
    const result = await cli(['comments', 'add', 'WEB-1.2', '--body', 'hi', '--json']);
    expect(result.exitCode).toBe(0);
    const { id } = JSON.parse(result.stdout);
    const saved = await story();
    expect(saved.comments).toEqual([]);
    expect(saved.tasks[1]?.comments).toEqual([expect.objectContaining({ id, body: 'hi', author: null })]);
  });

  it('stores the output of $EDITOR with --edit', async () => {
    const { t, cli, story } = await setup();
    const editor = join(t.dir, 'editor.sh');
    await writeFile(editor, '#!/bin/sh\nprintf "from the editor\\n" > "$1"\n', { mode: 0o755 });
    const result = await cli(['comments', 'add', 'WEB-1', '--edit'], { EDITOR: editor });
    expect(result.exitCode).toBe(0);
    expect((await story()).comments.map((c) => c.body)).toEqual(['from the editor']);
  });

  it('requires --yes to delete when not interactive', async () => {
    const { cli, story } = await setup();
    const { id } = JSON.parse((await cli(['comments', 'add', 'WEB-1', '--body', 'x', '--json'])).stdout);
    const refused = await cli(['comments', 'delete', 'WEB-1', id]);
    expect(refused.exitCode).toBe(2);
    expect((await story()).comments).toHaveLength(1);
    expect((await cli(['comments', 'delete', 'WEB-1', id, '--yes'])).stdout).toBe(`Deleted Comment ${id}\n`);
    expect((await story()).comments).toEqual([]);
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
