import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DataIntegrityError, definePlugin, NotFoundError, type PluginContext } from '../../src/plugin-api';
import { epics } from '../../src/plugins/epics';
import {
  createEpic,
  deleteEpic,
  editEpic,
  getEpic,
  listEpicSummaries,
  setEpicClosed,
  showEpic,
} from '../../src/plugins/epics/service';
import { tui } from '../../src/plugins/epics/tui';
import { makeStory, type TempRoot } from '../helpers';
import { pluginRoot, withPlugins } from './helpers';

const CONFLICT = '<<<<<<< HEAD\n{"version":1}\n=======\n>>>>>>> other\n';

const epicFile = (id: string, fields: Record<string, unknown> = {}) =>
  `${JSON.stringify(
    {
      version: 1,
      id,
      name: id,
      description: '',
      closed: false,
      createdAt: '2026-10-12T17:21:07.000Z',
      updatedAt: '2026-10-12T17:21:07.000Z',
      ...fields,
    },
    null,
    2,
  )}\n`;

async function writeEpicFiles(t: TempRoot, files: Record<string, string>) {
  await mkdir(join(t.path, 'plugins/epics'), { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(join(t.path, 'plugins/epics', name), text);
}

/** Every file under `plugins/epics/`, by name, with its exact text. */
async function epicFolder(t: TempRoot) {
  const dir = join(t.path, 'plugins/epics');
  const names = (await readdir(dir)).sort();
  return Object.fromEntries(await Promise.all(names.map(async (n) => [n, await readFile(join(dir, n), 'utf8')])));
}

/** `good.json` next to a conflict-marked `bad.json`, with a Story linked to each (r07). */
async function r07() {
  const t = await pluginRoot({ epics: true, unknown: { keep: 1 } });
  await writeEpicFiles(t, { 'good.json': epicFile('good', { name: 'Good' }), 'bad.json': CONFLICT });
  await makeStory(t.path, {
    key: 'WEB-1',
    boardId: 'web',
    plugins: { epics: { epic: 'bad' }, unknown: { keep: true } },
  });
  await makeStory(t.path, { key: 'WEB-2', boardId: 'web', rank: 'a1', plugins: { epics: { epic: 'good' } } });
  const loaded = await withPlugins(t, [epics]);
  return { t, ...loaded, plugin: loaded.services.plugins.context('epics') as PluginContext<Record<string, unknown>> };
}

describe('Epics with corrupt files (RES-12)', () => {
  it('lists, loads fields and filters for healthy Epics; the corrupt one is unavailable (r07)', async () => {
    const { t, plugin } = await r07();
    const { storyForm, storyFilter } = tui;
    if (!storyForm || !storyFilter) throw new Error('Epics has Story form and filter fields');
    const before = await epicFolder(t);

    const listing = await listEpicSummaries(plugin, 'all');
    expect(listing.summaries.map((e) => e.id)).toEqual(['good']);
    expect(listing.unavailable).toEqual([
      expect.objectContaining({ id: 'bad', path: 'plugins/epics/bad.json', problem: 'conflict-markers' }),
    ]);

    const story = await plugin.services.stories.get('WEB-2');
    const [field] = await storyForm.fields({ boardId: 'web', story, plugin });
    expect(field).toMatchObject({ name: 'epic', options: ['No Epic', 'good'], value: 'good' });
    const linkedToBad = await plugin.services.stories.get('WEB-1');
    const [kept] = await storyForm.fields({ boardId: 'web', story: linkedToBad, plugin });
    expect(kept).toMatchObject({ options: ['No Epic', 'good', 'bad'], value: 'bad' });

    const [filter] = await storyFilter.fields({ boardId: 'web', plugin });
    expect(filter?.options).toEqual(['All Epics', 'No Epic', 'bad', 'good']);
    expect(await epicFolder(t)).toEqual(before);
  });

  it('doctor reports the corrupt file with its path, keeps links to it, and rewrites nothing (r07)', async () => {
    const { t, services } = await r07();
    const before = await epicFolder(t);
    const { findings } = await services.doctor.check();
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'EPICS_CONFLICT_MARKERS',
        severity: 'error',
        path: 'plugins/epics/bad.json',
        fixable: false,
      }),
    );
    expect(findings.some((f) => f.code === 'EPICS_MISSING_EPIC')).toBe(false);
    await services.doctor.fix();
    expect(await epicFolder(t)).toEqual(before);
    expect((await services.stories.get('WEB-1')).plugins).toEqual({
      epics: { epic: 'bad' },
      unknown: { keep: true },
    });
  });

  it('doctor checks every Epic file and gives each problem its own finding', async () => {
    const t = await pluginRoot({ epics: true });
    await writeEpicFiles(t, {
      'a-json.json': '{ "version": 1, ',
      'b-conflict.json': CONFLICT,
      'c-future.json': epicFile('c-future', { version: 2, owner: 'someone' }),
      'd-schema.json': epicFile('d-schema', { name: '' }),
      'e-moved.json': epicFile('elsewhere'),
      'f-good.json': epicFile('f-good'),
      'notes.txt': 'not an Epic',
    });
    const before = await epicFolder(t);
    const { services } = await withPlugins(t, [epics]);
    const findings = (await services.doctor.check()).findings.filter((f) => f.code.startsWith('EPICS_'));
    expect(findings.map((f) => [f.code, f.path])).toEqual([
      ['EPICS_INVALID_JSON', 'plugins/epics/a-json.json'],
      ['EPICS_CONFLICT_MARKERS', 'plugins/epics/b-conflict.json'],
      ['EPICS_UNSUPPORTED_VERSION', 'plugins/epics/c-future.json'],
      ['EPICS_SCHEMA_INVALID', 'plugins/epics/d-schema.json'],
      ['EPICS_ID_MISMATCH', 'plugins/epics/e-moved.json'],
    ]);
    expect(findings.find((f) => f.code === 'EPICS_UNSUPPORTED_VERSION')?.message).toContain('version 2');
    expect(findings.find((f) => f.code === 'EPICS_SCHEMA_INVALID')?.message).toContain('name');
    expect(findings.find((f) => f.code === 'EPICS_ID_MISMATCH')?.message).toContain('"elsewhere"');
    expect(findings.every((f) => f.severity === 'error' && !f.fixable)).toBe(true);
    expect(await epicFolder(t)).toEqual(before);
  });

  it('reading or changing a corrupt Epic is DATA_INTEGRITY with its path; a missing one is NOT_FOUND', async () => {
    const { t, plugin } = await r07();
    const before = await epicFolder(t);
    for (const attempt of [
      () => getEpic(plugin, 'bad'),
      () => showEpic(plugin, 'bad'),
      () => editEpic(plugin, 'bad', { name: 'Fixed' }),
      () => setEpicClosed(plugin, 'bad', true),
      () => deleteEpic(plugin, 'bad'),
    ]) {
      const error = await attempt().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DataIntegrityError);
      expect(error).toMatchObject({
        exitCode: 6,
        details: expect.objectContaining({ path: 'plugins/epics/bad.json', problem: 'conflict-markers' }),
      });
    }
    await expect(getEpic(plugin, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(editEpic(plugin, 'nope', { name: 'No' })).rejects.toBeInstanceOf(NotFoundError);
    expect(await epicFolder(t)).toEqual(before);
    expect((await plugin.services.stories.get('WEB-1')).plugins?.epics).toEqual({ epic: 'bad' });
  });

  it('valid writes keep the stored format', async () => {
    const t = await pluginRoot({ epics: true });
    const { services } = await withPlugins(t, [epics]);
    const plugin = services.plugins.context('epics');
    await createEpic(plugin, { id: 'auth', name: 'Auth' });
    await editEpic(plugin, 'auth', { description: 'Login' });
    expect(await readFile(join(t.path, 'plugins/epics/auth.json'), 'utf8')).toBe(
      epicFile('auth', { name: 'Auth', description: 'Login' }),
    );
  });
});

