import { Text } from 'ink';
import { describe, expect, it } from 'vitest';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import type { ScreenProps } from '../../src/tui/screens';
import { epicsScreens } from '../../src/tui/screens/epics';
import { fixedClock, fixedIds, makeBoard, makeEpic, makeStory, makeWorkspace, tempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from './helpers';

/** Stands in for the story detail screen (WP05). */
function FakeStory({ params }: ScreenProps) {
  return <Text>Story detail {String(params.key)}</Text>;
}

async function setup() {
  const tmp = await tempRoot();
  await makeWorkspace(tmp.path, { id: 'acme' });
  await makeBoard(tmp.path, {
    id: 'web',
    workspaceId: 'acme',
    keyPrefix: 'WEB',
    stages: [
      { key: 'open', name: 'Open', category: 'todo' },
      { key: 'shipped', name: 'Shipped', category: 'done' },
    ],
  });
  await makeBoard(tmp.path, { id: 'api', workspaceId: 'acme', keyPrefix: 'API' });
  await makeEpic(tmp.path, { id: 'launch', workspaceId: 'acme', name: 'Launch' });
  await makeEpic(tmp.path, { id: 'old', workspaceId: 'acme', name: 'Old work', closed: true });
  const story = (key: string, boardId: string, stage: string) =>
    makeStory(tmp.path, { key, workspaceId: 'acme', boardId, stage, epicId: 'launch', name: `Do ${key}` });
  await story('WEB-1', 'web', 'shipped');
  await story('WEB-2', 'web', 'open');
  await story('API-1', 'api', 'done');

  const toasts = createToastStore();
  const ctx: RowblyContext = {
    root: tmp.root,
    local: { version: 1 },
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => toasts.push('warning', message),
  };
  const app = renderTui(
    <App
      ctx={ctx}
      services={createServices(ctx)}
      initial={{ screen: 'epics', params: {} }}
      screens={{ ...epicsScreens, story: FakeStory }}
      toasts={toasts}
    />,
  );
  await waitForFrame(app, 'Launch');
  return { app, repos: createRepositories(tmp.root), path: tmp.path };
}

/** Opens the Launch Epic's detail screen. */
async function openLaunch(app: Awaited<ReturnType<typeof setup>>['app']) {
  await app.press(KEYS.enter);
  await waitForFrame(app, 'Launch (launch)');
}

describe('epics screens', () => {
  it('lists open epics with progress bars and shows closed ones on a', async () => {
    const { app } = await setup();
    expect(app.lastFrame()).toContain('Launch ███████░░░ 2/3 · launch');
    expect(app.lastFrame()).not.toContain('Old work');
    await app.press('a');
    await waitForFrame(app, 'Old work ░░░░░░░░░░ 0/0 · old · closed');
    app.unmount();
  });

  it('shows the epic detail and opens a story from it', async () => {
    const { app } = await setup();
    await openLaunch(app);
    const frame = app.lastFrame() ?? '';
    expect(frame).toMatch(/Progress\s+███████░░░ 2\/3/);
    expect(frame).toContain('API-1  Do API-1 api · ● Done');
    expect(frame).toContain('WEB-1  Do WEB-1 web · ● Shipped');
    expect(frame).toContain('WEB-2  Do WEB-2 web · ● Open');

    await app.press('j', KEYS.enter);
    expect(app.lastFrame()).toContain('Story detail WEB-1');
    expect(app.lastFrame()).toContain('Epics › Launch › WEB-1');
    app.unmount();
  });

  it('creates an epic through the form', async () => {
    const { app, repos } = await setup();
    await app.press('n');
    await waitForFrame(app, 'Id*');
    await app.press(...'beta', KEYS.down, ...'Beta', KEYS.enter);
    await waitForFrame(app, 'Beta (beta)');
    expect(await repos.epics.get('acme', 'beta')).toMatchObject({ name: 'Beta', description: '', closed: false });
    expect(app.lastFrame()).toContain('Created Epic beta');
    app.unmount();
  });

  it('shows a validation error inline for a bad id', async () => {
    const { app } = await setup();
    await app.press('n');
    await waitForFrame(app, 'Id*');
    await app.press(...'Bad Id', KEYS.down, ...'x', KEYS.enter);
    await waitForFrame(app, /Id\*\s+Bad Id\n\s+must be a lower-kebab-case slug/);
    expect(app.lastFrame()).toContain('New Epic');
    app.unmount();
  });

  it('edits, closes and reopens an epic from the detail screen', async () => {
    const { app, repos } = await setup();
    await openLaunch(app);
    expect(app.lastFrame()).toMatch(/Closed\s+no/);
    await app.press('e');
    await waitForFrame(app, 'Edit Epic launch');
    await app.press(KEYS.backspace, KEYS.backspace, KEYS.backspace, KEYS.backspace, KEYS.backspace, KEYS.backspace);
    await app.press(...'Go live', KEYS.enter);
    await waitForFrame(app, 'Go live (launch)');
    expect((await repos.epics.get('acme', 'launch')).name).toBe('Go live');

    await app.press('c');
    await waitForFrame(app, /Closed\s+yes/);
    expect((await repos.epics.get('acme', 'launch')).closed).toBe(true);
    await app.press('c');
    await waitForFrame(app, /Closed\s+no/);
    expect((await repos.epics.get('acme', 'launch')).closed).toBe(false);
    expect(app.lastFrame()).not.toMatch(/status/i);
    app.unmount();
  });

  it('deletes an epic after confirming and warns with the unlinked count', async () => {
    const { app, repos } = await setup();
    await openLaunch(app);
    await app.press('d');
    expect(app.lastFrame()).toContain('Delete Epic "launch"? Its 3 Stories will be unlinked.');
    await app.press('y');
    await waitForFrame(app, 'No open Epics.');
    expect(app.lastFrame()).toContain('warning: unlinked 3 Stories from Epic "launch"');
    expect((await repos.stories.findByKey('WEB-1')).epicId).toBeNull();
    app.unmount();
  });
});
