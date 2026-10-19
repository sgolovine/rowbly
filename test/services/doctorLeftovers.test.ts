// Doctor findings for what the storage model can leave behind (ADR-0019 §9; RES-04, RES-07, VER-03):
// interrupted and leftover transactions, temporary files, abandoned `.moving` folders, orphan Story
// and Board folders, an incomplete .gitignore and data from an older Rowbly. Doctor never rewrites
// or deletes data that has no validated owner.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataIntegrityError } from '../../src/core';
import { StorySchema } from '../../src/schemas';
import { createServices } from '../../src/services';
import { io } from '../../src/storage/io';
import { makeStory, type TempRoot, writeFixture } from '../helpers';
import { pluginRoot, storyFile, withPlugins } from '../plugins/helpers';
import { snapshotTree } from '../storage/engineHelpers';

afterEach(() => {
  vi.restoreAllMocks();
});

async function put(t: TempRoot, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(t.path, path)), { recursive: true });
  await writeFile(join(t.path, path), text);
}

const ID = '20261015T120000000Z-0123abcd';

const codes = (report: { findings: { code: string; path: string }[] }) => report.findings.map((f) => [f.code, f.path]);

describe('transactions', () => {
  /** A prepared transaction whose last step can be neither finished nor found done. */
  async function stuck(t: TempRoot): Promise<void> {
    const manifest = {
      version: 1,
      id: ID,
      operation: 'stories.create',
      createdAt: '2026-10-15T12:00:00.000Z',
      pid: 1,
      host: 'elsewhere',
      phase: 'prepared',
      steps: [{ kind: 'moveIn', temp: 'moving/0', to: 'boards/web/stories/WEB-5' }],
    };
    await put(t, `.txn/${ID}/manifest.json`, JSON.stringify(manifest));
  }

  it('one that cannot be finished is TRANSACTION_PENDING, the only finding; other reads fail', async () => {
    const t = await pluginRoot();
    await stuck(t);
    const { services } = await withPlugins(t, []);
    const report = await services.doctor.check();
    expect(codes(report)).toEqual([['TRANSACTION_PENDING', `.txn/${ID}`]]);
    expect(report.findings[0]?.message).toContain('stories.create');
    expect(report.findings[0]?.details).toMatchObject({
      transaction: ID,
      operation: 'stories.create',
      pending: ['boards/web/stories/WEB-5'],
    });
    await expect(services.stories.list('web', {})).rejects.toThrow(DataIntegrityError);
    // --fix retries recovery; it still fails, and says so.
    expect(codes(await services.doctor.fix())).toEqual([['TRANSACTION_PENDING', `.txn/${ID}`]]);
  });

  it('one that is finished by doctor --fix is reported as fixed', async () => {
    const t = await pluginRoot();
    const story = await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const manifest = {
      version: 1,
      id: ID,
      operation: 'stories.update',
      createdAt: '2026-10-15T12:00:00.000Z',
      pid: 1,
      host: 'elsewhere',
      phase: 'prepared',
      steps: [{ kind: 'write', path: storyFile('WEB-1'), staged: 'staged/0', existed: true }],
    };
    await put(t, `.txn/${ID}/manifest.json`, JSON.stringify(manifest));
    await put(t, `.txn/${ID}/staged/0`, `${JSON.stringify({ ...story, name: 'Finished' }, null, 2)}\n`);
    const services = createServices({ ...(await withPlugins(t, [])).ctx });
    const report = await services.doctor.fix();
    expect(report.fixed).toEqual([
      { code: 'TRANSACTION_PENDING', path: `.txn/${ID}`, message: `finished stories.update (transaction ${ID})` },
    ]);
    expect((await services.stories.get('WEB-1')).name).toBe('Finished');
  });

  it('a folder recovery could not remove is TRANSACTION_LEFTOVER, which --fix removes', async () => {
    const t = await pluginRoot();
    await put(t, `.txn/${ID}/staged/0`, 'never prepared');
    const { services } = await withPlugins(t, []);
    const rm = io.rm;
    const spy = vi.spyOn(io, 'rm').mockImplementation(async (path) => {
      if (String(path).includes('.txn')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return rm(path);
    });
    expect(codes(await services.doctor.check())).toEqual([['TRANSACTION_LEFTOVER', `.txn/${ID}`]]);
    spy.mockRestore();
    const report = await services.doctor.fix();
    expect(report.findings).toEqual([]);
    expect(report.fixed.map((f) => f.code)).toEqual(['TRANSACTION_LEFTOVER']);
  });
});

describe('leftovers of interrupted writes and moves', () => {
  it('a temporary file is TEMP_FILE_LEFTOVER, which --fix removes', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const temp = 'boards/web/stories/WEB-1/.story.json.ab12cd34.tmp';
    await put(t, temp, '{"half": ');
    const { services } = await withPlugins(t, []);
    expect(codes(await services.doctor.check())).toEqual([['TEMP_FILE_LEFTOVER', temp]]);
    const report = await services.doctor.fix();
    expect(report.findings).toEqual([]);
    expect(Object.keys(await snapshotTree(t.path))).not.toContain(temp);
  });

  it('a .moving folder that holds a Story is reported with its key and kept (RES-04)', async () => {
    const t = await pluginRoot();
    const story = await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const moving = 'boards/web/stories/.ab12cd34.moving';
    await writeFixture(join(t.path, moving, 'story.json'), StorySchema, { ...story, key: 'WEB-2' });
    await put(t, `${moving}/plugins/specs/spec.md`, '# kept');
    const { services } = await withPlugins(t, []);
    const report = await services.doctor.check();
    expect(codes(report)).toEqual([['TEMP_FILE_LEFTOVER', moving]]);
    expect(report.findings[0]).toMatchObject({ severity: 'warning', fixable: false });
    expect(report.findings[0]?.message).toContain('WEB-2');
    expect(report.findings[0]?.message).toContain('boards/web/stories/WEB-2');
    const before = await snapshotTree(t.path);
    await services.doctor.fix();
    expect(await snapshotTree(t.path)).toEqual(before);
  });
});

