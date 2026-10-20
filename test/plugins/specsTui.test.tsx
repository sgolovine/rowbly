import { describe, expect, it } from 'vitest';
import { specs } from '../../src/plugins/specs';
import { createSpec } from '../../src/plugins/specs/specs';
import type { LocalState } from '../../src/schemas';
import { makeBoard } from '../helpers';
import { KEYS, resize, waitForFrame } from '../tui/helpers';
import { pluginRoot, withPlugins } from './helpers';
import { focusFormField, openPluginApp } from './tuiHelpers';

async function setup(
  screen: string,
  params: Record<string, unknown> = {},
  local: LocalState = { version: 1, board: 'web' },
) {
  const t = await pluginRoot({ specs: true });
  if (screen === 'home') await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
  const seeded = await withPlugins(t, [specs]);
  await createSpec(
    seeded.services.plugins.context('specs'),
    { board: 'web', slug: 'auth' },
    '# Auth\n\nBoard requirements',
  );
  await seeded.services.stories.create('web', { name: 'Login', plugins: { specs: { specs: ['auth'] } } });
  await seeded.services.stories.create('web', { name: 'Other' });
  const { app, services } = await openPluginApp(t, [specs], { screen, params }, { local });
  return { app, services, plugin: services.plugins.context('specs') };
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

  it('the Board Specs screen creates Specs, opens them rendered, edits, saves and deletes them', async () => {
    const { app, plugin } = await setup('plugin', { plugin: 'specs', screen: 'list', board: 'web' });
    await waitForFrame(app, 'auth  Auth');
    await app.press('n');
    await waitForFrame(app, 'Slug');
    await app.press(...'api', KEYS.tab, ...'API', KEYS.tab, ...'Some **Body**', KEYS.ctrlS);
    await waitForFrame(app, (f) => f.includes('api  API') && f.includes('open Spec'));
    expect(await plugin.files.read({ board: 'web' }, 'api.md')).toBe('# API\n\nSome **Body**');
    // `api` is the first Board Spec, so `enter` opens it, rendered.
    await app.press(KEYS.enter);
    const view = await waitForFrame(app, (f) => f.includes('Some Body') && f.includes('tab/e edit'));
    expect(view).toContain('Board Spec api');
    expect(view).not.toContain('**');
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Some **Body**') && f.includes('tab view'));
    await app.press('!', KEYS.ctrlS);
    await waitForFrame(app, (f) => f.includes('saved') && !f.includes('unsaved'));
    expect(await plugin.files.read({ board: 'web' }, 'api.md')).toBe('# API\n\nSome **Body**!');
    await app.press(KEYS.escape);
    await waitForFrame(app, (f) => f.includes('api  API') && f.includes('delete Spec') && !f.includes('tab view'));
    await app.press('d');
    await waitForFrame(app, 'Delete Spec "api"?');
    await app.press('n');
    await waitForFrame(app, (f) => f.includes('api  API') && f.includes('delete Spec'));
    expect(await plugin.files.read({ board: 'web' }, 'api.md')).not.toBeNull();
    await app.press('d', 'y');
    await waitForFrame(app, (f) => f.includes('auth  Auth') && !f.includes('api  API'));
    expect(await plugin.files.read({ board: 'web' }, 'api.md')).toBeNull();
    app.unmount();
  });

  it('the Story Specs tab lists Story Specs, then linked Board Specs, and creates, opens and deletes them', async () => {
    const { app, plugin } = await setup('story', { key: 'WEB-1' });
    await waitForFrame(app, 'Login');
    await app.press(KEYS.tab);
    const empty = await waitForFrame(app, (f) => f.includes('auth  Auth') && f.includes('new Story Spec'));
    expect(empty).toContain('Board Spec');
    await app.press('n');
    await waitForFrame(app, 'Title');
    await app.press(...'design', KEYS.tab, ...'Design', KEYS.tab, ...'Text', KEYS.ctrlS);
    const frame = await waitForFrame(
      app,
      (f) => /design {2}Design Story Spec[\s\S]*auth {2}Auth Board Spec/.test(f) && f.includes('delete Story Spec'),
    );
    expect(frame.indexOf('design  Design')).toBeLessThan(frame.indexOf('auth  Auth'));
    expect(await plugin.files.read({ story: 'WEB-1' }, 'design.md')).toBe('# Design\n\nText');
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Story Spec WEB-1/design') && f.includes('Text'));
    await app.press(KEYS.escape);
    await waitForFrame(app, (f) => f.includes('delete Story Spec') && !f.includes('tab/e edit'));
    // A linked Board Spec opens too, and is not deleted from here.
    await app.press('j');
    await waitForFrame(app, (f) => f.includes('edit Spec') && !f.includes('delete Story Spec'));
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Board Spec auth') && f.includes('Board requirements'));
    await app.press(KEYS.escape);
    await waitForFrame(app, (f) => f.includes('edit Spec') && !f.includes('tab/e edit'));
    await app.press('k');
    await waitForFrame(app, 'delete Story Spec');
    await app.press('d');
    await waitForFrame(app, 'Delete Story Spec "design"?');
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('auth  Auth') && !f.includes('design  Design'));
    expect(await plugin.files.read({ story: 'WEB-1' }, 'design.md')).toBeNull();
    app.unmount();
  });

  it('a Story Spec edited in the editor asks before discarding unsaved changes', async () => {
    const { app, plugin } = await setup('story', { key: 'WEB-1' });
    await createSpec(plugin, { board: 'web', story: 'WEB-1', slug: 'spec' }, '# Own\n\nStory text');
    await waitForFrame(app, 'Login');
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('spec  Own') && f.includes('delete Story Spec'));
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Story text') && f.includes('tab view'));
    await app.press('!', KEYS.escape);
    await waitForFrame(app, 'Close and discard unsaved changes?');
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('spec  Own') && !f.includes('tab view'));
    expect(await plugin.files.read({ story: 'WEB-1' }, 'spec.md')).toBe('# Own\n\nStory text');
    app.unmount();
  });

  it('a long Spec scrolls in the editor', async () => {
    const { app, plugin } = await setup('story', { key: 'WEB-1' });
    Object.defineProperty(app.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(app.stdout, 'columns', { value: 100, configurable: true });
    Object.defineProperty(app.stdout, 'rows', { value: 24, configurable: true });
    app.stdout.emit('resize');
    await createSpec(
      plugin,
      { board: 'web', story: 'WEB-1', slug: 'spec' },
      `# Long\n\n${Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n\n')}`,
    );
    await waitForFrame(app, 'Login');
    await app.press(KEYS.tab);
    await waitForFrame(app, 'spec  Long');
    await app.press(KEYS.enter);
    const initial = await waitForFrame(app, (f) => f.includes('Line 0') && f.includes('↑/↓ scroll'));
    expect(initial).not.toContain('Line 29');
    await app.press(...Array(80).fill('j'));
    await waitForFrame(app, 'Line 29');
    app.unmount();
  });

  it('the Story form multi-choice links and unlinks Board Specs', async () => {
    const { app, services } = await setup('story-form', { boardId: 'web' });
    await waitForFrame(app, 'Specs');
    await app.press(...'New');
    await focusFormField(app, 'Specs');
    await app.press(' ', KEYS.ctrlS);
    await waitForFrame(app, 'Created WEB-3');
    expect((await services.stories.get('WEB-3')).plugins).toEqual({ specs: { specs: ['auth'] } });
    // The Story screen ignores `e` until it has loaded WEB-3.
    await waitForFrame(app, 'WEB-3 New');
    await app.press('e');
    await waitForFrame(app, '[x] auth');
    await focusFormField(app, 'Specs');
    await app.press(' ', KEYS.ctrlS);
    await waitForFrame(app, 'Updated WEB-3');
    expect((await services.stories.get('WEB-3')).plugins).toBeUndefined();
    app.unmount();
  });

  it.each(['stories', 'board'])('the %s Spec filter limits Stories', async (screen) => {
    const { app } = await setup(screen, { boardId: 'web' });
    // Wide enough for the header to show the whole filter beside its buttons.
    resize(app, 120, 40);
    await waitForFrame(app, 'WEB-2');
    await app.press('/');
    await waitForFrame(app, '[ ] auth');
    await focusFormField(app, 'Spec');
    await app.press(' ', KEYS.ctrlS);
    const frame = await waitForFrame(app, (f) => f.includes('Spec: auth') && !f.includes('WEB-2'));
    expect(frame).toContain('WEB-1');
    app.unmount();
  });
});
