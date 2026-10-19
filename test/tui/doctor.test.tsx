import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServices, type RowblyContext } from '../../src/services';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { screens } from '../../src/tui/screens';
import { fixedClock, fixedIds, makeBoard, makeStory, tempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from './helpers';

async function setup(initial = 'doctor') {
  const tmp = await tempRoot();
  await makeBoard(tmp.path, { id: 'web', keyPrefix: 'WEB' });
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

describe('doctor screen', () => {
  it('says "No problems found" for a healthy Data Root', async () => {
    const { render } = await setup();
    const app = render();
    await waitForFrame(app, 'No problems found');
    app.unmount();
  });

  it('lists findings and fixes them with f', async () => {
    const { tmp, render } = await setup();
    await makeStory(tmp.path, { key: 'WEB-1', boardId: 'web', customFields: { size: 's' } });
    await makeStory(tmp.path, { key: 'WEB-2', boardId: 'web', rank: 'a1', stage: 'gone' });
    const app = render();
    await waitForFrame(app, '1 error, 1 warning, 0 info · 1 fixable, press f');
    const frame = await waitForFrame(app, 'f fix');
    expect(frame).toContain('error   UNKNOWN_STAGE');
    expect(frame).toContain('warning UNKNOWN_FIELD');

    await app.press('f');
    const fixed = await waitForFrame(app, 'Fixed (1)');
    expect(fixed).toContain('stripped unknown Custom Field "size" from WEB-1');
    expect(fixed).toContain('1 error, 0 warnings, 0 info');
    expect(fixed).not.toContain('press f');
    app.unmount();
  });

  it('checks again with r and is reachable from the settings', async () => {
    const { tmp, render } = await setup('home');
    const app = render();
    // Home opens the board once it has loaded; wait so that does not close the settings.
    await waitForFrame(app, '● Backlog (0)');
    await app.press(',');
    await waitForFrame(app, 'Board: ');
    // Doctor is the fifth global section.
    await app.press(...Array(4).fill('j'), KEYS.enter);
    await waitForFrame(app, 'No problems found');

    await makeStory(tmp.path, { key: 'WEB-1', boardId: 'web', stage: 'gone' });
    await app.press('r');
    await waitForFrame(app, 'UNKNOWN_STAGE');
    expect(await readdir(join(tmp.path, 'boards/web/stories'))).toEqual(['WEB-1']);
    app.unmount();
  });
});
