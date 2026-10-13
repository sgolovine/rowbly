import { describe, expect, it } from 'vitest';
import { createServices, type RowblyContext } from '../../src/services';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { screens } from '../../src/tui/screens';
import { fixedClock, fixedIds, makeBoard, tempRoot } from '../helpers';
import { KEYS, renderApp, renderTui, waitForFrame } from './helpers';

async function open() {
  const tmp = await tempRoot();
  await makeBoard(tmp.path, { id: 'web', keyPrefix: 'WEB' });
  const ctx: RowblyContext = {
    root: tmp.root,
    local: { version: 1, board: 'web' },
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: () => {},
  };
  const app = renderTui(
    <App
      ctx={ctx}
      services={createServices(ctx)}
      initial={{ screen: 'board', params: {} }}
      screens={screens}
      toasts={createToastStore()}
    />,
  );
  await waitForFrame(app, '● Backlog (0)');
  return app;
}

describe('settings', () => {
  it('opens with , and groups the global sections apart from the Board in context', async () => {
    const app = await open();
    await app.press(',');
    // The first section is the global Boards.
    let frame = await waitForFrame(app, 'web web · WEB (current)');
    expect(frame).toContain('Board › Settings');
    expect(frame).toMatch(/Global[\s\S]*Doctor[\s\S]*Board: web[\s\S]*Config[\s\S]*Stages[\s\S]*Fields/);
    for (const section of ['Assignees', 'Context']) expect(frame).toContain(section);
    expect(frame).toContain('enter/tab focus section');

    // Up from the first section wraps to the Board's Fields, then its Stages.
    await app.press('k', 'k');
    frame = await waitForFrame(app, 'Level:');
    expect(frame).toContain('board');
    await app.press('j', 'j');
    await waitForFrame(app, 'web web · WEB (current)');
    await app.press('j');
    await waitForFrame(app, 'No Assignees yet');
    // The sidebar has focus, so the section's own keys do nothing yet.
    await app.press('n');
    expect(app.lastFrame()).not.toContain('New Assignee');
    app.unmount();
  });

  it('keeps the global Stages to the global level', async () => {
    const app = await open();
    await app.press(',');
    await waitForFrame(app, 'Board: web');
    await app.press('j', 'j');
    const frame = await waitForFrame(app, 'Level:');
    expect(frame).not.toMatch(/Level:.*board/);
    app.unmount();
  });

  it('tab focuses the section, whose keys and hints then apply', async () => {
    const app = await open();
    await app.press(',');
    await waitForFrame(app, 'Board: web');
    await app.press('j');
    await waitForFrame(app, 'No Assignees yet');
    await app.press(KEYS.tab);
    await waitForFrame(app, 'n add assignee · tab sections');
    await app.press('n');
    await waitForFrame(app, 'Settings › New Assignee');
    await app.press(KEYS.escape);
    await waitForFrame(app, 'No Assignees yet');
    await app.press(KEYS.tab, 'j');
    await waitForFrame(app, 'Level:');
    app.unmount();
  });

  it('closes on esc', async () => {
    const app = await open();
    await app.press(',');
    await waitForFrame(app, 'Settings');
    await app.press(KEYS.escape);
    await waitForFrame(app, (f) => !f.includes('Settings'));
    app.unmount();
  });

  it('does nothing without a Data Root', async () => {
    const app = renderApp({ a: () => null });
    await app.press(',');
    expect(app.lastFrame()).not.toContain('Settings');
    expect(app.lastFrame()).not.toContain(', settings');
    app.unmount();
  });
});
