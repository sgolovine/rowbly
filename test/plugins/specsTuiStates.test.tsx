// The Specs screens' load, failure and empty states (CQ-118), stale links in the Story form
// (CQ-166), the Board chooser (CQ-117) and route titles (ARCH-25).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { specs } from '../../src/plugins/specs';
import { createSpec } from '../../src/plugins/specs/specs';
import type { LocalState } from '../../src/schemas';
import { acquireLock } from '../../src/storage';
import { io } from '../../src/storage/io';
import { deferred, makeBoard, makeStory } from '../helpers';
import { KEYS, tick, waitForFrame } from '../tui/helpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';
import { focusFormField, focusListItem, openPluginApp } from './tuiHelpers';

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup(
  screen: string,
  params: Record<string, unknown> = {},
  local: LocalState = { version: 1 },
  beforeOpen: () => void = () => {},
) {
  const t = await pluginRoot({ specs: true });
  await makeBoard(t.path, { id: 'api', name: 'Api', keyPrefix: 'API' });
  const seeded = await withPlugins(t, [specs]);
  await createSpec(seeded.services.plugins.context('specs'), { board: 'web', slug: 'auth' }, '# Auth\n\nRequirements');
  await makeStory(t.path, {
    boardId: 'web',
    key: 'WEB-1',
    name: 'Login',
    plugins: { specs: { specs: ['gone', 'auth'] }, other: { keep: true } },
  });
  beforeOpen();
  const opened = await openPluginApp(t, [specs], { screen, params }, { local });
  return { t, ...opened, plugin: opened.services.plugins.context('specs') };
}

/** Makes every Markdown read fail as an unreadable file would. */
function failMarkdownReads() {
  const read = io.readFile;
  vi.spyOn(io, 'readFile').mockImplementation(async (path) => {
    if (path.endsWith('.md'))
      throw Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: 'EACCES' });
    return read(path);
  });
}

describe('Specs failure and empty states (CQ-118)', () => {
  it('a failed Story tab load shows a failure, not create instructions, and offers no shortcuts', async () => {
    const { app } = await setup('story', { key: 'WEB-1' });
    await waitForFrame(app, 'Login');
    failMarkdownReads();
    await app.press(KEYS.tab);
    const frame = await waitForFrame(app, 'Could not load Specs.');
    expect(frame).not.toContain('No Story Spec');
    expect(frame).not.toContain('create Story Spec');
    await app.press('e');
    await tick(100);
    expect(app.lastFrame()).not.toContain('Title');
    app.unmount();
  });

  it('a successfully loaded absent Story Spec still offers create', async () => {
    const { app } = await setup('story', { key: 'WEB-1' });
    await waitForFrame(app, 'Login');
    await app.press(KEYS.tab);
    await waitForFrame(app, 'No Story Spec. Press e to create one.');
    await app.press('e');
    await waitForFrame(app, 'Title');
    app.unmount();
  });

  it('a failed detail view cannot open edit or delete', async () => {
    const { app } = await setup('plugin', { plugin: 'specs', screen: 'detail', board: 'web', slug: 'auth' });
    await waitForFrame(app, 'Requirements');
    app.unmount();
    const failed = await setup('plugin', { plugin: 'specs', screen: 'detail', board: 'web', slug: 'missing' });
    await waitForFrame(failed.app, 'Could not load Spec.');
    await failed.app.press('e');
    await failed.app.press('d');
    await tick(100);
    expect(failed.app.lastFrame()).not.toContain('enter new line');
    expect(failed.app.lastFrame()).not.toContain('Delete Spec');
    failed.app.unmount();
  });

  it('malformed screen params show a failure instead of a broken screen', async () => {
    const { app } = await setup('plugin', {
      plugin: 'specs',
      screen: 'detail',
      board: 'web',
      story: 'WEB-1',
      slug: 'auth',
    });
    await waitForFrame(app, 'Could not load Spec.');
    const form = await setup('plugin', { plugin: 'specs', screen: 'form', board: 'web', create: false });
    await waitForFrame(form.app, 'Could not load Spec.');
    app.unmount();
    form.app.unmount();
  });

  it('a failed Board Spec list shows a failure; an empty one shows the genuine empty text', async () => {
    const { app } = await setup('plugin', { plugin: 'specs', screen: 'list', board: 'web' });
    await waitForFrame(app, 'auth  Auth');
    app.unmount();
    const failed = await setup(
      'plugin',
      { plugin: 'specs', screen: 'list', board: 'web' },
      undefined,
      failMarkdownReads,
    );
    const frame = await waitForFrame(failed.app, 'Could not load Specs.');
    expect(frame).not.toContain('No Board Specs');
    failed.app.unmount();
    vi.restoreAllMocks();
    const empty = await setup('plugin', { plugin: 'specs', screen: 'list', board: 'api' });
    await waitForFrame(empty.app, 'No Board Specs. Press n to create one.');
    empty.app.unmount();
  });

  it('the Board section shows a failure instead of "none"', async () => {
    const { app } = await setup('board-detail', { boardId: 'web' }, undefined, failMarkdownReads);
    const frame = await waitForFrame(app, 'Could not load Specs.');
    expect(frame).not.toMatch(/Board Specs: none/);
    app.unmount();
  });
});

