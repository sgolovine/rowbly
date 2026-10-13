import { describe, expect, it } from 'vitest';
import { specs } from '../../src/plugins/specs';
import { saveSpec } from '../../src/plugins/specs/specs';
import type { LocalState } from '../../src/schemas';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { loadTuiPlugins } from '../../src/tui/loadPlugins';
import { makeBoard } from '../helpers';
import { KEYS, renderTui, waitForFrame } from '../tui/helpers';
import { pluginRoot, withPlugins } from './helpers';

async function setup(
  screen: string,
  params: Record<string, unknown> = {},
  local: LocalState = { version: 1, board: 'web' },
) {
  const t = await pluginRoot({ specs: true });
  if (screen === 'home') await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
  const { services, ctx, host } = await withPlugins(t, [specs], { local });
  const plugin = services.plugins.context('specs');
  await saveSpec(plugin, { board: 'web', slug: 'auth' }, '# Auth\n\nBoard requirements', true);
  await services.stories.create('web', { name: 'Login', plugins: { specs: { specs: ['auth'] } } });
  await services.stories.create('web', { name: 'Other' });
  const app = renderTui(
    <App
      ctx={ctx}
      services={services}
      plugins={await loadTuiPlugins(host)}
      initial={{ screen, params }}
      toasts={createToastStore()}
    />,
  );
  return { app, services, plugin };
}

describe('Specs TUI', () => {
  it('home menu and Board detail show Specs', async () => {
    const home = await setup('home', {}, { version: 1 });
    await waitForFrame(home.app, 'Specs');
    home.app.unmount();
    const detail = await setup('board-detail', { boardId: 'web' });
    expect(await waitForFrame(detail.app, 'auth  Auth')).toContain('Board Specs');
    detail.app.unmount();
  });

  it('the Specs screens create, edit and delete Board Specs in the multi-line text box', async () => {
    const { app, plugin } = await setup('plugin', { plugin: 'specs', screen: 'list', board: 'web' });
    await waitForFrame(app, 'auth  Auth');
    await app.press('n');
    await waitForFrame(app, 'Slug');
    await app.press('a', 'p', 'i', KEYS.tab, 'A', 'P', 'I', KEYS.tab, 'B', 'o', 'd', 'y', KEYS.ctrlS);
    await waitForFrame(app, 'api  API');
    expect(await plugin.files.read({ board: 'web' }, 'api.md')).toBe('# API\n\nBody');
    await app.press(KEYS.enter);
    await waitForFrame(app, 'Body');
    await app.press('e');
    await waitForFrame(app, 'enter new line');
    await app.press(KEYS.ctrlS);
    await waitForFrame(app, (f) => f.includes('Edited Spec') && !f.includes('enter new line'));
    await app.press('d');
    await waitForFrame(app, 'Delete Spec?');
    await app.press('n');
    expect(await plugin.files.read({ board: 'web' }, 'api.md')).not.toBeNull();
    await app.press('d', 'y');
    await waitForFrame(app, (f) => f.includes('auth  Auth') && !f.includes('api  API'));
    expect(await plugin.files.read({ board: 'web' }, 'api.md')).toBeNull();
    app.unmount();
  });

  it('the Story Spec tab shows own text then linked Board Specs and offers create/edit/delete', async () => {
    const { app, plugin } = await setup('story', { key: 'WEB-1' });
    await waitForFrame(app, 'Login');
    await app.press(KEYS.tab, KEYS.tab);
    expect(await waitForFrame(app, 'Board requirements')).toContain('No Story Spec');
    await app.press('e');
    await waitForFrame(app, 'Title');
    await app.press('O', 'w', 'n', KEYS.tab, 'T', 'e', 'x', 't', KEYS.ctrlS);
    const frame = await waitForFrame(
      app,
      (f) => /Story Spec[\s\S]*Own[\s\S]*Text[\s\S]*Board Spec: auth/.test(f) && !f.includes('enter new line'),
    );
    expect(frame.indexOf('Own')).toBeLessThan(frame.indexOf('Board Spec: auth'));
    await app.press('e');
    await waitForFrame(app, 'enter new line');
    await app.press(KEYS.ctrlS);
    await waitForFrame(
      app,
      (f) =>
        f.includes('Edited Spec') &&
        !f.includes('enter new line') &&
        /Story Spec[\s\S]*Own[\s\S]*Text[\s\S]*Board Spec: auth/.test(f),
    );
    await app.press('d');
    await waitForFrame(app, 'Delete Story Spec?');
    await app.press('y');
    await waitForFrame(app, 'No Story Spec');
    expect(await plugin.files.read({ story: 'WEB-1' }, 'spec.md')).toBeNull();
    app.unmount();
  });

  it('long Story Specs scroll to their linked Board Specs', async () => {
    const { app, plugin } = await setup('story', { key: 'WEB-1' });
    Object.defineProperty(app.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(app.stdout, 'columns', { value: 100, configurable: true });
    Object.defineProperty(app.stdout, 'rows', { value: 24, configurable: true });
    app.stdout.emit('resize');
    await saveSpec(
      plugin,
      { board: 'web', story: 'WEB-1' },
      `# Long\n${Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n')}`,
      true,
    );
    await waitForFrame(app, 'Login');
    await app.press(KEYS.tab, KEYS.tab);
    const initial = await waitForFrame(app, 'Line 0');
    expect(initial).not.toContain('Board requirements');
    await app.press(...Array(40).fill('j'));
    await waitForFrame(app, 'Board requirements');
    await app.press('d');
    await waitForFrame(app, 'Delete Story Spec?');
    await app.press('n');
    await waitForFrame(app, 'Line 0');
    app.unmount();
  });

  it('the Story form multi-choice links Board Specs', async () => {
    const { app, services } = await setup('story-form', { boardId: 'web' });
    await waitForFrame(app, 'Specs');
    await app.press('N', 'e', 'w', ...Array(7).fill(KEYS.tab), ' ', KEYS.ctrlS);
    await waitForFrame(app, 'Created WEB-3');
    expect((await services.stories.get('WEB-3')).plugins).toEqual({ specs: { specs: ['auth'] } });
    app.unmount();
  });

  for (const screen of ['stories', 'board']) {
    it(`the ${screen} Spec filter limits Stories`, async () => {
      const { app } = await setup(screen, { boardId: 'web' });
      await waitForFrame(app, 'WEB-2');
      await app.press('/');
      await waitForFrame(app, '[ ] auth');
      await app.press(...Array(screen === 'board' ? 5 : 9).fill(KEYS.tab), ' ', KEYS.ctrlS);
      const frame = await waitForFrame(app, (f) => f.includes('Spec: auth') && !f.includes('WEB-2'));
      expect(frame).toContain('WEB-1');
      app.unmount();
    });
  }
});
