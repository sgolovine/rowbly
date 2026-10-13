import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeBoard, makeStory, runCli, type TempRoot } from '../helpers';
import { pluginRoot } from './helpers';

const cli = (t: TempRoot, args: string[], opts: Parameters<typeof runCli>[1] = {}) =>
  runCli(args, { root: t.path, ...opts });
const json = (text: string) => JSON.parse(text);

describe('rowbly specs', () => {
  it('lists, creates, shows, edits and deletes Board Specs with confirmation', async () => {
    const t = await pluginRoot({ specs: true });
    const created = await cli(t, ['specs', 'create', 'auth', '--title', 'Auth', '--text', 'Body', '--json']);
    expect(created.exitCode).toBe(0);
    expect(json(created.stdout)).toEqual({ slug: 'auth', title: 'Auth', text: '# Auth\n\nBody' });
    expect((await cli(t, ['specs', 'show', 'auth'])).stdout).toContain('# Auth\n\nBody');
    expect(json((await cli(t, ['specs', 'list', '--board', 'web', '--json'])).stdout)).toHaveLength(1);
    expect((await cli(t, ['specs', 'edit', 'auth', '--title', 'Changed'])).exitCode).toBe(0);
    expect((await cli(t, ['specs', 'show', 'auth'])).stdout).toContain('# Changed');
    expect((await cli(t, ['specs', 'create', 'auth', '--title', 'Duplicate'])).exitCode).toBe(4);
    expect((await cli(t, ['specs', 'delete', 'auth'])).exitCode).toBe(2);
    expect((await cli(t, ['specs', 'delete', 'auth', '--yes'])).exitCode).toBe(0);
    expect((await cli(t, ['specs', 'show', 'auth'])).exitCode).toBe(3);
  });

  it('uses files, stdin and the API editor capability and rejects conflicting text flags', async () => {
    const t = await pluginRoot({ specs: true });
    const file = join(t.dir, 'input.md');
    await writeFile(file, '# Old\n\nFrom file');
    expect((await cli(t, ['specs', 'create', 'file', '--title', 'File', '--file', file])).exitCode).toBe(0);
    expect((await cli(t, ['specs', 'show', 'file'])).stdout).toContain('# File\n\nFrom file');
    expect((await cli(t, ['specs', 'edit', 'file', '--file', '-'], { stdin: '# Piped\n\nFrom stdin' })).exitCode).toBe(
      0,
    );
    const editor = join(t.dir, 'editor.sh');
    await writeFile(editor, '#!/bin/sh\nprintf "# Edited\\n\\nEditor text\\n" > "$1"\n', { mode: 0o755 });
    expect((await cli(t, ['specs', 'edit', 'file', '--edit'], { env: { EDITOR: editor } })).exitCode).toBe(0);
    expect((await cli(t, ['specs', 'show', 'file'])).stdout).toContain('Editor text');
    expect((await cli(t, ['specs', 'edit', 'file', '--text', 'x', '--file', file])).exitCode).toBe(2);
    expect((await cli(t, ['specs', 'create', '../escape', '--title', 'Bad'])).exitCode).toBe(2);
    expect((await cli(t, ['specs', 'create', 'untitled'])).exitCode).toBe(2);
  });

  it('the --story forms use case-insensitive Story Keys and do not collide with slugs', async () => {
    const t = await pluginRoot({ specs: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    expect((await cli(t, ['specs', 'create', '--story', 'web-1', '--title', 'Story', '--text', 'Own'])).exitCode).toBe(
      0,
    );
    expect((await cli(t, ['specs', 'create', 'web-1', '--title', 'Board'])).exitCode).toBe(0);
    expect((await cli(t, ['specs', 'show', '--story', 'WEB-1'])).stdout).toContain('Own');
    expect((await cli(t, ['specs', 'edit', '--story', 'web-1', '--title', 'New'])).exitCode).toBe(0);
    expect((await cli(t, ['specs', 'create', '--story', 'WEB-1', '--title', 'Duplicate'])).exitCode).toBe(4);
    expect((await cli(t, ['specs', 'show', 'web-1', '--story', 'WEB-1'])).exitCode).toBe(2);
    expect((await cli(t, ['specs', 'delete', '--story', 'WEB-1', '--yes'])).exitCode).toBe(0);
    expect((await cli(t, ['specs', 'show', 'web-1'])).stdout).toContain('# Board');
  });

  it('Story flags set/add/remove/filter links; deletion warns and unlinks', async () => {
    const t = await pluginRoot({ specs: true });
    await cli(t, ['specs', 'create', 'auth', '--title', 'Auth']);
    await cli(t, ['specs', 'create', 'api', '--title', 'API']);
    const created = await cli(t, ['stories', 'create', '--name', 'Login', '--spec', 'auth', '--spec', 'api', '--json']);
    expect(created.exitCode).toBe(0);
    expect(json(created.stdout).plugins).toEqual({ specs: { specs: ['auth', 'api'] } });
    await cli(t, ['stories', 'create', '--name', 'Other']);
    expect(
      json((await cli(t, ['stories', 'list', '--spec', 'auth', '--spec', 'api', '--json'])).stdout).map(
        (s: { key: string }) => s.key,
      ),
    ).toEqual(['WEB-1']);
    expect((await cli(t, ['stories', 'edit', 'WEB-1', '--remove-spec', 'api'])).exitCode).toBe(0);
    expect((await cli(t, ['stories', 'edit', 'WEB-2', '--add-spec', 'auth'])).exitCode).toBe(0);
    expect((await cli(t, ['stories', 'edit', 'WEB-1', '--spec', 'api'])).exitCode).toBe(0);
    expect((await cli(t, ['stories', 'edit', 'WEB-1', '--spec', 'missing'])).exitCode).toBe(4);
    expect((await cli(t, ['stories', 'edit', 'WEB-1', '--spec', 'auth', '--add-spec', 'api'])).exitCode).toBe(2);
    expect((await cli(t, ['stories', 'edit', 'WEB-1', '--spec', '../escape'])).exitCode).toBe(2);
    const deleted = await cli(t, ['specs', 'delete', 'auth', '--yes']);
    expect(deleted.stderr).toContain('Unlinked Board Spec "auth" from 1 Stories');
    expect(json((await cli(t, ['stories', 'show', 'WEB-2', '--json'])).stdout).plugins).toBeUndefined();
  });

  it('guard rejects deletion of an empty Board with Specs (exit 4), force succeeds', async () => {
    const t = await pluginRoot({ specs: true });
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    await cli(t, ['specs', 'create', 'auth', '--title', 'Auth', '--board', 'api']);
    const rejected = await cli(t, ['boards', 'delete', 'api', '--yes', '--json']);
    expect(rejected.exitCode).toBe(4);
    expect(json(rejected.stderr).error.details.plugin).toBe('specs');
    expect((await cli(t, ['boards', 'delete', 'api', '--force', '--yes'])).exitCode).toBe(0);
  });
});

it('doctor CLI reports SPECS_MISSING_SPEC and --fix unlinks it', async () => {
  const t = await pluginRoot({ specs: true });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { specs: { specs: ['gone'] } } });
  const report = await cli(t, ['doctor', '--json']);
  expect(report.exitCode).toBe(0);
  expect(json(report.stdout).findings).toMatchObject([{ code: 'SPECS_MISSING_SPEC', severity: 'warning' }]);
  const fixed = await cli(t, ['doctor', '--fix', '--json']);
  expect(fixed.exitCode).toBe(0);
  expect(json(fixed.stdout).fixed).toMatchObject([{ code: 'SPECS_MISSING_SPEC' }]);
});