describe('Specs in the Story form (CQ-166, CQ-123)', () => {
  it('a link to a missing Board Spec is shown and can be removed; opening the form stores nothing', async () => {
    const { t, app } = await setup('story-form', { key: 'WEB-1' });
    await waitForFrame(app, (f) => f.includes('[x] gone') && f.includes('[x] auth'));
    const before = await readJsonFile(t, storyFile('WEB-1'));
    await app.press(KEYS.escape);
    await tick(100);
    expect(await readJsonFile(t, storyFile('WEB-1'))).toEqual(before);
    app.unmount();

    const edit = await setup('story-form', { key: 'WEB-1' });
    await waitForFrame(edit.app, '[x] gone');
    await focusFormField(edit.app, 'Specs');
    // The choices are auth, then gone: move to gone and clear it.
    await edit.app.press('l', ' ', KEYS.ctrlS);
    await waitForFrame(edit.app, 'Updated WEB-1');
    expect((await edit.services.stories.get('WEB-1')).plugins).toEqual({
      specs: { specs: ['auth'] },
      other: { keep: true },
    });
    edit.app.unmount();
  });

  it('new-Story and filter choices list only existing Board Specs; an empty new Story has no Specs bag', async () => {
    const { app, services } = await setup('story-form', { boardId: 'web' });
    const frame = await waitForFrame(app, '[ ] auth');
    expect(frame).not.toContain('gone');
    await app.press(...'New', KEYS.ctrlS);
    await waitForFrame(app, 'Created WEB-2');
    expect((await services.stories.get('WEB-2')).plugins).toBeUndefined();
    app.unmount();
    const list = await setup('stories', { boardId: 'web' });
    await waitForFrame(list.app, 'WEB-1');
    await list.app.press('/');
    expect(await waitForFrame(list.app, '[ ] auth')).not.toContain('gone');
    list.app.unmount();
  });

  it('resetting an invalid bag in the form replaces it with no links and keeps other bags', async () => {
    const { t, app, services } = await setup('story-form', { key: 'WEB-1' });
    await makeStory(t.path, {
      boardId: 'web',
      key: 'WEB-2',
      rank: 'a1',
      plugins: { specs: { specs: 'auth' }, other: { keep: true } },
    });
    app.unmount();
    const edit = await openPluginApp(t, [specs], { screen: 'story-form', params: { key: 'WEB-2' } });
    await waitForFrame(edit.app, 'stored value is invalid');
    await focusFormField(edit.app, 'Specs');
    await edit.app.press(' ');
    await waitForFrame(edit.app, 'reset');
    await edit.app.press(KEYS.ctrlS);
    await waitForFrame(edit.app, 'Updated WEB-2');
    expect((await services.stories.get('WEB-2')).plugins).toEqual({ other: { keep: true } });
    edit.app.unmount();
  });
});