describe('Epic link guards read the pending Change Set (ARCH-30)', () => {
  /** Epics, with a replacement of `stories.create` that first writes or deletes `auth.json`. */
  const withReplacement = (step: 'create' | 'delete') =>
    definePlugin({
      ...epics,
      replaces: {
        'stories.create': async ({ changes, core }) => {
          if (step === 'create') await changes.writeFile('dataRoot', 'auth.json', epicFile('auth'));
          else await changes.deleteFile('dataRoot', 'auth.json');
          return core();
        },
      },
    });

  it('accepts a link to an Epic created in the same operation', async () => {
    const t = await pluginRoot({ epics: true });
    const { services } = await withPlugins(t, [withReplacement('create')]);
    const story = await services.stories.create('web', { name: 'Login', plugins: { epics: { epic: 'auth' } } });
    expect(story.plugins).toEqual({ epics: { epic: 'auth' } });
    expect(await readFile(join(t.path, 'plugins/epics/auth.json'), 'utf8')).toBe(epicFile('auth'));
  });

  it('rejects a link to an Epic deleted in the same operation, and saves nothing', async () => {
    const t = await pluginRoot({ epics: true });
    await writeEpicFiles(t, { 'auth.json': epicFile('auth') });
    const { services } = await withPlugins(t, [withReplacement('delete')]);
    await expect(
      services.stories.create('web', { name: 'Login', plugins: { epics: { epic: 'auth' } } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await services.stories.list(null, {})).toEqual([]);
    expect(await readFile(join(t.path, 'plugins/epics/auth.json'), 'utf8')).toBe(epicFile('auth'));
  });
});
