import { describe, expect, it } from 'vitest';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import type { RouteParams } from '../../src/tui/router';
import { fixedClock, fixedIds, makeBoard, type TempRoot, tempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from './helpers';

const web = { boardId: 'web' };

async function setup() {
  const t = await tempRoot();
  await makeBoard(t.path, {
    ...web,
    id: 'web',
    keyPrefix: 'WEB',
    customFields: [{ key: 'size', name: 'Size', type: 'select', options: ['s', 'm', 'l'], required: false }],
  });
  return t;
}

/** The real App over a temp Data Root, opened on `screen`. */
async function open(t: TempRoot, screen: string, params: RouteParams = {}, me: string | null = null) {
  const toasts = createToastStore();
  const ctx: RowblyContext = {
    root: t.root,
    local: { version: 1 },
    me,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => toasts.push('warning', message),
  };
  const app = renderTui(<App ctx={ctx} services={createServices(ctx)} initial={{ screen, params }} toasts={toasts} />);
  await waitForFrame(app, (frame) => !frame.includes('Loading'));
  return app;
}

const story = (t: TempRoot, key: string) => createRepositories(t.root).stories.findByKey(key);

describe('story form', () => {
  it('creates a Story with a select Custom Field from the list screen', async () => {
    const t = await setup();
    const app = await open(t, 'stories');
    expect(app.lastFrame()).toContain('No Stories yet. Press n to create one.');
    await app.press('n');
    await waitForFrame(app, (f) => f.includes('New Story on web'));
    expect(app.lastFrame()).toContain('‹ backlog ›');
    // name, description, stage, priority, labels, due, size
    await app.press(...'Login page', KEYS.down, KEYS.down, KEYS.right, KEYS.down);
    await app.press(KEYS.right, KEYS.right, KEYS.down, ...'ui,auth', KEYS.down, KEYS.down, KEYS.right);
    expect(app.lastFrame()).toContain('‹ s ›');
    await app.press(KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('WEB-1 Login page') && f.includes('Details'));

    expect(await story(t, 'WEB-1')).toMatchObject({
      name: 'Login page',
      stage: 'todo',
      priority: 'P1',
      labels: ['ui', 'auth'],
      customFields: { size: 's' },
    });
    expect(app.lastFrame()).toMatch(/Size +s/);
    app.unmount();
  });
});
