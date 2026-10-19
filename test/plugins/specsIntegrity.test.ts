import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AnyPluginDefinition, definePlugin } from '../../src/plugin-api';
import { specs } from '../../src/plugins/specs';
import {
  createSpec,
  deleteSpec,
  editSpec,
  listSpecSlugs,
  listSpecs,
  parseSpecFormParams,
  SpecsBag,
} from '../../src/plugins/specs/specs';
import { io } from '../../src/storage/io';
import { FIXED_NOW, fixedClock, makeBoard, makeStory } from '../helpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup(on: Record<string, true> = {}, registry: readonly AnyPluginDefinition[] = [specs]) {
  const t = await pluginRoot({ specs: true, ...on });
  const clock = fixedClock();
  const loaded = await withPlugins(t, registry, { now: clock.now });
  return { t, clock, ...loaded, plugin: loaded.services.plugins.context('specs') };
}

/** A Specs bag that does not match the schema, next to another Plugin's bag. */
const invalid = { specs: { specs: 'auth', extra: 1 }, other: { keep: true } };

describe('invalid Specs bags (ARCH-36, VER-02)', () => {
  it('additive and removal edits reject with attributed DATA_INTEGRITY and leave the raw bag', async () => {
    const { t, services, plugin } = await setup();
    await createSpec(plugin, { board: 'web', slug: 'auth' }, '# Auth');
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: invalid });
    for (const input of [{ addSpecs: ['auth'] }, { removeSpecs: ['auth'] }, { specs: ['auth'] }]) {
      await expect(
        services.stories.update('WEB-1', { name: 'Changed', plugins: { specs: input } }),
      ).rejects.toMatchObject({
        code: 'DATA_INTEGRITY',
        details: { plugin: 'specs', path: 'plugins.specs' },
      });
    }
    const raw = await readJsonFile(t, storyFile('WEB-1'));
    expect(raw.plugins).toEqual(invalid);
    expect(raw.name).not.toBe('Changed');
  });

  it('an explicit reset replaces an invalid bag and keeps other Plugins’ data', async () => {
    const { t, services, plugin } = await setup();
    await createSpec(plugin, { board: 'web', slug: 'auth' }, '# Auth');
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: invalid });
    await services.stories.update('WEB-1', { plugins: { specs: { specs: ['auth'], reset: true } } });
    expect((await services.stories.get('WEB-1')).plugins).toEqual({
      other: { keep: true },
      specs: { specs: ['auth'] },
    });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', plugins: invalid });
    await services.stories.update('WEB-2', { plugins: { specs: { reset: true } } });
    expect((await services.stories.get('WEB-2')).plugins).toEqual({ other: { keep: true } });
    await expect(
      services.stories.update('WEB-2', { plugins: { specs: { addSpecs: ['auth'], reset: true } } }),
    ).rejects.toMatchObject({ code: 'USAGE' });
  });

  it('absent bags still accept additions', async () => {
    const { t, services, plugin } = await setup();
    await createSpec(plugin, { board: 'web', slug: 'auth' }, '# Auth');
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { other: { keep: true } } });
    await services.stories.update('WEB-1', { plugins: { specs: { addSpecs: ['auth'] } } });
    expect((await services.stories.get('WEB-1')).plugins).toEqual({
      other: { keep: true },
      specs: { specs: ['auth'] },
    });
  });

  it('deleting a Board Spec rejects when a Story on the Board has an invalid bag, and saves nothing', async () => {
    const { t, plugin, warnings } = await setup();
    await createSpec(plugin, { board: 'web', slug: 'auth' }, '# Auth');
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: invalid });
    await expect(deleteSpec(plugin, { board: 'web', slug: 'auth' })).rejects.toMatchObject({
      code: 'DATA_INTEGRITY',
      details: { plugin: 'specs' },
    });
    expect(await plugin.files.read({ board: 'web' }, 'auth.md')).toBe('# Auth');
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual(invalid);
    expect(warnings).toEqual([]);
  });

  it('a Spec filter treats an invalid bag as unknown: it matches no slug', async () => {
    const { t, services } = await setup();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: invalid });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', plugins: { specs: { specs: ['auth'] } } });
    const keys = (await services.stories.list('web', { plugins: { specs: ['auth'] } })).map((s) => s.key);
    expect(keys).toEqual(['WEB-2']);
  });

  it('malformed input is a VALIDATION error with issues, and mixed set/add is USAGE, with no write', async () => {
    const { t, services } = await setup();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    await expect(
      services.stories.update('WEB-1', { name: 'X', plugins: { specs: { addSpecs: ['../bad'] } } }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { plugin: 'specs', issues: expect.any(Array) } });
    await expect(
      services.stories.update('WEB-1', { name: 'X', plugins: { specs: { specs: ['a'], addSpecs: ['b'] } } }),
    ).rejects.toMatchObject({ code: 'USAGE', details: { plugin: 'specs' } });
    expect((await services.stories.get('WEB-1')).name).not.toBe('X');
  });
});

