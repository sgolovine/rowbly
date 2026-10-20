import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeBoard, makeStory, type RunCliOptions, runCli, type TempRoot } from '../helpers';
import { pluginRoot } from './helpers';

const cli = (t: TempRoot, args: string[], opts: RunCliOptions = {}) => runCli(args, { root: t.path, ...opts });
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
    // With --story, a slug names one of the Story's Story Specs, never the Board Spec.
    expect((await cli(t, ['specs', 'show', 'web-1', '--story', 'WEB-1'])).exitCode).toBe(3);
    expect((await cli(t, ['specs', 'show', '--story', 'WEB-1', '--board', 'web'])).exitCode).toBe(2);
    expect((await cli(t, ['specs', 'delete', '--story', 'WEB-1', '--yes'])).exitCode).toBe(0);
    expect((await cli(t, ['specs', 'show', 'web-1'])).stdout).toContain('# Board');
  });

  it('a Story has any number of Story Specs, named by slug; without one, --story means spec (ADR-0025)', async () => {
    const t = await pluginRoot({ specs: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    expect((await cli(t, ['specs', 'list', '--story', 'WEB-1'])).stdout).toContain('No Story Specs.');
    expect((await cli(t, ['specs', 'create', '--story', 'WEB-1', '--title', 'Requirements'])).exitCode).toBe(0);
    const design = await cli(t, ['specs', 'create', 'design', '--story', 'web-1', '--title', 'Design', '--json']);
    expect(json(design.stdout)).toEqual({ slug: 'design', title: 'Design', text: '# Design\n\n' });
    expect(await readFile(join(t.path, 'boards/web/stories/WEB-1/plugins/specs/design.md'), 'utf8')).toBe(
      '# Design\n\n',
    );
    expect(json((await cli(t, ['specs', 'list', '--story', 'WEB-1', '--json'])).stdout)).toMatchObject([
      { slug: 'design', title: 'Design' },
      { slug: 'spec', title: 'Requirements' },
    ]);
    expect((await cli(t, ['specs', 'show', 'spec', '--story', 'WEB-1'])).stdout).toContain('# Requirements');
    expect(
      (await cli(t, ['specs', 'edit', 'design', '--story', 'WEB-1', '--text', '# Design\n\nBoxes'])).exitCode,
    ).toBe(0);
    expect((await cli(t, ['specs', 'show', 'design', '--story', 'WEB-1'])).stdout).toContain('Boxes');
    expect((await cli(t, ['specs', 'create', 'design', '--story', 'WEB-1', '--title', 'Again'])).exitCode).toBe(4);
    expect((await cli(t, ['specs', 'create', 'Bad Slug', '--story', 'WEB-1', '--title', 'Bad'])).exitCode).toBe(2);
    expect((await cli(t, ['specs', 'list', '--story', 'WEB-1', '--board', 'web'])).exitCode).toBe(2);
    expect((await cli(t, ['specs', 'delete', 'design', '--story', 'WEB-1', '--yes'])).exitCode).toBe(0);
    expect((await cli(t, ['specs', 'list', '--story', 'WEB-1'])).stdout).toBe('spec  Requirements\n');
    // The Board's list holds only Board Specs.
    expect((await cli(t, ['specs', 'list', '--board', 'web'])).stdout).toContain('No Board Specs.');
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

  it('an invalid links bag refuses --add-spec and --spec (exit 6) until --reset-specs replaces it', async () => {
    const t = await pluginRoot({ specs: true });
    await cli(t, ['specs', 'create', 'auth', '--title', 'Auth']);
    const invalid = { specs: { specs: 'auth' }, other: { keep: true } };
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: invalid });
    for (const flags of [
      ['--add-spec', 'auth'],
      ['--remove-spec', 'auth'],
      ['--spec', 'auth'],
    ]) {
      const refused = await cli(t, ['stories', 'edit', 'WEB-1', ...flags, '--json']);
      expect(refused.exitCode).toBe(6);
      expect(json(refused.stderr).error).toMatchObject({
        code: 'DATA_INTEGRITY',
        details: { plugin: 'specs', path: 'plugins.specs', operation: 'stories.update' },
      });
    }
    expect((await cli(t, ['stories', 'edit', 'WEB-1', '--add-spec', 'auth'])).stderr).toContain('--reset-specs');
    expect(json((await cli(t, ['stories', 'show', 'WEB-1', '--json'])).stdout).plugins).toEqual(invalid);
    expect((await cli(t, ['stories', 'edit', 'WEB-1', '--reset-specs', '--add-spec', 'auth'])).exitCode).toBe(2);
    expect((await cli(t, ['stories', 'edit', 'WEB-1', '--reset-specs', '--spec', 'auth'])).exitCode).toBe(0);
    expect(json((await cli(t, ['stories', 'show', 'WEB-1', '--json'])).stdout).plugins).toEqual({
      other: { keep: true },
      specs: { specs: ['auth'] },
    });
  });

  it('--title seeds the editor once; a heading changed in the editor is saved as written', async () => {
    const t = await pluginRoot({ specs: true });
    const seen = join(t.dir, 'seen.md');
    const editor = join(t.dir, 'editor.sh');
    await writeFile(editor, `#!/bin/sh\ncp "$1" "${seen}"\nprintf "# Mine\\n\\nText\\n" > "$1"\n`, { mode: 0o755 });
    const created = await cli(t, ['specs', 'create', 'auth', '--title', 'Seed', '--edit', '--json'], {
      env: { EDITOR: editor },
    });
    expect(created.exitCode).toBe(0);
    expect(await readFile(seen, 'utf8')).toBe('# Seed\n\n');
    expect(json(created.stdout)).toEqual({ slug: 'auth', title: 'Mine', text: '# Mine\n\nText\n' });
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
});
