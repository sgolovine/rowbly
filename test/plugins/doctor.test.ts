import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { definePlugin, z } from '../../src/plugin-api';
import { makeBoard, makeStory } from '../helpers';
import { boom, notes } from './fixtures';
import { pluginRoot, withPlugins } from './helpers';

async function writeText(root: string, path: string, text: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}

describe('doctor and Plugins', () => {
  it('reports a Plugin that failed to load as PLUGIN_FAILED, an error', async () => {
    const t = await pluginRoot({ boom: true });
    const { services } = await withPlugins(t, [boom]);
    const report = await services.doctor.check();
    expect(report.findings).toEqual([
      {
        code: 'PLUGIN_FAILED',
        severity: 'error',
        path: 'rowbly.config.json',
        message: 'Plugin "boom" failed to load: boom at start',
        fixable: false,
        details: { plugin: 'boom' },
      },
    ]);
  });

  it('runs the checks of a Plugin that is on, with codes prefixed by its id, and its fixes as one operation', async () => {
    const t = await pluginRoot({ notes: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { notes: { note: 'bad' } } });
    const { services } = await withPlugins(t, [notes]);
    const check = await services.doctor.check();
    expect(check.findings).toMatchObject([
      { code: 'NOTES_BAD_NOTE', severity: 'warning', fixable: true, message: 'WEB-1 has a bad note' },
    ]);
    const fixed = await services.doctor.fix();
    expect(fixed.fixed).toEqual([
      {
        code: 'NOTES_BAD_NOTE',
        path: 'boards/web/stories/WEB-1/story.json',
        message: 'removed the bad note of WEB-1',
      },
    ]);
    expect(fixed.findings).toEqual([]);
    expect(await services.stories.get('WEB-1')).not.toHaveProperty('plugins');
  });

  it('a guard on doctor.fix can refuse the fixes', async () => {
    const keep = definePlugin({
      id: 'keep',
      name: 'Keep',
      description: '',
      hooks: { 'doctor.fix': { guard: ({ input }) => ({ reject: `refusing ${input.findings.length} fixes` }) } },
    });
    const t = await pluginRoot({ notes: true, keep: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { notes: { note: 'bad' } } });
    const { services } = await withPlugins(t, [notes, keep]);
    await expect(services.doctor.fix()).rejects.toThrow('refusing 1 fixes');
  });

  it('checks the bags of a Plugin that is on against its schemas', async () => {
    const t = await pluginRoot({ notes: true });
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API', plugins: { notes: { marker: 5 } } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { notes: { note: '' } } });
    const { services } = await withPlugins(t, [notes]);
    const codes = (await services.doctor.check()).findings.map((f) => [f.code, f.path, f.message]);
    expect(codes).toEqual([
      [
        'PLUGIN_DATA_INVALID',
        'boards/api/board.config.json',
        'Board api has invalid Plugin Data for "notes": marker: Invalid input: expected string, received number',
      ],
      [
        'PLUGIN_DATA_INVALID',
        'boards/web/stories/WEB-1/story.json',
        'WEB-1 has invalid Plugin Data for "notes": note: Too small: expected string to have >=1 characters',
      ],
    ]);
  });

  it('reports the data of a Plugin that is off or unknown once, as info, and its files are in the layout', async () => {
    const t = await pluginRoot({}, { plugins: { notes: { enabled: false, marker: 'm' } } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { notes: { note: 'x' }, ghost: { a: 1 } } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', rank: 'a1', plugins: { ghost: { a: 2 } } });
    await writeText(t.path, 'plugins/notes/a.txt', 'A');
    await writeText(t.path, 'boards/web/plugins/ghost/b.txt', 'B');
    await writeText(t.path, 'boards/web/stories/WEB-1/plugins/notes/c.txt', 'C');
    await writeText(t.path, 'boards/web/stories/WEB-1/stray.txt', 'D');
    const { services } = await withPlugins(t, [notes]);
    const findings = (await services.doctor.check()).findings.map((f) => [f.code, f.message]);
    expect(findings).toEqual([
      [
        'PLUGIN_DATA_UNCHECKED',
        'Plugin "ghost" is not in this version of Rowbly; its data (2 records, 1 file) is kept but not checked',
      ],
      ['PLUGIN_DATA_UNCHECKED', 'Plugin "notes" is off; its data (2 records, 2 files) is kept but not checked'],
      ['UNKNOWN_FILE', 'file is not part of the Data Root layout; Rowbly ignores it'],
    ]);
  });
});

describe('doctor attribution (RES-17, ARCH-09, CQ-70)', () => {
  /** A Plugin `id` with one finding whose fix throws `error`, and whose details say `{ extra: 1 }`. */
  const throwing = (id: string, error: unknown = new Error('oops')) =>
    definePlugin({
      id,
      name: id,
      description: '',
      doctor: {
        check: () => [
          {
            code: 'BROKEN',
            severity: 'warning',
            path: 'rowbly.config.json',
            message: 'broken',
            details: { extra: 1, plugin: 'spoofed' },
            fix: async () => {
              throw error;
            },
          },
        ],
      },
    });

  for (const id of ['two-words', 'a-b-c']) {
    it(`a failed fix of "${id}" names the whole Plugin id in its details and hint`, async () => {
      const t = await pluginRoot({ [id]: true });
      const { services } = await withPlugins(t, [throwing(id)]);
      const err = (await services.doctor.fix().catch((e: unknown) => e)) as {
        code: string;
        details: Record<string, unknown>;
        hint: string;
      };
      expect(err.code).toBe('INTERNAL');
      expect(err.details).toMatchObject({ plugin: id, stage: 'doctor-fix' });
      expect(err.hint).toContain(`rowbly plugins disable ${id}`);
    });
  }

  it('an expected error from a fix keeps its code, attributed', async () => {
    const { ValidationError } = await import('../../src/core');
    const t = await pluginRoot({ 'my-plugin': true });
    const { services } = await withPlugins(t, [throwing('my-plugin', new ValidationError('bad input'))]);
    const err = (await services.doctor.fix().catch((e: unknown) => e)) as {
      code: string;
      details: Record<string, unknown>;
    };
    expect(err.code).toBe('VALIDATION');
    expect(err.details).toMatchObject({ plugin: 'my-plugin', stage: 'doctor-fix' });
  });

  it('a Plugin finding keeps its details, with the framework plugin id', async () => {
    const t = await pluginRoot({ 'two-words': true });
    const { services } = await withPlugins(t, [throwing('two-words')]);
    const report = await services.doctor.check();
    expect(report.findings).toEqual([
      {
        code: 'TWO_WORDS_BROKEN',
        severity: 'warning',
        path: 'rowbly.config.json',
        message: 'broken',
        fixable: true,
        details: { extra: 1, plugin: 'two-words' },
      },
    ]);
  });

  it('a code that is not an uppercase token, or that collides with a core code, fails clearly', async () => {
    const coded = (id: string, code: string) =>
      definePlugin({
        id,
        name: id,
        description: '',
        doctor: { check: () => [{ code, severity: 'warning', path: 'x', message: 'x' }] },
      });
    const t = await pluginRoot({ schema: true, lower: true });
    const { services } = await withPlugins(t, [coded('schema', 'INVALID'), coded('lower', 'bad code')]);
    const report = await services.doctor.check();
    expect(report.findings.map((f) => [f.code, f.details?.plugin, f.message])).toEqual([
      [
        'PLUGIN_FAILED',
        'schema',
        'Plugin "schema" reported a finding with code "INVALID", which would read as core code SCHEMA_INVALID',
      ],
      [
        'PLUGIN_FAILED',
        'lower',
        'Plugin "lower" reported a finding with code "bad code": codes are uppercase words joined by "_"',
      ],
    ]);
  });
});

describe('DoctorData.local (ARCH-21)', () => {
  it('a custom check reads a Local State preference and its fix changes it', async () => {
    const Pref = z.object({ theme: z.string() });
    const prefs = definePlugin({
      id: 'prefs',
      name: 'Prefs',
      description: '',
      bags: { local: Pref },
      doctor: {
        check: ({ data, plugin }) =>
          plugin.readBag(data.local, Pref)?.theme === 'retired'
            ? [
                {
                  code: 'OLD_THEME',
                  severity: 'warning',
                  path: 'local.json',
                  message: 'the theme is retired',
                  fix: async (changes) => {
                    await changes.updateLocalState((s) => plugin.writeBag(s, { theme: 'light' }));
                    return 'switched to light';
                  },
                },
              ]
            : [],
      },
    });
    const t = await pluginRoot({ prefs: true });
    await writeText(
      t.path,
      'local.json',
      JSON.stringify({ version: 1, plugins: { prefs: { theme: 'retired' }, off: { x: 1 } } }),
    );
    const { services } = await withPlugins(t, [prefs]);
    expect((await services.doctor.check()).findings.map((f) => f.code)).toEqual([
      'PREFS_OLD_THEME',
      'PLUGIN_DATA_UNCHECKED',
    ]);
    const report = await services.doctor.fix();
    expect(report.fixed.map((f) => f.message)).toEqual(['switched to light']);
    const { readFile } = await import('node:fs/promises');
    expect(JSON.parse(await readFile(join(t.path, 'local.json'), 'utf8')).plugins).toEqual({
      prefs: { theme: 'light' },
      off: { x: 1 },
    });
  });
});
