import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServices, type RowblyContext } from '../../src/services';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { screens } from '../../src/tui/screens';
import { fixedClock, fixedIds, makeBoard, makeStory, makeWorkspace, tempRoot } from '../helpers';
import { KEYS, type Rendered, renderTui } from './helpers';

async function setup(initial = 'doctor') {
  const tmp = await tempRoot();
  await makeWorkspace(tmp.path, { id: 'acme' });
  await makeBoard(tmp.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
  const ctx: RowblyContext = {
    root: tmp.root,
    local: { version: 1 },
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: () => {},
  };
  const render = () =>
    renderTui(
      <App
        ctx={ctx}
        services={createServices(ctx)}
        initial={{ screen: initial, params: {} }}
        screens={screens}
        toasts={createToastStore()}
      />,
    );
  return { tmp, render };
}

/** Polls until the latest frame contains `text`, instead of sleeping a fixed time. */
async function waitForFrame(app: Rendered, text: string, timeout = 3000): Promise<string> {
  const start = Date.now();
  for (;;) {
    const frame = app.lastFrame() ?? '';
    if (frame.includes(text)) return frame;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for "${text}" in:\n${frame}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('doctor screen', () => {
  it('says "No problems found" for a healthy Data Root', async () => {
    const { render } = await setup();
    const app = render();
    await waitForFrame(app, 'No problems found');
    app.unmount();
  });

  it('lists findings and fixes them with f', async () => {
    const { tmp, render } = await setup();
    await makeStory(tmp.path, { key: 'WEB-1', workspaceId: 'acme', boardId: 'web', assignees: ['bob'] });
    await makeStory(tmp.path, { key: 'WEB-2', workspaceId: 'acme', boardId: 'web', rank: 'a1', stage: 'gone' });
    const app = render();
    await waitForFrame(app, '1 error, 1 warning, 0 info · 1 fixable, press f');
    const frame = await waitForFrame(app, 'f fix');
    expect(frame).toContain('error   UNKNOWN_STAGE');
    expect(frame).toContain('warning UNKNOWN_ASSIGNEE');

    await app.press('f');
    const fixed = await waitForFrame(app, 'Fixed (1)');
    expect(fixed).toContain('removed bob from WEB-1');
    expect(fixed).toContain('1 error, 0 warnings, 0 info');
    expect(fixed).not.toContain('press f');
    app.unmount();
  });

  it('checks again with r and is reachable from the g palette', async () => {
    const { tmp, render } = await setup('home');
    const app = render();
    await app.press('g');
    await waitForFrame(app, 'Doctor');
    // The first enter ends filtering, the second opens the highlighted destination.
    await app.press('/', 'd', 'o', 'c', KEYS.enter, KEYS.enter);
    await waitForFrame(app, 'No problems found');

    await makeStory(tmp.path, { key: 'WEB-1', workspaceId: 'acme', boardId: 'web', stage: 'gone' });
    await app.press('r');
    await waitForFrame(app, 'UNKNOWN_STAGE');
    expect(await readdir(join(tmp.path, 'workspaces/acme/boards/web/stories'))).toEqual(['WEB-1.json']);
    app.unmount();
  });
});
