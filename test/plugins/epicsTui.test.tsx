import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { epics } from '../../src/plugins/epics';
import { createEpic } from '../../src/plugins/epics/service';
import type { LocalState } from '../../src/schemas';
import { pluginRoute } from '../../src/tui/hooks';
import { makeBoard, makeStory, type TempRoot } from '../helpers';
import { KEYS, waitForFrame } from '../tui/helpers';
import { pluginRoot, readJsonFile, withPlugins } from './helpers';
import { focusFormField, focusListItem, openPluginApp } from './tuiHelpers';

async function seed() {
  const t = await pluginRoot({ epics: true });
  const { services } = await withPlugins(t, [epics]);
  await createEpic(services.plugins.context('epics'), {
    id: 'auth',
    name: 'Authentication',
    description: 'Login flow',
  });
  await makeStory(t.path, { key: 'WEB-1', boardId: 'web', name: 'Login', plugins: { epics: { epic: 'auth' } } });
  await makeStory(t.path, { key: 'WEB-2', boardId: 'web', name: 'Other', rank: 'a1' });
  return t;
}

function open(
  t: TempRoot,
  screen: string,
  params: Record<string, unknown> = {},
  local: LocalState = { version: 1, board: 'web' },
) {
  return openPluginApp(t, [epics], { screen, params }, { local });
}

