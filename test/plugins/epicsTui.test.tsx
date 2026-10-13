import { describe, expect, it } from 'vitest';
import { reservedNames } from '../../src/main';
import { epics } from '../../src/plugins/epics';
import { createEpic } from '../../src/plugins/epics/service';
import type { LocalState } from '../../src/schemas';
import { createServices, loadPlugins, type RowblyContext } from '../../src/services';
import { App } from '../../src/tui/app';
import { createToastStore, pluginRoute } from '../../src/tui/hooks';
import { loadTuiPlugins } from '../../src/tui/loadPlugins';
import { fixedClock, fixedIds, makeBoard, makeStory, type TempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from '../tui/helpers';
import { pluginRoot, readJsonFile, withPlugins } from './helpers';

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

async function open(
  t: TempRoot,
  screen: string,
  params: Record<string, unknown> = {},
  local: LocalState = { version: 1, board: 'web' },
) {
  const toasts = createToastStore();
  const host = await loadPlugins({ root: t.root, registry: [epics], reserved: reservedNames() });
  const ctx: RowblyContext = {
    root: t.root,
    local,
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    plugins: host,
    warn: (message) => toasts.push('warning', message),
  };
  const services = createServices(ctx);
  const app = renderTui(
    <App
      ctx={ctx}
      services={services}
      initial={{ screen, params }}
      toasts={toasts}
      plugins={await loadTuiPlugins(host)}
    />,
  );
  return { app, services, toasts };
}

describe('Epics TUI', () => {
  it('opens Epics from home and shows cross-Board Stories and Epic Progress', async () => {
    const t = await seed();
    await makeBoard(t.path, {
      id: 'api',
      name: 'API',
      keyPrefix: 'API',
      stages: [{ key: 'released', name: 'Released', category: 'done' }],
    });
    await makeStory(t.path, { key: 'API-1', boardId: 'api', stage: 'released', plugins: { epics: { epic: 'auth' } } });
    const { app } = await open(t, 'home', {}, { version: 1 });
    await waitForFrame(app, 'Epics');
    await app.press(...Array(9).fill('j'), KEYS.enter);
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
    await app.press('New', ...Array(7).fill(KEYS.tab), KEYS.right, KEYS.ctrlS);
    await waitForFrame(app, 'Created WEB-3');
    expect(await readJsonFile(t, 'boards/web/stories/WEB-3/story.json')).toHaveProperty('plugins.epics.epic', 'auth');
    expect(await waitForFrame(app, /Epic\s+auth/)).toContain('WEB-3');
    await app.press('e');
    await waitForFrame(app, '‹ auth ›');
    await app.press(...Array(7).fill(KEYS.tab), KEYS.left, KEYS.ctrlS);
    await waitForFrame(app, 'Updated WEB-3');
    expect(await readJsonFile(t, 'boards/web/stories/WEB-3/story.json')).not.toHaveProperty('plugins');
    await waitForFrame(app, /Epic\s+none/);
    app.unmount();
  });

  it.each([
    { screen: 'stories', tabs: 9 },
    { screen: 'board', tabs: 5 },
  ])('filters $screen by Epic and by no Epic, and clears the filter', async ({ screen, tabs }) => {
    const t = await seed();
    const { app } = await open(t, screen, { boardId: 'web' });
    await waitForFrame(app, 'WEB-2');
    await app.press('/', ...Array(tabs).fill(KEYS.tab), KEYS.right, KEYS.right, KEYS.right, KEYS.ctrlS);
    const linked = await waitForFrame(
      app,
      (frame) => frame.includes('Epic: auth') && frame.includes('WEB-1') && !frame.includes('WEB-2'),
    );
    expect(linked).toContain('Login');
    await app.press('/', ...Array(tabs).fill(KEYS.tab), KEYS.left, KEYS.ctrlS);
    await waitForFrame(
      app,
      (frame) => frame.includes('no Epic') && frame.includes('WEB-2') && !frame.includes('WEB-1'),
    );
    await app.press('/', ...Array(tabs).fill(KEYS.tab), KEYS.left, KEYS.ctrlS);
    await waitForFrame(app, (frame) => frame.includes('WEB-1') && frame.includes('WEB-2'));
    app.unmount();
  });
});
