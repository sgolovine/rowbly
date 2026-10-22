import type { EventEmitter } from 'node:events';
import { Text } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../src/core/errors';
import type { StageConfig } from '../../src/schemas';
import { createServices, type PluginHost, type RowblyContext, type Services } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore, useActivate } from '../../src/tui/hooks';
import { useRouter } from '../../src/tui/router';
import { screens } from '../../src/tui/screens';
import { deferred, fixedClock, fixedIds, makeBoard, makeStory, type TempRoot, tempRoot } from '../helpers';
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

/** A promise and the function that resolves it. */
function arrival(): { promise: Promise<void>; resolve(): void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('board view', () => {
  it('moves a card to the next Stage with shift+→, at the bottom, and on disk', async () => {
    const t = await seed();
    // The move is on disk before the service call returns; the barrier holds the call open in that window.
    // Each held call, in order; the test releases one once it has arrived. It awaits the arrival of call
    // `n` rather than polling for it with a deadline: the commit before it may take any time.
    const held: (() => void)[] = [];
    const arrivals = [arrival(), arrival()];
    const arrived = (n: number) => arrivals[n - 1]?.promise;
    // The first commit waits until the test has seen the move on screen, so the screen cannot rely on it.
    let commit = () => {};
    const committing = new Promise<void>((resolve) => {
      commit = resolve;
    });
    const app = await open(t, {
      patch: (services) => ({
        ...services,
        stories: {
          ...services.stories,
          move: async (...args: Parameters<Services['stories']['move']>) => {
            await committing;
            const saved = await services.stories.move(...args);
            await new Promise<void>((resolve) => {
              held.push(resolve);
              arrivals[held.length - 1]?.resolve();
            });
            return saved;
          },
        },
      }),
    });
    try {
      await app.press(KEYS.right, KEYS.shiftRight);
      // Shown at once, before the commit; the keys are ignored while it writes, so their hints are hidden.
      await waitForFrame(app, (f) => f.includes('● Todo 0') && f.includes('● Doing 2') && !f.includes('n new'));
      expect((await story(t, 'WEB-4')).stage).toBe('todo');
      commit();
      await arrived(1);
      expect((await story(t, 'WEB-4')).stage).toBe('doing');
      // Saved on disk but still writing: the keys are still ignored.
      expect(app.lastFrame()).not.toContain('n new');
      held[0]?.();
      await waitForFrame(app, (f) => f.includes('● Todo 0') && f.includes('● Doing 2') && f.includes('n new'));
      const lines = frameLines(app).join('\n');
      expect(lines.indexOf('WEB-5')).toBeLessThan(lines.indexOf('WEB-4'));
      expect((await story(t, 'WEB-4')).rank > (await story(t, 'WEB-5')).rank).toBe(true);
      // The cursor follows the card: shift+← moves it back.
      await app.press(KEYS.shiftLeft);
      await arrived(2);
      expect((await story(t, 'WEB-4')).stage).toBe('todo');
      held[1]?.();
      await waitForFrame(app, (f) => f.includes('● Todo 1') && f.includes('n new'));
    } finally {
      commit();
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

describe('Data Root session', () => {
  it('opens the Data Root activated last, and a refresh of the same one keeps its screens', async () => {
    const a = await seed();
    const b = await tempRoot();
    await makeBoard(b.path, { id: 'ops', name: 'Operations', keyPrefix: 'OPS' });
    await makeStory(b.path, { boardId: 'ops', key: 'OPS-1', name: 'Rotate keys', stage: 'backlog', rank: 'a0' });
    const toasts = createToastStore();
    const ctxA = contextFor(a, toasts, { version: 1, board: 'web' }).ctx;
    const ctxB = contextFor(b, toasts, { version: 1, board: 'ops' }).ctx;
    // Each Plugin load waits until the test releases it, so the loads can finish in any order.
    const loads: { path: string; release(): void }[] = [];
    const host: PluginHost = { registry: [], status: () => [], active: () => [], failures: () => [], markFailed() {} };
    const loadPlugins = async (root: RowblyContext['root'] | null) => {
      const load = deferred();
      loads.push({ path: root?.path ?? '', release: () => load.resolve() });
      await load.promise;
      return host;
    };
    const release = async (path: string) => {
      await vi.waitFor(() => expect(loads.some((load) => load.path === path)).toBe(true));
      const at = loads.findIndex((load) => load.path === path);
      loads.splice(at, 1)[0]?.release();
    };
    let session: { activate: ReturnType<typeof useActivate>; push(screen: string): void } | undefined;
    function Probe({ params }: { params: Record<string, unknown> }) {
      const activate = useActivate();
      const router = useRouter();
      session = { activate, push: (screen) => router.push(screen, { title: 'Marker' }) };
      return <Text>{`probe ${String(params.title ?? 'root')}`}</Text>;
    }
    const app = renderTui(
      <App
        ctx={ctxA}
        services={createServices(ctxA)}
        initial={{ screen: 'probe', params: {} }}
        screens={{ ...screens, probe: Probe }}
        toasts={toasts}
        loadPlugins={loadPlugins}
      />,
    );
    resize(app, 120, 40);
    try {
      await waitForFrame(app, 'probe root');
      session?.push('probe');
      await waitForFrame(app, 'probe Marker');
      // A refresh of the open Data Root (as after turning a Plugin on) keeps the screens open.
      const refresh = session?.activate({ ...ctxA });
      await release(a.path);
      expect(await refresh).toBe(true);
      expect(app.lastFrame()).toContain('probe Marker');

      // A refresh of A starts, then a switch to B; B loads first, then A's stale load finishes.
      const stale = session?.activate({ ...ctxA });
      const toB = session?.activate(ctxB);
      await release(b.path);
      expect(await toB).toBe(true);
      await waitForFrame(app, (f) => f.includes('OPS-1') && !f.includes('probe'));
      await release(a.path);
      expect(await stale).toBe(false);
      expect(app.lastFrame()).toContain('OPS-1');
      expect(app.lastFrame()).not.toContain('WEB-');
    } finally {
      for (const load of loads) load.release();
      app.unmount();
    }
  });
});
