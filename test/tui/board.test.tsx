import type { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../src/core/errors';
import type { StageConfig } from '../../src/schemas';
import { createServices, type RowblyContext, type Services } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { fixedClock, fixedIds, makeBoard, makeStory, type TempRoot, tempRoot } from '../helpers';
import { KEYS, type Rendered, renderTui, resize, waitForFrame } from './helpers';

const web = { boardId: 'web' };

/** With the fixed Backlog and Done: four Stages. */
const FOUR_STAGES: StageConfig[] = [
  { key: 'todo', name: 'Todo' },
  { key: 'doing', name: 'Doing' },
];

/** A Board with the given Stages and 6 Stories. */
async function seed(stages: StageConfig[] = FOUR_STAGES) {
  const t = await tempRoot();
  await makeBoard(t.path, { id: 'web', name: 'Website', keyPrefix: 'WEB', stages });
  await makeBoard(t.path, { id: 'api', name: 'API', keyPrefix: 'API' });
  await makeStory(t.path, {
    ...web,
    key: 'WEB-1',
    name: 'Login page with a rather long name that must be truncated',
    stage: 'backlog',
    rank: 'a0',
    priority: 'P1',
    labels: ['ui'],
  });
  await makeStory(t.path, { ...web, key: 'WEB-2', name: 'Signup form', stage: 'backlog', rank: 'a1' });
  await makeStory(t.path, { ...web, key: 'WEB-3', name: 'Password reset', stage: 'backlog', rank: 'a2' });
  await makeStory(t.path, {
    ...web,
    key: 'WEB-4',
    name: 'Dark mode',
    stage: 'todo',
    rank: 'a0',
    priority: 'P3',
  });
  await makeStory(t.path, { ...web, key: 'WEB-5', name: 'Fix footer', stage: 'doing', rank: 'a0', priority: 'P0' });
  await makeStory(t.path, { ...web, key: 'WEB-6', name: 'Release v1', stage: 'done', rank: 'a0', labels: ['ui'] });
  return t;
}

function contextFor(t: TempRoot, toasts = createToastStore(), local: RowblyContext['local'] = { version: 1 }) {
  const ctx: RowblyContext = {
    root: t.root,
    local,
    me: 'alice',
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => toasts.push('warning', message),
  };
  return { ctx, toasts };
}

/** The real App over the temp Data Root, sized `columns`×`rows`, opened on `screen`. */
async function open(
  t: TempRoot,
  opts: {
    screen?: string;
    columns?: number;
    rows?: number;
    patch?: (services: Services) => Services;
    local?: RowblyContext['local'];
    mouse?: EventEmitter;
  } = {},
) {
  const local = opts.local ?? { version: 1, board: 'web' };
  const { ctx, toasts } = contextFor(t, createToastStore(), local);
  const services = (opts.patch ?? ((s) => s))(createServices(ctx));
  const app = renderTui(
    <App
      ctx={ctx}
      services={services}
      initial={{ screen: opts.screen ?? 'board', params: {} }}
      toasts={toasts}
      mouse={opts.mouse}
    />,
  );
  resize(app, opts.columns ?? 120, opts.rows ?? 40);
  await waitForFrame(app, (frame) => frame.includes('WEB-') && !frame.includes('Loading'));
  return app;
}

const story = (t: TempRoot, key: string) => createRepositories(t.root).stories.findByKey(key);

/** The lines of the frame between the board title and the footer. */
const frameLines = (app: Rendered) => (app.lastFrame() ?? '').split('\n');

describe('board view', () => {
  it('moves a card to the next Stage with shift+→, at the bottom, and on disk', async () => {
    const t = await seed();
    // The move is on disk before the service call returns; the barrier holds the call open in that window.
    // Each held call, in order; the test releases one once it has arrived.
    const held: (() => void)[] = [];
    const app = await open(t, {
      patch: (services) => ({
        ...services,
        stories: {
          ...services.stories,
          move: async (...args: Parameters<Services['stories']['move']>) => {
            const saved = await services.stories.move(...args);
            await new Promise<void>((resolve) => held.push(resolve));
            return saved;
          },
        },
      }),
    });
    try {
      await app.press(KEYS.right, KEYS.shiftRight);
      await vi.waitFor(() => expect(held).toHaveLength(1));
      expect((await story(t, 'WEB-4')).stage).toBe('doing');
      // Saved on disk but still writing: the keys are ignored, so their hints are hidden.
      expect(app.lastFrame()).not.toContain('n new');
      held[0]?.();
      await waitForFrame(app, (f) => f.includes('● Todo 0') && f.includes('● Doing 2') && f.includes('n new'));
      const lines = frameLines(app).join('\n');
      expect(lines.indexOf('WEB-5')).toBeLessThan(lines.indexOf('WEB-4'));
      expect((await story(t, 'WEB-4')).rank > (await story(t, 'WEB-5')).rank).toBe(true);
      // The cursor follows the card: shift+← moves it back.
      await app.press(KEYS.shiftLeft);
      await vi.waitFor(() => expect(held).toHaveLength(2));
      expect((await story(t, 'WEB-4')).stage).toBe('todo');
      held[1]?.();
      await waitForFrame(app, (f) => f.includes('● Todo 1') && f.includes('n new'));
    } finally {
      for (const release of held) release();
      app.unmount();
    }
  });
  it('restores folded Backlog and the highlighted Story after a refused upward move', async () => {
    const t = await seed();
    let release = () => {};
    const app = await open(t, {
      patch: (services) => ({
        ...services,
        stories: {
          ...services.stories,
          move: async () => {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            throw new ConflictError('the Story changed on disk');
          },
        },
      }),
    });
    try {
      await app.press('v');
      await waitForFrame(app, (f) => /▌ +WEB-1 Login/.test(f));
      await app.press('k', KEYS.left);
      await waitForFrame(app, '▌ ▸ Backlog (3)');
      await app.press('j', 'j');
      await waitForFrame(app, (f) => /▌ +WEB-4 Dark mode/.test(f));
      await app.press(KEYS.shiftUp);
      await waitForFrame(app, (f) => f.includes('▾ Backlog (4)') && /▌ +WEB-4 Dark mode/.test(f));
      expect(app.lastFrame()).not.toContain('v Stages view');
      release();
      const frame = await waitForFrame(
        app,
        (f) =>
          f.includes('✕ the Story changed on disk') &&
          f.includes('▸ Backlog (3)') &&
          /▌ +WEB-4 Dark mode/.test(f) &&
          f.includes('v Stages view'),
      );
      expect(frame).not.toContain('WEB-2');
      expect((await story(t, 'WEB-4')).stage).toBe('todo');
      // The restored cursor also determines which Story the next action opens.
      await app.press(KEYS.enter);
      await waitForFrame(app, (f) => /WEB-4 +Dark mode/.test(f) && f.includes(' Details '));
    } finally {
      release();
      app.unmount();
    }
  });
});