describe('Spec targets (CQ-103)', () => {
  it('form params: a new Spec names its Board, and its Story for a Story Spec, but not its slug yet', () => {
    expect(parseSpecFormParams({ board: 'web', title: 'New Spec' })).toEqual({ board: 'web' });
    expect(parseSpecFormParams({ board: 'web', story: 'WEB-1' })).toEqual({ board: 'web', story: 'WEB-1' });
    for (const params of [{}, { board: 1 }, { board: 'web', slug: 'auth' }, { board: 'web', story: '' }]) {
      expect(() => parseSpecFormParams(params)).toThrow(expect.objectContaining({ code: 'USAGE' }));
    }
  });

  it('create rejects an existing Spec, edit an absent one; the result is the saved Spec', async () => {
    const { plugin } = await setup();
    const target = { board: 'web', slug: 'auth' } as const;
    await expect(editSpec(plugin, target, '# Auth')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await createSpec(plugin, target, '# Auth')).toEqual({ slug: 'auth', title: 'Auth', text: '# Auth' });
    await expect(createSpec(plugin, target, '# Again')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await plugin.files.read({ board: 'web' }, 'auth.md')).toBe('# Auth');
  });

  it('the caller and reactions get the Spec as saved (ARCH-42)', async () => {
    const seen: unknown[] = [];
    const watch = definePlugin({
      id: 'watch',
      name: 'Watch',
      description: '',
      hooks: { 'specs.create': { react: ({ result }) => void seen.push(result) } },
    });
    const { plugin } = await setup({ watch: true }, [specs, watch]);
    const saved = await createSpec(plugin, { board: 'web', slug: 'auth' }, '# Auth\n\nBody');
    expect(saved).toEqual({ slug: 'auth', title: 'Auth', text: '# Auth\n\nBody' });
    expect(seen).toEqual([saved]);
    expect(await createSpec(plugin, { board: 'web', story: 'WEB-9', slug: 'spec' }, '# X').catch((e) => e.code)).toBe(
      'NOT_FOUND',
    );
  });
});

describe('Specs timestamps (CQ-19, DX-38)', () => {
  it('unlinking a Board Spec stamps only the Stories it changes, with the operation clock', async () => {
    const { t, clock, plugin, services } = await setup();
    await createSpec(plugin, { board: 'web', slug: 'auth' }, '# Auth');
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { specs: { specs: ['auth'] } } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', rank: 'a1', plugins: { specs: { specs: ['api'] } } });
    const before = (await services.stories.get('WEB-2')).updatedAt;
    clock.advance(60_000);
    expect(await deleteSpec(plugin, { board: 'web', slug: 'auth' })).toBe(1);
    expect((await services.stories.get('WEB-1')).updatedAt).toBe(clock.now().toISOString());
    expect((await services.stories.get('WEB-2')).updatedAt).toBe(before);
  });

  it('doctor repairs stamp only the repaired Stories', async () => {
    const { t, clock, services } = await setup();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { specs: { specs: ['gone'] } } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', rank: 'a1' });
    const untouched = (await services.stories.get('WEB-2')).updatedAt;
    clock.advance(60_000);
    await services.doctor.fix();
    const repaired = await services.stories.get('WEB-1');
    expect(repaired.plugins).toBeUndefined();
    expect(repaired.updatedAt).toBe(clock.now().toISOString());
    expect(repaired.updatedAt).not.toBe(FIXED_NOW);
    expect((await services.stories.get('WEB-2')).updatedAt).toBe(untouched);
  });
});

