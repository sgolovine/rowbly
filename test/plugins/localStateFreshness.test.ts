// ARCH-37: context changes (use, clearUse, setMe, deleting the selected Board) start from the latest
// stored Local State, not the context's copy, so a Plugin's Local State bag survives them, also when
// another service instance wrote it. The runner copies the saved Local State into the context before
// reactions run, and changes Me only when the stored Me changed.
import { describe, expect, it } from 'vitest';
import { definePlugin, z } from '../../src/plugin-api';
import { createRepositories } from '../../src/storage';
import { makeBoard } from '../helpers';
import { pluginRoot, withPlugins } from './helpers';

const View = z.object({ view: z.string() });

/** Keeps a view preference in its Local State bag, and records what reactions see. */
function prefs() {
  const seen: { board?: string; me: string | null }[] = [];
  const plugin = definePlugin({
    id: 'prefs',
    name: 'Prefs',
    description: '',
    bags: { local: View },
    hooks: {
      'context.use': {
        async transform({ changes, plugin }) {
          await changes.updateLocalState((s) => plugin.writeBag(s, { view: 'set-by-use' }));
        },
        async react({ plugin }) {
          seen.push({ board: await plugin.services.context.resolveBoard(), me: plugin.me });
        },
      },
    },
  });
  return { plugin, seen };
}

async function setup(overrides = {}) {
  const t = await pluginRoot({ prefs: true });
  await makeBoard(t.path, { id: 'api', name: 'API', keyPrefix: 'API' });
  const { plugin, seen } = prefs();
  const loaded = await withPlugins(t, [plugin], overrides);
  const remember = (services = loaded.services, view = 'compact') =>
    services.plugins
      .context('prefs')
      .operation('remember', { view }, (changes) =>
        changes.updateLocalState((s) => services.plugins.context('prefs').writeBag(s, { view })),
      );
  const stored = () => createRepositories(t.root).localState.get();
  return { t, ...loaded, seen, remember, stored };
}

describe('a Plugin Local State bag', () => {
  it('survives clearUse and setMe after the Plugin wrote it', async () => {
    const { services, remember, stored } = await setup();
    await remember();
    await services.context.clearUse();
    expect((await stored()).plugins).toEqual({ prefs: { view: 'compact' } });
    await services.context.setMe('bob');
    expect(await stored()).toMatchObject({ me: 'bob', plugins: { prefs: { view: 'compact' } } });
  });

  it('survives deleting the selected Board', async () => {
    const { services, remember, stored, ctx } = await setup();
    await services.context.use('api');
    await remember();
    await services.boards.remove('api', { force: true });
    const local = await stored();
    expect(local.board).toBeUndefined();
    expect(local.plugins?.prefs).toEqual({ view: 'compact' });
    expect(ctx.local).toEqual(local);
  });

  it('survives a context change made by another service instance with an older context', async () => {
    const first = await setup();
    const second = await withPlugins(first.t, [prefs().plugin]);
    await first.remember();
    await second.services.context.setMe('alice');
    expect(await first.stored()).toMatchObject({ me: 'alice', plugins: { prefs: { view: 'compact' } } });
  });

  it('a transform that sets it during use persists, and the context and reactions see the final Local State', async () => {
    const { services, ctx, seen, stored } = await setup();
    const result = await services.context.use('api');
    expect(result.plugins).toEqual({ prefs: { view: 'set-by-use' } });
    expect(await stored()).toEqual(result);
    expect(ctx.local).toEqual(result);
    expect(seen).toEqual([{ board: 'api', me: null }]);
  });

  it('a Plugin operation that changes it updates the context', async () => {
    const { ctx, remember } = await setup();
    await remember();
    expect(ctx.local.plugins).toEqual({ prefs: { view: 'compact' } });
  });
});

describe('Me', () => {
  it('inferred from the git email survives unrelated Local State changes', async () => {
    const { services, ctx, remember } = await setup({ me: 'alice' });
    await services.context.use('api');
    await remember();
    await services.context.clearUse();
    expect(ctx.me).toBe('alice');
  });

  it('follows the stored Me when it is set or cleared', async () => {
    const { services, ctx } = await setup({ me: 'alice' });
    await services.context.setMe('bob');
    expect(ctx.me).toBe('bob');
    await services.context.setMe(null);
    expect(ctx.me).toBeNull();
  });

  it('nothing changes in the context when the operation fails', async () => {
    const { services, ctx } = await setup({ me: 'alice' });
    const before = structuredClone(ctx.local);
    await expect(services.context.use('missing')).rejects.toThrow();
    expect(ctx.local).toEqual(before);
    expect(ctx.me).toBe('alice');
  });
});