describe('Epics TUI', () => {
  it('opens Epics from home and shows cross-Board Stories and Epic Progress', async () => {
    const t = await seed();
    await makeBoard(t.path, {
      id: 'api',
      name: 'API',
      keyPrefix: 'API',
      stages: [],
    });
    await makeStory(t.path, { key: 'API-1', boardId: 'api', stage: 'done', plugins: { epics: { epic: 'auth' } } });
    const { app } = await open(t, 'home', {}, { version: 1 });
    await waitForFrame(app, 'Epics');
    await focusListItem(app, 'Epics');
    await app.press(KEYS.enter);
    await waitForFrame(app, 'Epics (open)');
    await waitForFrame(app, '1/2 Stories done (50%)');
    await app.press(KEYS.enter);
    const frame = await waitForFrame(app, '1/2 Stories done (50%)');
    expect(frame).toContain('Board: API (api)');
    expect(frame).toContain('Board: Website (web)');
    expect(frame).toContain('WEB-1');
    expect(frame).toContain('API-1');
    app.unmount();
  });

  it('creates and edits Epics, closes/reopens them, and confirms deletion with unlinking', async () => {
    const t = await seed();
    const route = pluginRoute('epics', 'list');
    const { app, services, toasts } = await open(t, route.screen, route.params);
    await waitForFrame(app, 'Authentication');
    await app.press('n');
    await waitForFrame(app, 'Description');
    await app.press('billing', KEYS.tab, 'Billing', KEYS.tab, 'Payments', KEYS.ctrlS);
    await waitForFrame(app, 'Created Epic billing');
    await waitForFrame(app, 'billing · Billing');
    await app.press(KEYS.enter);
    await waitForFrame(app, 'Epic Progress');
    await app.press('e');
    await waitForFrame(app, 'Description');
    await app.press(KEYS.end, ' updated', KEYS.ctrlS);
    await waitForFrame(app, 'Updated Epic auth');
    await waitForFrame(app, 'Authentication updated');
    expect(await readJsonFile(t, 'plugins/epics/auth.json')).toMatchObject({
      name: 'Authentication updated',
      description: 'Login flow',
    });
    await app.press('c');
    await waitForFrame(app, /Closed\s+yes/);
    await app.press('c');
    await waitForFrame(app, /Closed\s+no/);
    await app.press('d');
    await waitForFrame(app, '1 Stories will be unlinked');
    await app.press('n');
    expect(await readJsonFile(t, 'boards/web/stories/WEB-1/story.json')).toHaveProperty('plugins.epics.epic', 'auth');
    await app.press('d', 'y');
    await waitForFrame(app, 'Deleted Epic auth');
    await waitForFrame(app, (frame) => frame.includes('billing · Billing') && !frame.includes('auth ·'));
    expect((await services.stories.get('WEB-1')).plugins).toBeUndefined();
    expect(toasts.list().map((toast) => toast.message)).toContain('Unlinked 1 Stories from Epic "auth"');
    app.unmount();
  });

  it('shows open, closed and all Epics in the list', async () => {
    const t = await seed();
    const route = pluginRoute('epics', 'list');
    const { app, services } = await open(t, route.screen, route.params);
    await waitForFrame(app, 'Authentication');
    await app.press(KEYS.enter);
    await waitForFrame(app, /Closed\s+no/);
    await app.press('c');
    await waitForFrame(app, /Closed\s+yes/);
    await app.press(KEYS.escape);
    await waitForFrame(app, 'No Epics.');
    await app.press('a');
    await waitForFrame(app, 'Epics (closed)');
    await waitForFrame(app, 'Authentication');
    await app.press('a');
    await waitForFrame(app, 'Epics (all)');
    expect(await services.plugins.get('epics')).toMatchObject({ loaded: true });
    app.unmount();
  });

  it('Story form selects and clears an Epic, and the Story screen shows its row', async () => {
    const t = await seed();
    const { app } = await open(t, 'story-form', { boardId: 'web' });
    await waitForFrame(app, 'No Epic');
    await app.press('New');
    await focusFormField(app, 'Epic');
    await app.press(KEYS.right, KEYS.ctrlS);
    await waitForFrame(app, 'Created WEB-3');
    expect(await readJsonFile(t, 'boards/web/stories/WEB-3/story.json')).toHaveProperty('plugins.epics.epic', 'auth');
    expect(await waitForFrame(app, /Epic\s+auth/)).toContain('WEB-3');
    await app.press('e');
    await waitForFrame(app, '‹ auth ›');
    await focusFormField(app, 'Epic');
    await app.press(KEYS.left, KEYS.ctrlS);
    await waitForFrame(app, 'Updated WEB-3');
    expect(await readJsonFile(t, 'boards/web/stories/WEB-3/story.json')).not.toHaveProperty('plugins');
    await waitForFrame(app, /Epic\s+none/);
    app.unmount();
  });

  it.each(['stories', 'board'])('filters %s by Epic and by no Epic, and clears the filter', async (screen) => {
    const t = await seed();
    const { app } = await open(t, screen, { boardId: 'web' });
    await waitForFrame(app, 'WEB-2');
    const filterByEpic = async (...keys: string[]) => {
      await app.press('/');
      await focusFormField(app, 'Epic');
      await app.press(...keys, KEYS.ctrlS);
    };
    await filterByEpic(KEYS.right, KEYS.right, KEYS.right);
    const linked = await waitForFrame(
      app,
      (frame) => frame.includes('Epic: auth') && frame.includes('WEB-1') && !frame.includes('WEB-2'),
    );
    expect(linked).toContain('Login');
    await filterByEpic(KEYS.left);
    await waitForFrame(
      app,
      (frame) => frame.includes('no Epic') && frame.includes('WEB-2') && !frame.includes('WEB-1'),
    );
    await filterByEpic(KEYS.left);
    await waitForFrame(app, (frame) => frame.includes('WEB-1') && frame.includes('WEB-2'));
    app.unmount();
  });

  it('opens an Epic Story in core Story detail, and back returns to the Epic (ARCH-07)', async () => {
    const t = await seed();
    await makeStory(t.path, {
      key: 'WEB-3',
      boardId: 'web',
      name: 'Logout',
      rank: 'a2',
      plugins: { epics: { epic: 'auth' } },
    });
    const route = pluginRoute('epics', 'detail');
    const { app } = await open(t, route.screen, { ...route.params, id: 'auth', title: 'auth' });
    await waitForFrame(app, 'Epic Progress');
    await focusListItem(app, 'WEB-3 · Logout');
    await app.press(KEYS.enter);
    const story = await waitForFrame(app, 'auth › WEB-3');
    expect(story).toMatch(/Epic\s+auth/);
    expect(story).toContain('Logout');
    await app.press(KEYS.escape);
    const back = await waitForFrame(app, (frame) => !frame.includes('auth › WEB-3'));
    expect(back).toContain('Epic Progress');
    expect(back).toContain('WEB-1 · Login');
    app.unmount();
  });

  it('lists a corrupt Epic as unavailable next to the healthy ones (RES-12)', async () => {
    const t = await seed();
    await writeFile(join(t.path, 'plugins/epics/bad.json'), '<<<<<<< HEAD\n{}\n=======\n>>>>>>> other\n');
    const route = pluginRoute('epics', 'list');
    const { app, toasts } = await open(t, route.screen, route.params);
    const frame = await waitForFrame(app, 'bad · unavailable');
    expect(frame).toContain('auth · Authentication');
    expect(frame).toContain('0/1 Stories done');
    await focusListItem(app, 'bad · unavailable');
    await app.press(KEYS.enter);
    await waitForFrame(app, 'Epic "bad" is unavailable');
    expect(toasts.list().map((toast) => toast.kind)).toContain('warning');
    app.unmount();
  });

  it('creating a Story without choosing an Epic gives it no Epic data', async () => {
    const t = await seed();
    const { app } = await open(t, 'story-form', { boardId: 'web' });
    await waitForFrame(app, 'No Epic');
    await app.press('Plain', KEYS.ctrlS);
    await waitForFrame(app, 'Created WEB-3');
    expect(await readJsonFile(t, 'boards/web/stories/WEB-3/story.json')).not.toHaveProperty('plugins');
    app.unmount();
  });
});
