// UI-01: deleting a Board from the TUI when only a Plugin guard keeps it, as `boards delete --force` can.
import { describe, expect, it } from 'vitest';
import { definePlugin } from '../../src/plugin-api';
import { specs } from '../../src/plugins/specs';
import { createSpec } from '../../src/plugins/specs/specs';
import { createRepositories } from '../../src/storage';
import { makeBoard, makeStory, runCli } from '../helpers';
import { waitForFrame } from '../tui/helpers';
import { pluginRoot, withPlugins } from './helpers';
import { focusListItem, openPluginApp } from './tuiHelpers';

/** Keeps every Board, and does not let `--force` past it. */
const keeper = definePlugin({
  id: 'keeper',
  name: 'Keeper',
  description: '',
  hooks: { 'boards.remove': { guard: () => ({ reject: 'Keeper keeps every Board' }) } },
});

/** The force confirmation's button. */
const FORCE = 'Delete all (y)';

async function setup(on: Record<string, true> = {}) {
  const t = await pluginRoot({ specs: true, ...on });
  await makeBoard(t.path, { id: 'api', name: 'Api', keyPrefix: 'API' });
  const seeded = await withPlugins(t, [specs, keeper]);
  await createSpec(seeded.services.plugins.context('specs'), { board: 'api', slug: 'auth' }, '# Auth');
  const opened = await openPluginApp(t, [specs, keeper], { screen: 'boards', params: {} });
  await waitForFrame(opened.app, 'Api api · API');
  await focusListItem(opened.app, 'Api');
  return { t, ...opened, plugin: opened.services.plugins.context('specs') };
}

const boardIds = async (root: Parameters<typeof createRepositories>[0]) =>
  (await createRepositories(root).boards.list()).map((b) => b.id);

describe('Board deletion with Specs (UI-01)', () => {
  it('an empty Board with a Spec offers force; cancel keeps everything, confirm removes the Board and Spec', async () => {
    const { t, app, plugin } = await setup();
    await app.press('d', 'y');
    const frame = await waitForFrame(app, FORCE);
    expect(frame).toContain('Board "api" has Board Specs. Delete the Board with all its Stories and');
    await app.press('n');
    await waitForFrame(app, (f) => !f.includes(FORCE));
    expect(await boardIds(t.root)).toEqual(['api', 'web']);
    expect(await plugin.files.read({ board: 'api' }, 'auth.md')).toBe('# Auth');

    await app.press('d', 'y');
    await waitForFrame(app, FORCE);
    await app.press('y');
    await waitForFrame(app, 'Deleted Api');
    expect(await boardIds(t.root)).toEqual(['web']);
    app.unmount();
  });

  it('a Board with Stories and Specs asks once and force deletes both', async () => {
    const { t, app } = await setup();
    await makeStory(t.path, { boardId: 'api', key: 'API-1' });
    await app.press('d', 'y');
    expect(await waitForFrame(app, FORCE)).toContain('Api has 1 Stories. Delete the Board');
    await app.press('y');
    await waitForFrame(app, 'Deleted Api');
    expect(await boardIds(t.root)).toEqual(['web']);
    app.unmount();
  });

  it('a guard that force cannot pass never offers force, and force does not get past it', async () => {
    const { t, app } = await setup({ keeper: true });
    // Website has no Specs: only Keeper refuses, and it does not offer force.
    await focusListItem(app, 'Website');
    await app.press('d', 'y');
    await waitForFrame(app, 'Keeper keeps every Board');
    expect(app.lastFrame()).not.toContain(FORCE);
    // Api: Specs' refusal offers force; the forced deletion still stops at Keeper.
    await focusListItem(app, 'Api', 'k');
    await app.press('d', 'y');
    await waitForFrame(app, FORCE);
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Keeper keeps every Board') && !f.includes(FORCE));
    expect(await boardIds(t.root)).toEqual(['api', 'web']);
    app.unmount();
  });

  it('the CLI exits 4 without --force, with attribution and canForce, and deletes with it', async () => {
    const t = await pluginRoot({ specs: true });
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    await createSpec(
      (await withPlugins(t, [specs])).services.plugins.context('specs'),
      { board: 'api', slug: 'a' },
      '# A',
    );
    const refused = await runCli(['boards', 'delete', 'api', '--yes', '--json'], { root: t.path });
    expect(refused.exitCode).toBe(4);
    expect(JSON.parse(refused.stderr).error).toMatchObject({
      code: 'CONFLICT',
      details: { plugin: 'specs', operation: 'boards.remove', stage: 'guard', canForce: true },
    });
    expect((await runCli(['boards', 'delete', 'api', '--force', '--yes'], { root: t.path })).exitCode).toBe(0);
    expect(await boardIds(t.root)).toEqual(['web']);
  });
});
