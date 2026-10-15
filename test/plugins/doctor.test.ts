import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { definePlugin } from '../../src/plugin-api';
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
