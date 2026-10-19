import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeBoard, makeStory, type RunCliOptions, runCli, type TempRoot } from '../helpers';
import { pluginRoot, readJsonFile } from './helpers';

const cli = (t: TempRoot, args: string[], opts: RunCliOptions = {}) => runCli(args, { root: t.path, ...opts });
const json = (text: string) => JSON.parse(text);

describe('rowbly epics', () => {
  it('is registered, off by default, and enabled through Plugin settings', async () => {
    const t = await pluginRoot();
    const listed = json((await cli(t, ['plugins', 'list', '--json'])).stdout);
    expect(listed).toContainEqual(expect.objectContaining({ id: 'epics', enabled: false, known: true }));
    expect((await cli(t, ['epics', 'list'])).exitCode).toBe(2);
    expect((await cli(t, ['plugins', 'enable', 'epics'])).exitCode).toBe(0);
    expect((await cli(t, ['epics', 'list'])).stdout).toContain('No Epics.');
  });

  it('creates, lists, edits, closes, reopens, shows and deletes Epics', async () => {
    const t = await pluginRoot({ epics: true });
    const created = await cli(t, ['epics', 'create', 'auth', '--name', 'Auth', '--description-file', '-', '--json'], {
      stdin: 'Login flow',
    });
    expect(created.exitCode).toBe(0);
    expect(json(created.stdout)).toMatchObject({ id: 'auth', name: 'Auth', description: 'Login flow', closed: false });
    expect((await cli(t, ['epics', 'create', 'auth', '--name', 'Duplicate'])).exitCode).toBe(4);
    expect((await cli(t, ['epics', 'create', 'bad/id', '--name', 'Bad'])).exitCode).toBe(2);
    expect((await cli(t, ['epics', 'create', 'noname'])).exitCode).toBe(2);
    expect((await cli(t, ['epics', 'list'])).stdout).toMatch(/auth\s+Auth/);
    expect((await cli(t, ['epics', 'edit', 'auth', '--name', 'Access'])).exitCode).toBe(0);
    expect((await cli(t, ['epics', 'edit', 'auth'])).exitCode).toBe(2);
    expect((await cli(t, ['epics', 'edit', 'auth', '--description', 'New', '--description-file', '-'])).exitCode).toBe(
      2,
    );
    await cli(t, ['epics', 'close', 'auth']);
    expect(json((await cli(t, ['epics', 'list', '--json'])).stdout)).toEqual([]);
    expect(json((await cli(t, ['epics', 'list', '--closed', '--json'])).stdout)).toHaveLength(1);
    expect(json((await cli(t, ['epics', 'list', '--all', '--json'])).stdout)).toHaveLength(1);
    expect((await cli(t, ['epics', 'list', '--all', '--closed'])).exitCode).toBe(2);
    await cli(t, ['epics', 'reopen', 'auth']);
    await cli(t, ['stories', 'create', '--name', 'Login', '--epic', 'auth']);
    await makeBoard(t.path, {
      id: 'api',
      name: 'API',
      keyPrefix: 'API',
    });
    await cli(t, ['stories', 'create', '--board', 'api', '--name', 'Endpoint', '--stage', 'done', '--epic', 'auth']);
    const detail = await cli(t, ['epics', 'show', 'auth']);
    expect(detail.stdout).toContain('Epic Progress: 1/2 Stories done (50%)');
    expect(detail.stdout).toContain('Board: Website (web)');
    expect(detail.stdout).toContain('Board: API (api)');
    expect(json((await cli(t, ['epics', 'show', 'auth', '--json'])).stdout).progress).toEqual({
      done: 1,
      total: 2,
      percent: 50,
    });
    expect((await cli(t, ['epics', 'show', 'missing'])).exitCode).toBe(3);
    expect((await cli(t, ['epics', 'delete', 'auth'])).exitCode).toBe(2);
    const removed = await cli(t, ['epics', 'delete', 'auth', '--yes']);
    expect(removed.exitCode).toBe(0);
    expect(removed.stderr).toContain('Unlinked 2 Stories');
    expect(await readJsonFile(t, 'boards/web/stories/WEB-1/story.json')).not.toHaveProperty('plugins');
    expect(await readJsonFile(t, 'boards/api/stories/API-1/story.json')).not.toHaveProperty('plugins');
  });

  it('supports Story options, rows and filters and doctor --fix', async () => {
    const t = await pluginRoot({ epics: true });
    await cli(t, ['epics', 'create', 'auth', '--name', 'Auth']);
    const linked = await cli(t, ['stories', 'create', '--name', 'Login', '--epic', 'auth', '--json']);
    expect(json(linked.stdout).plugins).toEqual({ epics: { epic: 'auth' } });
    await cli(t, ['stories', 'create', '--name', 'Signup']);
    expect((await cli(t, ['stories', 'show', 'WEB-1'])).stdout).toMatch(/Epic:\s+auth/);
    expect(
      json((await cli(t, ['stories', 'list', '--epic', 'auth', '--json'])).stdout).map((s: { key: string }) => s.key),
    ).toEqual(['WEB-1']);
    expect(
      json((await cli(t, ['stories', 'list', '--no-epic', '--json'])).stdout).map((s: { key: string }) => s.key),
    ).toEqual(['WEB-2']);
    expect((await cli(t, ['stories', 'edit', 'WEB-1', '--no-epic'])).exitCode).toBe(0);
    expect((await cli(t, ['stories', 'edit', 'WEB-2', '--epic', 'auth'])).exitCode).toBe(0);
    expect((await cli(t, ['stories', 'create', '--name', 'Invalid', '--epic', 'missing'])).exitCode).toBe(3);
    await makeStory(t.path, { key: 'WEB-3', boardId: 'web', rank: 'a2', plugins: { epics: { epic: 'missing' } } });
    const checked = json((await cli(t, ['doctor', '--json'])).stdout);
    expect(checked.findings).toContainEqual(
      expect.objectContaining({ code: 'EPICS_MISSING_EPIC', severity: 'warning' }),
    );
    expect((await cli(t, ['doctor', '--fix'])).exitCode).toBe(0);
    expect(await readJsonFile(t, 'boards/web/stories/WEB-3/story.json')).not.toHaveProperty('plugins');
  });

  it('keeps working next to a corrupt Epic file, which reads as DATA_INTEGRITY with its path (RES-12)', async () => {
    const t = await pluginRoot({ epics: true });
    await cli(t, ['epics', 'create', 'good', '--name', 'Good']);
    const bad = join(t.path, 'plugins/epics/bad.json');
    const conflict = '<<<<<<< HEAD\n{}\n=======\n>>>>>>> other\n';
    await mkdir(join(t.path, 'plugins/epics'), { recursive: true });
    await writeFile(bad, conflict);
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web', plugins: { epics: { epic: 'bad' } } });

    const listed = await cli(t, ['epics', 'list', '--json']);
    expect(listed.exitCode).toBe(0);
    expect(json(listed.stdout).map((e: { id: string }) => e.id)).toEqual(['good']);
    expect(json(listed.stderr).warning).toContain('Epic "bad" is unavailable: plugins/epics/bad.json');

    for (const args of [
      ['epics', 'show', 'bad', '--json'],
      ['epics', 'edit', 'bad', '--name', 'Fixed', '--json'],
    ]) {
      const failed = await cli(t, args);
      expect(failed.exitCode).toBe(6);
      expect(json(failed.stderr).error).toMatchObject({
        code: 'DATA_INTEGRITY',
        details: expect.objectContaining({ path: 'plugins/epics/bad.json', problem: 'conflict-markers' }),
      });
    }
    const checked = json((await cli(t, ['doctor', '--json'])).stdout);
    expect(checked.findings).toContainEqual(
      expect.objectContaining({ code: 'EPICS_CONFLICT_MARKERS', path: 'plugins/epics/bad.json' }),
    );
    await cli(t, ['doctor', '--fix']);
    expect(await readJsonFile(t, 'boards/web/stories/WEB-1/story.json')).toHaveProperty('plugins.epics.epic', 'bad');
    expect(await readFile(bad, 'utf8')).toBe(conflict);
  });

  it('checks for nothing to update before reading the Epic, and validates the Epic filter once (CQ-94, CQ-82)', async () => {
    const t = await pluginRoot({ epics: true });
    expect((await cli(t, ['epics', 'edit', 'missing'])).exitCode).toBe(2);
    expect((await cli(t, ['epics', 'edit', 'missing', '--name', 'Name'])).exitCode).toBe(3);
    expect((await cli(t, ['epics', 'edit', 'missing', '--name', ' '])).exitCode).toBe(2);
    const filtered = await cli(t, ['stories', 'list', '--epic', 'Not A Slug']);
    expect(filtered.exitCode).toBe(2);
    expect(filtered.stderr).toContain('--epic needs an Epic ID');
  });
});
