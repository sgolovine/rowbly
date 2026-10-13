import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { definePlugin } from '../../src/plugin-api';
import { specs } from '../../src/plugins/specs';
import { deleteSpec, getSpec, listSpecs, saveSpec, specTitle } from '../../src/plugins/specs/specs';
import { makeBoard, makeStory } from '../helpers';
import { pluginRoot, withPlugins } from './helpers';

async function setup() {
  const t = await pluginRoot({ specs: true });
  const loaded = await withPlugins(t, [specs]);
  return { t, ...loaded, plugin: loaded.services.plugins.context('specs') };
}

const target = { board: 'web', slug: 'auth' };

describe('Specs operations', () => {
  it('stores markdown at Board and Story scopes, extracts the first H1 and enforces one Story Spec', async () => {
    const { t, services, plugin } = await setup();
    const story = await services.stories.create('web', { name: 'Login' });
    expect(specTitle('intro\n## Subheading\n# First\n# Second')).toBe('First');
    await saveSpec(plugin, target, 'intro\n# Auth\n\nBody', true);
    await saveSpec(plugin, { board: 'web', story: story.key }, '# Login\n\nDetails', true);
    expect(await readFile(join(t.path, 'boards/web/plugins/specs/auth.md'), 'utf8')).toContain('# Auth');
    expect(await readFile(join(t.path, 'boards/web/stories/WEB-1/plugins/specs/spec.md'), 'utf8')).toContain('# Login');
    expect(await listSpecs(plugin, 'web')).toMatchObject([{ slug: 'auth', title: 'Auth' }]);
    await expect(saveSpec(plugin, { board: 'web', story: story.key }, '# Duplicate', true)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await saveSpec(plugin, target, '# Changed', false);
    expect((await getSpec(plugin, target)).title).toBe('Changed');
    await expect(saveSpec(plugin, { board: 'web', slug: '../escape' }, '# Bad', true)).rejects.toMatchObject({
      code: 'USAGE',
    });
    await expect(saveSpec(plugin, target, 'no heading', false)).rejects.toMatchObject({ code: 'USAGE' });
  });

  it('sets, adds, removes and filters same-Board links, preserving other Plugin Data', async () => {
    const { services, plugin, t } = await setup();
    await saveSpec(plugin, target, '# Auth', true);
    await saveSpec(plugin, { board: 'web', slug: 'api' }, '# API', true);
    const story = await services.stories.create('web', {
      name: 'Login',
      plugins: { specs: { specs: ['auth', 'auth'] } },
    });
    expect(story.plugins).toEqual({ specs: { specs: ['auth'] } });
    await makeStory(t.path, { key: 'WEB-2', boardId: 'web', plugins: { other: { keep: true } } });
    const added = await services.stories.update('web-2', { plugins: { specs: { addSpecs: ['api'] } } });
    expect(added.plugins).toEqual({ other: { keep: true }, specs: { specs: ['api'] } });
    expect((await services.stories.list('web', { plugins: { specs: ['auth', 'api'] } })).map((s) => s.key)).toEqual([
      'WEB-1',
      'WEB-2',
    ]);
    const removed = await services.stories.update('WEB-2', { plugins: { specs: { removeSpecs: ['api'] } } });
    expect(removed.plugins).toEqual({ other: { keep: true } });
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    await expect(
      services.stories.create('api', { name: 'Bad', plugins: { specs: { specs: ['auth'] } } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      services.stories.update('WEB-1', { name: 'Unsaved', plugins: { specs: { specs: ['missing'] } } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await services.stories.get('WEB-1')).name).toBe('Login');
  });

  it('deletes and unlinks in one operation, warning only after success', async () => {
    const { services, plugin, warnings } = await setup();
    await saveSpec(plugin, target, '# Auth', true);
    await saveSpec(plugin, { board: 'web', slug: 'api' }, '# API', true);
    await services.stories.create('web', { name: 'A', plugins: { specs: { specs: ['auth', 'api'] } } });
    await services.stories.create('web', { name: 'B', plugins: { specs: { specs: ['auth'] } } });
    expect(await deleteSpec(plugin, target)).toBe(2);
    expect((await services.stories.get('WEB-1')).plugins).toEqual({ specs: { specs: ['api'] } });
    expect((await services.stories.get('WEB-2')).plugins).toBeUndefined();
    expect(warnings).toEqual(['Unlinked Board Spec "auth" from 2 Stories']);
    await expect(getSpec(plugin, target)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('another Plugin can reject Specs operations before either files or Stories save', async () => {
    const t = await pluginRoot({ specs: true, veto: true });
    const veto = definePlugin({
      id: 'veto',
      name: 'Veto',
      description: '',
      hooks: { 'specs.delete': { guard: () => ({ reject: 'keep it' }) } },
    });
    const { services, warnings } = await withPlugins(t, [specs, veto]);
    const plugin = services.plugins.context('specs');
    await saveSpec(plugin, target, '# Auth', true);
    await services.stories.create('web', { name: 'A', plugins: { specs: { specs: ['auth'] } } });
    await expect(deleteSpec(plugin, target)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await getSpec(plugin, target)).title).toBe('Auth');
    expect((await services.stories.get('WEB-1')).plugins).toEqual({ specs: { specs: ['auth'] } });
    expect(warnings).toEqual([]);
  });

  it('guards a Board with Board Specs even without Stories; force removes its files', async () => {
    const { services, plugin } = await setup();
    await saveSpec(plugin, target, '# Auth', true);
    await expect(services.boards.remove('web', { force: false })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { plugin: 'specs' },
    });
    expect((await getSpec(plugin, target)).title).toBe('Auth');
    await services.boards.remove('web', { force: true });
    expect(await services.boards.list()).toEqual([]);
  });
});

describe('Specs doctor', () => {
  it('reports missing links and fixes all of them without removing valid links or other bags', async () => {
    const { t, services, plugin } = await setup();
    await saveSpec(plugin, target, '# Auth', true);
    await makeStory(t.path, {
      key: 'WEB-1',
      boardId: 'web',
      plugins: { specs: { specs: ['gone', 'auth', 'absent'] }, other: { keep: true } },
    });
    expect((await services.doctor.check()).findings.filter((f) => f.code === 'SPECS_MISSING_SPEC')).toMatchObject([
      { code: 'SPECS_MISSING_SPEC', severity: 'warning', fixable: true },
    ]);
    const fixed = await services.doctor.fix();
    expect(fixed.fixed).toMatchObject([{ code: 'SPECS_MISSING_SPEC' }]);
    expect(fixed.findings.map((f) => f.code)).toEqual(['PLUGIN_DATA_UNCHECKED']);
    expect((await services.stories.get('WEB-1')).plugins).toEqual({
      specs: { specs: ['auth'] },
      other: { keep: true },
    });
  });

  it('does not check Specs links while the Plugin is off', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { specs: { specs: ['gone'] } } });
    const { services } = await withPlugins(t, [specs]);
    const report = await services.doctor.fix();
    expect(report.findings.map((f) => f.code)).toEqual(['PLUGIN_DATA_UNCHECKED']);
    expect((await services.stories.get('WEB-1')).plugins).toEqual({ specs: { specs: ['gone'] } });
  });
});