describe('orphan folders (RES-07)', () => {
  it('a Story or Board folder with Plugin files but no record is ORPHAN_FOLDER, never adopted or removed', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await put(t, 'boards/web/stories/WEB-3/plugins/specs/spec.md', '# old');
    await put(t, 'boards/old/plugins/retired/a.txt', 'a');
    const { services } = await withPlugins(t, []);
    const report = await services.doctor.check();
    expect(report.findings.filter((f) => f.code === 'ORPHAN_FOLDER').map((f) => [f.path, f.fixable])).toEqual([
      ['boards/old', false],
      ['boards/web/stories/WEB-3', false],
    ]);
    const before = await snapshotTree(t.path);
    await services.doctor.fix();
    expect(await snapshotTree(t.path)).toEqual(before);
  });

  it('renumbering skips the key of an orphan folder', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Kept' });
    const later = await makeStory(t.path, {
      boardId: 'web',
      key: 'WEB-1',
      name: 'Moved',
      rank: 'a1',
      createdAt: '2026-10-13T00:00:00.000Z',
    });
    await writeFixture(join(t.path, storyFile('WEB-7')), StorySchema, later);
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Kept' });
    await put(t, 'boards/web/stories/WEB-8/plugins/specs/spec.md', '# old');
    const { services } = await withPlugins(t, []);
    const report = await services.doctor.fix();
    expect(report.fixed.map((f) => f.message)).toEqual(['renumbered WEB-1 ("Moved") to WEB-9']);
    expect(await readFile(join(t.path, 'boards/web/stories/WEB-8/plugins/specs/spec.md'), 'utf8')).toBe('# old');
  });
});

describe('.gitignore', () => {
  it('missing the lock or journal lines is GITIGNORE_INCOMPLETE, which --fix appends', async () => {
    const t = await pluginRoot();
    await put(t, '.gitignore', 'local.json\nnotes/\n');
    const { services } = await withPlugins(t, []);
    expect(codes(await services.doctor.check())).toEqual([['GITIGNORE_INCOMPLETE', '.gitignore']]);
    await services.doctor.fix();
    expect(await readFile(join(t.path, '.gitignore'), 'utf8')).toBe('local.json\nnotes/\n.lock\n.lock.break\n.txn/\n');
    expect((await services.doctor.check()).findings).toEqual([]);
  });
});

describe('data from an older Rowbly (VER-03, U1: no importer)', () => {
  it('top-level Comments, an epicId and old Epic files are LEGACY_DATA, and doctor --fix never rewrites them', async () => {
    const t = await pluginRoot();
    const story = await makeStory(t.path, { boardId: 'web', key: 'WEB-1', customFields: { ghost: 1 } });
    const legacy = {
      ...story,
      epicId: 'auth',
      comments: [{ id: 'c1', author: 'ana', body: 'old', createdAt: story.createdAt }],
    };
    await put(t, storyFile('WEB-1'), `${JSON.stringify(legacy, null, 2)}\n`);
    await put(t, 'epics/auth.json', '{"id":"auth"}');
    const { services } = await withPlugins(t, []);
    const report = await services.doctor.check();
    const found = report.findings.filter((f) => f.code === 'LEGACY_DATA');
    expect(found.map((f) => f.path)).toEqual([storyFile('WEB-1'), 'epics/auth.json']);
    expect(found[0]?.message).toContain('comments');
    expect(found[0]?.message).toContain('epicId');
    // The unknown Custom Field is not fixed: that would save the Story and drop its Comments.
    expect(report.findings.find((f) => f.code === 'UNKNOWN_FIELD')?.fixable).toBe(false);
    const before = await snapshotTree(t.path);
    await services.doctor.fix();
    expect(await snapshotTree(t.path)).toEqual(before);
  });

  it('an Assignee roster in rowbly.config.json and Story assignees are LEGACY_DATA, kept by doctor --fix', async () => {
    const t = await pluginRoot();
    const story = await makeStory(t.path, { boardId: 'web', key: 'WEB-1', customFields: { ghost: 1 } });
    await put(t, storyFile('WEB-1'), `${JSON.stringify({ ...story, assignees: ['ana'] }, null, 2)}\n`);
    const config = JSON.parse(await readFile(join(t.path, 'rowbly.config.json'), 'utf8'));
    await put(
      t,
      'rowbly.config.json',
      `${JSON.stringify({ ...config, assignees: [{ handle: 'ana', name: 'Ana' }] }, null, 2)}\n`,
    );
    const { services } = await withPlugins(t, []);
    const report = await services.doctor.check();
    const found = report.findings.filter((f) => f.code === 'LEGACY_DATA');
    expect(found.map((f) => [f.path, f.details?.fields])).toEqual([
      [storyFile('WEB-1'), ['assignees']],
      ['rowbly.config.json', ['assignees']],
    ]);
    // The unknown Custom Field is not fixed: that would save the Story and drop its Assignees.
    expect(report.findings.find((f) => f.code === 'UNKNOWN_FIELD')?.fixable).toBe(false);
    const before = await snapshotTree(t.path);
    await services.doctor.fix();
    expect(await snapshotTree(t.path)).toEqual(before);
  });
});