describe('Specs reads (PERF-02, PERF-08, PERF-09)', () => {
  const markdownReads = () => {
    const read = vi.spyOn(io, 'readFile');
    return () => read.mock.calls.filter(([path]) => String(path).endsWith('.md')).length;
  };

  it('doctor reads each linked document once per Board, however many Stories link to it', async () => {
    const { t, plugin, services } = await setup();
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    await createSpec(plugin, { board: 'web', slug: 'auth' }, '# Auth');
    await createSpec(plugin, { board: 'web', slug: 'ui' }, '# UI');
    // Same slug on another Board, where it is missing: the cache must not say it exists.
    await makeStory(t.path, { boardId: 'api', key: 'API-1', plugins: { specs: { specs: ['auth'] } } });
    for (let i = 1; i <= 40; i++) {
      await makeStory(t.path, { boardId: 'web', key: `WEB-${i}`, plugins: { specs: { specs: ['auth', 'ui'] } } });
    }
    const reads = markdownReads();
    const findings = (await services.doctor.check()).findings.filter((f) => f.code === 'SPECS_MISSING_SPEC');
    expect(findings.map((f) => f.message)).toEqual(['API-1 links to missing Board Specs: auth']);
    // web/auth, web/ui and the missing api/auth: one read each, not one per link.
    expect(reads()).toBe(3);
  });

  it('slug-only controls list Spec names without reading documents', async () => {
    const { t, plugin } = await setup();
    await createSpec(plugin, { board: 'web', slug: 'auth' }, '# Auth');
    await createSpec(plugin, { board: 'web', slug: 'api' }, '# API');
    await plugin.operation('extra', {}, async (changes) => {
      await changes.writeFile({ board: 'web' }, 'notes.txt', 'x');
      await changes.writeFile({ board: 'web' }, 'nested/deep.md', '# Deep');
      await changes.writeFile({ board: 'web' }, 'Bad_Name.md', '# Bad');
    });
    const reads = markdownReads();
    expect(await listSpecSlugs(plugin, 'web')).toEqual(['api', 'auth']);
    expect(reads()).toBe(0);
    expect((await listSpecs(plugin, 'web')).map((s) => s.slug)).toEqual(['api', 'auth']);
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    expect(await listSpecSlugs(plugin, 'api')).toEqual([]);
  });

  it('a multi-slug filter parses each Story’s bag once', async () => {
    const { t, services } = await setup();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { specs: { specs: ['c'] } } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', plugins: { specs: { specs: ['z'] } } });
    const parse = vi.spyOn(SpecsBag, 'safeParse');
    const keys = (await services.stories.list('web', { plugins: { specs: ['a', 'b', 'c'] } })).map((s) => s.key);
    expect(keys).toEqual(['WEB-1']);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('the Board deletion guard is forceable and reads no documents (UI-01)', async () => {
    const { plugin, services } = await setup();
    await createSpec(plugin, { board: 'web', slug: 'auth' }, '# Auth');
    const reads = markdownReads();
    await expect(services.boards.remove('web', { force: false })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { plugin: 'specs', stage: 'guard', canForce: true },
    });
    expect(reads()).toBe(0);
  });
});
