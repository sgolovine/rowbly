import { EventEmitter } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../src/core';
import type { Stage } from '../../src/schemas';
import { createServices, type RowblyContext, type Services } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { screens } from '../../src/tui/screens';
import {
  columnLayout,
  follow,
  groupColumns,
  moveCard,
  swapCard,
  taskSummary,
  truncate,
} from '../../src/tui/screens/board/layout';
import { fixedClock, fixedIds, makeBoard, makeRootConfig, makeStory, type TempRoot, tempRoot } from '../helpers';
import { KEYS, type Rendered, renderTui, tick, waitForFrame } from './helpers';

const web = { boardId: 'web' };

const FOUR_STAGES: Stage[] = [
  { key: 'backlog', name: 'Backlog', category: 'todo' },
  { key: 'todo', name: 'Todo', category: 'todo' },
  { key: 'doing', name: 'Doing', category: 'in_progress' },
  { key: 'done', name: 'Done', category: 'done' },
];

const SIX_STAGES: Stage[] = [
  ...FOUR_STAGES.slice(0, 3),
  { key: 'review', name: 'Review', category: 'in_progress' },
  { key: 'qa', name: 'QA', category: 'in_progress' },
  FOUR_STAGES[3] as Stage,
];

/** A Board with the given Stages and 6 Stories. */
async function seed(stages: Stage[] = FOUR_STAGES) {
  const t = await tempRoot();
  await makeRootConfig(t.path, {
    assignees: [
      { handle: 'alice', name: 'Alice' },
      { handle: 'bob', name: 'Bob' },
    ],
  });
  await makeBoard(t.path, { id: 'web', name: 'Website', keyPrefix: 'WEB', stages });
  await makeBoard(t.path, { id: 'api', name: 'API', keyPrefix: 'API' });
  const task = (n: number, stage: string) => ({
    id: `WEB-1.${n}`,
    name: `Task ${n}`,
    description: '',
    stage,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  await makeStory(t.path, {
    ...web,
    key: 'WEB-1',
    name: 'Login page with a rather long name that must be truncated',
    stage: 'backlog',
    rank: 'a0',
    assignees: ['alice', 'bob'],
    priority: 'P1',
    labels: ['ui'],
    tasks: [task(1, 'done'), task(2, 'todo'), task(3, 'doing')],
    nextTaskNumber: 4,
  });
  await makeStory(t.path, { ...web, key: 'WEB-2', name: 'Signup form', stage: 'backlog', rank: 'a1' });
  await makeStory(t.path, { ...web, key: 'WEB-3', name: 'Password reset', stage: 'backlog', rank: 'a2' });
  await makeStory(t.path, {
    ...web,
    key: 'WEB-4',
    name: 'Dark mode',
    stage: 'todo',
    rank: 'a0',
    assignees: ['bob'],
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

function resize(app: Rendered, columns: number, rows: number) {
  Object.defineProperty(app.stdout, 'columns', { value: columns, configurable: true });
  Object.defineProperty(app.stdout, 'rows', { value: rows, configurable: true });
  app.stdout.emit('resize');
}

const ctxBoard = async (t: TempRoot) => (await createRepositories(t.root).localState.get()).board;

const story = (t: TempRoot, key: string) => createRepositories(t.root).stories.findByKey(key);

/** Every Story file's contents, by file name. */
async function storyFiles(t: TempRoot): Promise<Record<string, string>> {
  const dir = join(t.path, 'boards', 'web', 'stories');
  const files: Record<string, string> = {};
  for (const name of await readdir(dir)) files[name] = await readFile(join(dir, name, 'story.json'), 'utf8');
  return files;
}

/** The frame without the temp Data Root's random folder name, shown as the project name. */
const stable = (frame: string) => frame.replace(/rowbly-test-\w{6}/, 'rowbly-test-XXXXXX');

/** The lines of the frame between the board title and the footer. */
const frameLines = (app: Rendered) => (app.lastFrame() ?? '').split('\n');

describe('board view', () => {
  it('renders one column per Stage with counts and cards in Rank order', async () => {
    const t = await seed();
    const app = await open(t);
    const frame = app.lastFrame() ?? '';
    expect(frame).toContain('Website web');
    for (const header of ['● Backlog (3)', '● Todo (1)', '● Doing (1)', '● Done (1)']) expect(frame).toContain(header);
    // key + Priority, truncated name, Assignees + Task summary
    expect(frame).toContain('▌ WEB-1 P1');
    expect(frame).toMatch(/Login page with a ra.*…/);
    expect(frame).toContain('@alice @bob · ✓ 1/3');
    expect(frame.indexOf('WEB-1')).toBeLessThan(frame.indexOf('WEB-2'));
    expect(frame.indexOf('WEB-2')).toBeLessThan(frame.indexOf('WEB-3'));
    expect(stable(frame)).toMatchSnapshot();
    app.unmount();
  });

  it('moves a card to the next Stage with L, at the bottom, and on disk', async () => {
    const t = await seed();
    const app = await open(t);
    await app.press('l', 'L');
    await waitForFrame(app, (f) => f.includes('● Todo (0)') && f.includes('● Doing (2)'));
    const lines = frameLines(app).join('\n');
    expect(lines.indexOf('WEB-5')).toBeLessThan(lines.indexOf('WEB-4'));
    await vi.waitFor(async () => expect((await story(t, 'WEB-4')).stage).toBe('doing'));
    expect((await story(t, 'WEB-4')).rank > (await story(t, 'WEB-5')).rank).toBe(true);
    // The cursor follows the card: H moves it back.
    await app.press('H');
    await waitForFrame(app, (f) => f.includes('● Todo (1)'));
    await vi.waitFor(async () => expect((await story(t, 'WEB-4')).stage).toBe('todo'));
    app.unmount();
  });

  it('reorders within a column with K, changing only one file', async () => {
    const t = await seed();
    const before = await storyFiles(t);
    const app = await open(t);
    await app.press('j', 'j', 'K');
    await waitForFrame(app, (f) => f.indexOf('WEB-3') < f.indexOf('WEB-2'));
    const changed = async () => {
      const after = await storyFiles(t);
      return Object.keys(after).filter((name) => after[name] !== before[name]);
    };
    await vi.waitFor(async () => expect(await changed()).toEqual(['WEB-3']));
    const [one, two, three] = await Promise.all(['WEB-1', 'WEB-2', 'WEB-3'].map(async (k) => (await story(t, k)).rank));
    expect([one, three, two]).toEqual([one, three, two].sort());
    app.unmount();
  });

  it('ranks a Story to the top and the bottom of its Stage with T and B', async () => {
    const t = await seed();
    const app = await open(t);
    const order = async () => {
      const ranked = await Promise.all(['WEB-1', 'WEB-2', 'WEB-3'].map(async (k) => [(await story(t, k)).rank, k]));
      return ranked.sort(([a], [b]) => ((a ?? '') < (b ?? '') ? -1 : 1)).map(([, k]) => k);
    };
    await app.press('j', 'j', 'T');
    await waitForFrame(app, (f) => f.indexOf('WEB-3') < f.indexOf('WEB-1'));
    await vi.waitFor(async () => expect(await order()).toEqual(['WEB-3', 'WEB-1', 'WEB-2']));
    // The cursor followed the Story to the top.
    await app.press('B');
    await waitForFrame(app, (f) => f.indexOf('WEB-3') > f.indexOf('WEB-2'));
    await vi.waitFor(async () => expect(await order()).toEqual(['WEB-1', 'WEB-2', 'WEB-3']));
    app.unmount();
  });

  it('narrows the cards with the filter and clears it', async () => {
    const t = await seed();
    const app = await open(t);
    // assignee, me, label, priority, text
    await app.press('/', KEYS.down, ' ', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('filter: mine') && !f.includes('WEB-4'));
    expect(app.lastFrame()).toContain('● Backlog (1)');
    await app.press('c');
    await waitForFrame(app, (f) => f.includes('WEB-4'));
    await app.press('/', ...Array(4).fill(KEYS.down), ...'footer', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('filter: "footer"') && !f.includes('WEB-1'));
    expect(app.lastFrame()).toContain('WEB-5');
    app.unmount();
  });

  it('filters on several values per field, like the Stories list', async () => {
    const t = await seed();
    const app = await open(t);
    // assignees, me, labels, priorities, text: P0 and P3 at once.
    await app.press('/', ...Array(3).fill(KEYS.down), ' ', KEYS.right, KEYS.right, KEYS.right, ' ', KEYS.ctrlEnter);
    let frame = await waitForFrame(app, (f) => f.includes('filter: P0 P3') && !f.includes('WEB-1'));
    expect(frame).toContain('WEB-4');
    expect(frame).toContain('WEB-5');
    expect(frame).not.toContain('WEB-6');
    // Both Assignees: any of them matches, like a repeated --assignee.
    await app.press('c', '/', ' ', KEYS.right, ' ', KEYS.ctrlEnter);
    frame = await waitForFrame(app, (f) => f.includes('filter: @alice @bob') && !f.includes('WEB-5'));
    expect(frame).toContain('WEB-1');
    expect(frame).toContain('WEB-4');
    app.unmount();
  });

  it('reverts a move the service refuses and shows a toast', async () => {
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
    await app.press('L');
    // Shown before the service answers: the move is held until `release()`.
    await waitForFrame(app, (f) => f.includes('● Backlog (2)') && f.includes('● Todo (2)'));
    release();
    await waitForFrame(
      app,
      (f) =>
        f.includes('error: the Story changed on disk') &&
        f.includes('● Backlog (3)') &&
        f.includes('● Todo (1)') &&
        f.includes('▌ WEB-1'),
    );
    expect((await story(t, 'WEB-1')).stage).toBe('backlog');
    app.unmount();
  });

  it('scrolls horizontally at 80 columns with 6 Stages without wrapping cards', async () => {
    const t = await seed(SIX_STAGES);
    const app = await open(t, { columns: 80 });
    await waitForFrame(app, (f) => f.includes('Stages 1–2 of 6'));
    let frame = app.lastFrame() ?? '';
    expect(frame).toContain('Stages 1–2 of 6');
    expect(frame).toContain('4›');
    expect(frame).not.toContain('Doing');
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    // The long name stays on one line, cut with an ellipsis.
    expect(frame.split('\n').filter((l) => l.includes('Login page'))).toHaveLength(1);
    await app.press('l', 'l', 'l', 'l');
    await waitForFrame(app, (f) => f.includes('Stages 4–5 of 6') && f.includes('● QA (0)'));
    frame = app.lastFrame() ?? '';
    expect(frame).toContain('Stages 4–5 of 6');
    expect(frame).toContain('‹3');
    expect(frame).toContain('1›');
    expect(frame).toContain('● QA (0)');
    expect(frame).not.toContain('Backlog');
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    expect(stable(frame)).toMatchSnapshot();
    app.unmount();
  });

  it('scrolls a column vertically when it has more cards than fit', async () => {
    const t = await seed();
    // 22 rows leave room for 3 cards.
    const app = await open(t, { rows: 22 });
    await makeStory(t.path, { ...web, key: 'WEB-7', name: 'Fourth', stage: 'backlog', rank: 'a3' });
    await app.press('r');
    await waitForFrame(app, (f) => f.includes('● Backlog (4)'));
    expect(app.lastFrame()).toContain('↓ 1 more');
    expect(app.lastFrame()).not.toContain('WEB-7');
    await app.press('j', 'j', 'j');
    await waitForFrame(app, (f) => f.includes('↑ 1 more') && f.includes('▌ WEB-7'));
    expect(app.lastFrame()).not.toContain('WEB-1 ');
    app.unmount();
  });

  it('opens a Story with enter and returns to the board', async () => {
    const t = await seed();
    const app = await open(t);
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Details') && f.includes('Login page'));
    await app.press(KEYS.escape);
    await waitForFrame(app, (f) => f.includes('● Backlog (3)'));
    app.unmount();
  });

  it('creates a Story in the current column with n', async () => {
    const t = await seed();
    const app = await open(t);
    await app.press('l', 'l', 'n');
    await waitForFrame(app, (f) => f.includes('New Story on web') && f.includes('‹ doing ›'));
    await app.press(...'From board', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Created WEB-7'));
    expect((await story(t, 'WEB-7')).stage).toBe('doing');
    await app.press(KEYS.escape);
    await waitForFrame(app, (f) => f.includes('● Doing (2)'));
    app.unmount();
  });

  it('edits with e and deletes with d after confirming', async () => {
    const t = await seed();
    const app = await open(t);
    await app.press('l', 'l', 'e');
    await waitForFrame(app, (f) => f.includes('Edit WEB-5'));
    await app.press(KEYS.escape);
    await waitForFrame(app, (f) => f.includes('● Doing (1)') && !f.includes('Edit WEB-5'));
    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete WEB-5'));
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted WEB-5') && f.includes('● Doing (0)'));
    await expect(story(t, 'WEB-5')).rejects.toThrow('not found');
    app.unmount();
  });

  it('selects a card with a click, opens it with a second and drags it to another Stage', async () => {
    const t = await seed();
    const mouse = new EventEmitter();
    const app = await open(t, { mouse });
    const at = (text: string) => {
      const lines = frameLines(app);
      const y = lines.findIndex((line) => line.includes(text));
      return { x: lines[y]?.indexOf(text) ?? -1, y };
    };
    const click = async (point: { x: number; y: number }, release = point) => {
      mouse.emit('mouse', { kind: 'press', ...point });
      mouse.emit('mouse', { kind: 'release', ...release });
      await tick();
    };

    // Click targets register in effects, which can trail the first frame on a busy machine.
    await tick(200);
    await click(at('Dark mode'));
    await waitForFrame(app, '▌ Dark mode');
    // Drag WEB-2 from Backlog and drop it on the Done column.
    await click(at('Signup form'), at('Release v1'));
    await waitForFrame(app, (f) => f.includes('● Backlog (2)') && f.includes('● Done (2)'));
    // The board updates before the write lands.
    await vi.waitFor(async () => expect((await story(t, 'WEB-2')).stage).toBe('done'));
    await click(at('Signup form'));
    await click(at('Signup form'));
    await waitForFrame(app, ' Tasks ');
    await tick(200);
    await click(at(' Tasks '));
    await waitForFrame(app, 'No Tasks yet');
    await click(at(' Details '));
    await waitForFrame(app, (f) => /Updated\s+20/.test(f));
    app.unmount();
  });

  it('switches Board from the sidebar with a click and with ] and [', async () => {
    const t = await seed();
    const mouse = new EventEmitter();
    const app = await open(t, { mouse });
    await tick(200);
    await app.press(']');
    await waitForFrame(app, (f) => f.includes('▌ 1 API') && f.includes('API api'));
    await expect(ctxBoard(t)).resolves.toBe('api');
    const lines = frameLines(app);
    const y = lines.findIndex((line) => line.includes('2 Website'));
    mouse.emit('mouse', { kind: 'press', x: 4, y });
    mouse.emit('mouse', { kind: 'release', x: 4, y });
    await waitForFrame(app, (f) => f.includes('▌ 2 Website') && f.includes('WEB-1'));
    await app.press('1');
    await waitForFrame(app, 'API api');
    app.unmount();
  });
});

describe('home', () => {
  it('opens straight to the board view when a Board is in context', async () => {
    const t = await seed();
    const app = await open(t, { screen: 'home' });
    expect(app.lastFrame()).toContain('Website web');
    app.unmount();
  });

  it('opens the home menu when no Board resolves', async () => {
    const t = await seed();
    const { ctx, toasts } = contextFor(t);
    const app = renderTui(
      <App ctx={ctx} services={createServices(ctx)} initial={{ screen: 'home', params: {} }} toasts={toasts} />,
    );
    await waitForFrame(app, (f) => f.includes('Go to'));
    expect(screens.home).toBeDefined();
    app.unmount();
  });
});

describe('board layout', () => {
  it('fits all columns when it can, else scrolls with gutters', () => {
    expect(columnLayout(4, 118)).toEqual({ visible: 4, width: 29 });
    expect(columnLayout(6, 78)).toEqual({ visible: 3, width: 24 });
    expect(columnLayout(6, 100)).toEqual({ visible: 3, width: 31 });
    expect(columnLayout(6, 20)).toEqual({ visible: 1, width: 24 });
  });

  it('follows the cursor with as little scrolling as possible', () => {
    expect(follow(0, 4, 3, 6)).toBe(2);
    expect(follow(2, 3, 3, 6)).toBe(2);
    expect(follow(2, 1, 3, 6)).toBe(1);
    expect(follow(5, 5, 3, 6)).toBe(3);
    expect(follow(0, 0, 3, 1)).toBe(0);
  });

  it('moves and swaps cards without touching other columns', () => {
    const a = { key: 'A', stage: 'x' } as never;
    const b = { key: 'B', stage: 'x' } as never;
    const c = { key: 'C', stage: 'y' } as never;
    const columns = groupColumns(
      [
        { key: 'x', name: 'X', category: 'todo' },
        { key: 'y', name: 'Y', category: 'done' },
      ],
      [a, b, c],
    );
    expect(moveCard(columns, 0, 0, 1, 'y').map((col) => col.map((s) => `${s.key}:${s.stage}`))).toEqual([
      ['B:x'],
      ['C:y', 'A:y'],
    ]);
    expect(swapCard(columns, 0, 1, -1).map((col) => col.map((s) => s.key))).toEqual([['B', 'A'], ['C']]);
    expect(swapCard(columns, 0, 0, -1)).toBe(columns);
  });

  it('summarises Tasks by Stage Category and truncates text', () => {
    expect(taskSummary({ tasks: [] }, FOUR_STAGES)).toBeNull();
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