describe('Specs Board chooser (CQ-117) and titles (ARCH-25)', () => {
  it('the context Board is selected; b keeps the chooser; another Board stays chosen', async () => {
    const { app } = await setup('plugin', { plugin: 'specs', screen: 'list' }, { version: 1, board: 'web' });
    await waitForFrame(app, 'Board Specs — web');
    await app.press('b');
    await waitForFrame(app, 'Choose a Board for Specs');
    await tick(150);
    expect(app.lastFrame()).toContain('Choose a Board for Specs');
    await focusListItem(app, 'Api');
    await app.press(KEYS.enter);
    await waitForFrame(app, 'Board Specs — api');
    await tick(150);
    expect(app.lastFrame()).toContain('Board Specs — api');
    app.unmount();
  });

  it('without a context Board it shows the chooser', async () => {
    const { app } = await setup('plugin', { plugin: 'specs', screen: 'list' });
    await waitForFrame(app, 'Choose a Board for Specs');
    app.unmount();
  });

  it('routes are titled by document and action', async () => {
    const { app } = await setup('plugin', { plugin: 'specs', screen: 'list', board: 'web', title: 'Specs' });
    await waitForFrame(app, 'auth  Auth');
    await app.press('n');
    await waitForFrame(app, (f) => f.includes('Specs › New Spec') && f.includes('Slug'));
    await app.press(KEYS.escape);
    await waitForFrame(app, 'auth  Auth');
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Specs › auth─') && f.includes('Requirements'));
    await app.press('e');
    // The edit form names the action, and does not take the detail's title.
    await waitForFrame(app, 'auth › Edit auth');
    app.unmount();
  });

  it('the Spec list keeps its keys while it reloads on return, also behind another lock holder', async () => {
    const { t, app } = await setup('plugin', { plugin: 'specs', screen: 'list', board: 'web', title: 'Specs' });
    await waitForFrame(app, 'auth  Auth');
    await app.press('n');
    await waitForFrame(app, (f) => f.includes('Specs › New Spec') && f.includes('Slug'));
    // Another holder keeps the Data Root busy, so the list's reload on return waits in the lock queue.
    const lock = await acquireLock(t.path, { operation: 'test.hold' });
    const realpath = io.realpath;
    const reloading = deferred();
    const reload = vi.spyOn(io, 'realpath').mockImplementation((path) => {
      reloading.resolve();
      return realpath(path);
    });
    try {
      await app.press(KEYS.escape);
      await reloading.promise;
      await app.press(KEYS.enter);
    } finally {
      reload.mockRestore();
      await lock.release();
    }
    await waitForFrame(app, (f) => f.includes('Specs › auth─') && f.includes('Requirements'));
    app.unmount();
  });

  it('the Story Spec tab keeps its keys while it reloads on return, also behind another lock holder', async () => {
    const { t, app, plugin } = await setup('story', { key: 'WEB-1' });
    await createSpec(plugin, { board: 'web', story: 'WEB-1' }, '# Own\n\nStory text');
    await waitForFrame(app, 'Login');
    await app.press(KEYS.tab, KEYS.tab);
    await waitForFrame(app, (f) => f.includes('Story text') && f.includes('delete Story Spec'));
    await app.press('e');
    await waitForFrame(app, 'enter new line');
    // Another holder keeps the Data Root busy, so the tab's reload on return waits in the lock queue.
    const lock = await acquireLock(t.path, { operation: 'test.hold' });
    const realpath = io.realpath;
    const reloading = deferred();
    const reload = vi.spyOn(io, 'realpath').mockImplementation((path) => {
      reloading.resolve();
      return realpath(path);
    });
    try {
      await app.press(KEYS.escape);
      await reloading.promise;
      await app.press('d');
      await waitForFrame(app, 'Delete Story Spec?');
    } finally {
      reload.mockRestore();
      await lock.release();
    }
    await app.press('n');
    await waitForFrame(app, (f) => f.includes('Story text') && f.includes('delete Story Spec'));
    app.unmount();
  });
});
