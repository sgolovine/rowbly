import { EventEmitter } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../src/core';
import type { StageConfig } from '../../src/schemas';
import { createServices, type RowblyContext, type Services } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { screens } from '../../src/tui/screens';
import {
  columnLayout,
  follow,
  groupColumns,
  listRows,
  moveCard,
  swapCard,
  truncate,
} from '../../src/tui/screens/board/layout';
import { fixedClock, fixedIds, makeBoard, makeStory, type TempRoot, tempRoot } from '../helpers';
import { KEYS, type Rendered, renderTui, resize, tick, waitForFrame } from './helpers';

const web = { boardId: 'web' };

/** With the fixed Backlog and Done: four Stages. */
const FOUR_STAGES: StageConfig[] = [
  { key: 'todo', name: 'Todo' },
  { key: 'doing', name: 'Doing' },
];

/** With the fixed Backlog and Done: six Stages. */
const SIX_STAGES: StageConfig[] = [...FOUR_STAGES, { key: 'review', name: 'Review' }, { key: 'qa', name: 'QA' }];

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

/** The single-line box glyph for each bold one. */
const THIN: Record<string, string> = { '┏': '┌', '┓': '┐', '┗': '└', '┛': '┘', '━': '─', '┃': '│' };

describe('board view', () => {
  it('renders one column per Stage with counts and cards in Rank order', async () => {
    const t = await seed();
    const app = await open(t);
    const frame = app.lastFrame() ?? '';
    expect(frame).toContain('Website web');
    for (const header of ['● Backlog (3)', '● Todo (1)', '● Doing (1)', '● Done (1)']) expect(frame).toContain(header);
    // key + Priority, truncated name, Plugin badges (none are on here).
    expect(frame).toContain('┃ WEB-1 P1');
    expect(frame).toMatch(/Login page with a.*…/);
    expect(frame.indexOf('WEB-1')).toBeLessThan(frame.indexOf('WEB-2'));
    expect(frame.indexOf('WEB-2')).toBeLessThan(frame.indexOf('WEB-3'));
    expect(stable(frame)).toMatchSnapshot();
    app.unmount();
  });

  it('borders every card thinly and the selected one heavier, without shifting the layout', async () => {
    const t = await seed();
    const app = await open(t);
    const before = app.lastFrame() ?? '';
    expect(before).toContain('┃ WEB-1 P1');
    expect(before).toContain('│ WEB-2');
    expect(before).toContain('│ WEB-4 P3');
    await app.press('j');
    await waitForFrame(app, (f) => f.includes('┃ WEB-2') && f.includes('│ WEB-1 P1'));
    // Only the border changes: the frames match once bold borders read as thin ones.
    const thin = (frame: string) => frame.replace(/[┏┓┗┛━┃]/g, (c) => THIN[c] ?? c);
    expect(thin(app.lastFrame() ?? '')).toBe(thin(before));
    app.unmount();
  });

  it('moves a card to the next Stage with shift+→, at the bottom, and on disk', async () => {
    const t = await seed();
    const app = await open(t);
    await app.press(KEYS.right, KEYS.shiftRight);
    await waitForFrame(app, (f) => f.includes('● Todo (0)') && f.includes('● Doing (2)'));
    const lines = frameLines(app).join('\n');
    expect(lines.indexOf('WEB-5')).toBeLessThan(lines.indexOf('WEB-4'));
    await vi.waitFor(async () => expect((await story(t, 'WEB-4')).stage).toBe('doing'));
    expect((await story(t, 'WEB-4')).rank > (await story(t, 'WEB-5')).rank).toBe(true);
    // The cursor follows the card: shift+← moves it back.
    await app.press(KEYS.shiftLeft);
    await waitForFrame(app, (f) => f.includes('● Todo (1)'));
    await vi.waitFor(async () => expect((await story(t, 'WEB-4')).stage).toBe('todo'));
    app.unmount();
  });

  it('keeps h/l and H/L as alternatives to the arrow keys', async () => {
    const t = await seed();
    const app = await open(t);
    await app.press('l', 'L');
    await waitForFrame(app, (f) => f.includes('● Todo (0)') && f.includes('● Doing (2)'));
    await vi.waitFor(async () => expect((await story(t, 'WEB-4')).stage).toBe('doing'));
    await app.press('H');
    await waitForFrame(app, (f) => f.includes('● Todo (1)'));
    await vi.waitFor(async () => expect((await story(t, 'WEB-4')).stage).toBe('todo'));
    app.unmount();
  });

  it.each([
    ['shift+↑', [KEYS.down, KEYS.down, KEYS.shiftUp]],
    ['K', ['j', 'j', 'K']],
  ])('reorders within a column with %s, changing only one file', async (_name, keys) => {
    const t = await seed();
    const before = await storyFiles(t);
    const app = await open(t);
    await app.press(...keys);
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
    // The rank is on disk before the service call returns; the barrier holds the call open in that window.
    // Each held call, in order; the test releases one once it has arrived.
    const held: (() => void)[] = [];
    const app = await open(t, {
      patch: (services) => ({
        ...services,
        stories: {
          ...services.stories,
          rank: async (...args: Parameters<Services['stories']['rank']>) => {
            const saved = await services.stories.rank(...args);
            await new Promise<void>((resolve) => held.push(resolve));
            return saved;
          },
        },
      }),
    });
    const order = async () => {
      const ranked = await Promise.all(['WEB-1', 'WEB-2', 'WEB-3'].map(async (k) => [(await story(t, k)).rank, k]));
      return ranked.sort(([a], [b]) => ((a ?? '') < (b ?? '') ? -1 : 1)).map(([, k]) => k);
    };
    try {
      await app.press('j', 'j', 'T');
      await vi.waitFor(() => expect(held).toHaveLength(1));
      expect(await order()).toEqual(['WEB-3', 'WEB-1', 'WEB-2']);
      // Saved on disk but still writing: the keys are ignored, so their hints are hidden.
      expect(app.lastFrame()).not.toContain('n new');
      held[0]?.();
      await waitForFrame(app, (f) => f.indexOf('WEB-3') < f.indexOf('WEB-1') && f.includes('n new'));
      // The cursor followed the Story to the top.
      await app.press('B');
      await vi.waitFor(() => expect(held).toHaveLength(2));
      expect(await order()).toEqual(['WEB-1', 'WEB-2', 'WEB-3']);
      held[1]?.();
      await waitForFrame(app, (f) => f.indexOf('WEB-3') > f.indexOf('WEB-2') && f.includes('n new'));
    } finally {
      for (const release of held) release();
      app.unmount();
    }
  });

  it('narrows the cards with the filter and clears it', async () => {
    const t = await seed();
    const app = await open(t);
    // label, priority, text
    await app.press('/', ' ', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('filter: #ui') && !f.includes('WEB-4'));
    expect(app.lastFrame()).toContain('● Backlog (1)');
    await app.press('c');
    await waitForFrame(app, (f) => f.includes('WEB-4'));
    await app.press('/', ...Array(2).fill(KEYS.down), ...'footer', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('filter: "footer"') && !f.includes('WEB-1'));
    expect(app.lastFrame()).toContain('WEB-5');
    app.unmount();
  });

  it('filters on several values per field, like the Stories list', async () => {
    const t = await seed();
    const app = await open(t);
    // labels, priorities, text: P0 and P3 at once, like a repeated --priority.
    await app.press('/', KEYS.down, ' ', KEYS.right, KEYS.right, KEYS.right, ' ', KEYS.ctrlEnter);
    const frame = await waitForFrame(app, (f) => f.includes('filter: P0 P3') && !f.includes('WEB-1'));
    expect(frame).toContain('WEB-4');
    expect(frame).toContain('WEB-5');
    expect(frame).not.toContain('WEB-6');
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
        f.includes('┃ WEB-1'),
    );
    expect((await story(t, 'WEB-1')).stage).toBe('backlog');
    app.unmount();
  });

  it('scrolls horizontally at 80 columns with 6 Stages without wrapping cards', async () => {
    const t = await seed(SIX_STAGES);
    const app = await open(t, { columns: 80 });
    // At 80 columns the header buttons cut the header's Stage range, so the board's own counts show
    // where it has scrolled.
    await waitForFrame(app, (f) => f.includes('● Todo (1)') && f.includes('4›'));
    let frame = app.lastFrame() ?? '';
    expect(frame).not.toContain('Doing');
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    // The long name stays on one line, cut with an ellipsis.
    expect(frame.split('\n').filter((l) => l.includes('Login page'))).toHaveLength(1);
    await app.press('l', 'l', 'l', 'l');
    await waitForFrame(app, (f) => f.includes('‹3') && f.includes('● QA (0)'));
    frame = app.lastFrame() ?? '';
    expect(frame).toContain('1›');
    expect(frame).toContain('● QA (0)');
    expect(frame).not.toContain('Backlog');
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    expect(stable(frame)).toMatchSnapshot();
    app.unmount();
  });

  it('scrolls a column vertically when it has more cards than fit', async () => {
    const t = await seed();
    // 28 rows leave room for 3 cards.
    const app = await open(t, { rows: 28 });
    await makeStory(t.path, { ...web, key: 'WEB-7', name: 'Fourth', stage: 'backlog', rank: 'a3' });
    await app.press('r');
    await waitForFrame(app, (f) => f.includes('● Backlog (4)'));
    expect(app.lastFrame()).toContain('↓ 1 more');
    expect(app.lastFrame()).not.toContain('WEB-7');
    await app.press('j', 'j', 'j');
    await waitForFrame(app, (f) => f.includes('↑ 1 more') && f.includes('┃ WEB-7'));
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
    await waitForFrame(app, '┃ Dark mode');
    // Drag WEB-2 from Backlog and drop it on the Done column.
    await click(at('Signup form'), at('Release v1'));
    await waitForFrame(app, (f) => f.includes('● Backlog (2)') && f.includes('● Done (2)'));
    // The board updates before the write lands.
    await vi.waitFor(async () => expect((await story(t, 'WEB-2')).stage).toBe('done'));
    await click(at('Signup form'));
    await click(at('Signup form'));
    await waitForFrame(app, ' Details ');
    await tick(200);
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

describe('list view', () => {
  /** The frame's line that holds `text`. */
  const lineWith = (app: Rendered, text: string) => frameLines(app).find((line) => line.includes(text)) ?? '';

  it('starts with the Stages side by side; v shows Backlog, Board and Done sections with each Story and its Stage', async () => {
    const t = await seed();
    const app = await open(t);
    expect(app.lastFrame()).toContain('● Backlog (3)');
    expect(lineWith(app, 'Stages │ List')).toContain('v');
    await app.press('v');
    const frame = await waitForFrame(app, '▾ Backlog (3)');
    expect(frame).toContain('▾ Board (2)');
    expect(frame).toContain('▾ Done (1)');
    expect(frame).not.toContain('● Backlog (3)');
    expect(lineWith(app, 'WEB-4 Dark mode')).toContain('● Todo');
    expect(lineWith(app, 'WEB-5 Fix footer')).toContain('● Doing');
    expect(lineWith(app, 'WEB-6 Release v1')).toContain('● Done');
    // A dim rule below each line spaces the list apart.
    const lines = frameLines(app);
    const story = lines.findIndex((line) => line.includes('WEB-4 Dark mode'));
    expect(lines[story + 1]).toMatch(/│─{20,}│$/);
    expect(lines[story + 2]).toContain('WEB-5 Fix footer');
    // Sections in order; inside one, Stage order and then Rank order.
    const order = ['Backlog (3)', 'WEB-1', 'WEB-2', 'WEB-3', 'Board (2)', 'WEB-4', 'WEB-5', 'Done (1)', 'WEB-6'];
    const at = order.map((text) => frame.indexOf(text));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(frame).toContain('v Stages view');
    await app.press('v');
    await waitForFrame(app, '● Backlog (3)');
    app.unmount();
  });

  it('folds and unfolds a section with enter on its heading, and with ← and →', async () => {
    const t = await seed();
    const app = await open(t);
    await app.press('v');
    // The list keeps the highlighted Story; the heading is the line above it.
    await waitForFrame(app, (f) => /› +WEB-1 Login/.test(f));
    await app.press('k');
    await waitForFrame(app, (f) => f.includes('› ▾ Backlog (3)'));
    await app.press(KEYS.enter);
    let frame = await waitForFrame(app, '▸ Backlog (3)');
    expect(frame).not.toContain('WEB-1');
    // The next line is now the Board heading.
    await app.press('j', KEYS.left);
    frame = await waitForFrame(app, '› ▸ Board (2)');
    expect(frame).not.toContain('WEB-4');
    expect(frame).toContain('WEB-6');
    await app.press(KEYS.right, 'k', ' ');
    frame = await waitForFrame(app, (f) => f.includes('› ▾ Backlog (3)') && f.includes('▾ Board (2)'));
    expect(frame).toContain('WEB-1');
    expect(frame).toContain('WEB-4');
    app.unmount();
  });

  it('opens, edits and deletes the highlighted Story, and adds to its Stage', async () => {
    const t = await seed();
    const app = await open(t);
    await app.press('v');
    await waitForFrame(app, (f) => /› +WEB-1 Login/.test(f));
    // Past the Board heading to its first Story.
    await app.press(...Array(4).fill('j'));
    await waitForFrame(app, (f) => /› +WEB-4 Dark mode/.test(f));
    await app.press(KEYS.enter);
    await waitForFrame(app, ' Details ');
    await app.press(KEYS.escape);
    await waitForFrame(app, (f) => /› +WEB-4 Dark mode/.test(f) && f.includes('v Stages view'));
    await app.press('n');
    await waitForFrame(app, (f) => f.includes('New Story on web') && f.includes('‹ todo ›'));
    await app.press(KEYS.escape);
    await waitForFrame(app, (f) => /› +WEB-4 Dark mode/.test(f) && f.includes('v Stages view'));
    await app.press('d');
    await waitForFrame(app, 'Delete WEB-4 "Dark mode"?');
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted WEB-4') && f.includes('▾ Board (1)'));
    await expect(story(t, 'WEB-4')).rejects.toThrow();
    app.unmount();
  });

  it('moves the highlighted Story between Stages with shift+↑/↓, through Board to Backlog and Done', async () => {
    const t = await seed();
    const app = await open(t);
    await app.press(KEYS.right);
    await waitForFrame(app, '┃ WEB-4');
    await app.press('v');
    await waitForFrame(app, (f) => /› +WEB-4 Dark mode/.test(f));
    // From the first Stage in Board down to the next, at its bottom; the cursor follows the Story.
    await app.press(KEYS.shiftDown);
    let frame = await waitForFrame(
      app,
      (f) => /› +WEB-4 Dark mode/.test(f) && lineWith(app, 'WEB-4').includes('● Doing'),
    );
    expect(frame.indexOf('WEB-5')).toBeLessThan(frame.indexOf('WEB-4'));
    await vi.waitFor(async () => expect((await story(t, 'WEB-4')).stage).toBe('doing'));
    // From the last Stage in Board down to Done.
    await app.press(KEYS.shiftDown);
    frame = await waitForFrame(app, (f) => f.includes('▾ Done (2)') && /› +WEB-4 Dark mode/.test(f));
    expect(lineWith(app, 'WEB-4')).toContain('● Done');
    await vi.waitFor(async () => expect((await story(t, 'WEB-4')).stage).toBe('done'));
    // Done is the last Stage: nothing happens.
    await app.press(KEYS.shiftDown);
    await tick();
    expect((await story(t, 'WEB-4')).stage).toBe('done');
    // Back up through Board with K and shift+↑, then from its first Stage up to Backlog.
    await app.press('K');
    await waitForFrame(app, (f) => f.includes('▾ Board (2)') && lineWith(app, 'WEB-4').includes('● Doing'));
    await app.press(KEYS.shiftUp);
    await waitForFrame(app, (f) => /› +WEB-4 Dark mode/.test(f) && lineWith(app, 'WEB-4').includes('● Todo'));
    await app.press(KEYS.shiftUp);
    frame = await waitForFrame(app, (f) => f.includes('▾ Backlog (4)') && /› +WEB-4 Dark mode/.test(f));
    expect(frame.indexOf('WEB-3')).toBeLessThan(frame.indexOf('WEB-4'));
    expect(frame.indexOf('WEB-4')).toBeLessThan(frame.indexOf('Board (1)'));
    await vi.waitFor(async () => expect((await story(t, 'WEB-4')).stage).toBe('backlog'));
    app.unmount();
  });

  it('unfolds the section a Story moves into, and reverts a move the service refuses', async () => {
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
    await app.press('v');
    await waitForFrame(app, (f) => /› +WEB-1 Login/.test(f));
    await app.press(...Array(5).fill('j'));
    await waitForFrame(app, (f) => /› +WEB-5 Fix footer/.test(f));
    await app.press(...Array(3).fill('j'));
    await waitForFrame(app, (f) => /› +WEB-6 Release v1/.test(f));
    await app.press('k', KEYS.left);
    await waitForFrame(app, (f) => f.includes('› ▸ Done (1)'));
    await app.press('k', KEYS.shiftDown);
    // Shown before the service answers: the move is held until `release()`.
    await waitForFrame(app, (f) => f.includes('▾ Done (2)') && /› +WEB-5 Fix footer/.test(f));
    release();
    await waitForFrame(
      app,
      (f) =>
        f.includes('error: the Story changed on disk') && f.includes('▾ Board (2)') && /› +WEB-5 Fix footer/.test(f),
    );
    expect((await story(t, 'WEB-5')).stage).toBe('doing');
    app.unmount();
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
      await waitForFrame(app, (f) => /› +WEB-1 Login/.test(f));
      await app.press('k', KEYS.left);
      await waitForFrame(app, '› ▸ Backlog (3)');
      await app.press('j', 'j');
      await waitForFrame(app, (f) => /› +WEB-4 Dark mode/.test(f));
      await app.press(KEYS.shiftUp);
      await waitForFrame(app, (f) => f.includes('▾ Backlog (4)') && /› +WEB-4 Dark mode/.test(f));
      expect(app.lastFrame()).not.toContain('v Stages view');
      release();
      const frame = await waitForFrame(
        app,
        (f) =>
          f.includes('error: the Story changed on disk') &&
          f.includes('▸ Backlog (3)') &&
          /› +WEB-4 Dark mode/.test(f) &&
          f.includes('v Stages view'),
      );
      expect(frame).not.toContain('WEB-2');
      expect((await story(t, 'WEB-4')).stage).toBe('todo');
      // The restored cursor also determines which Story the next action opens.
      await app.press(KEYS.enter);
      await waitForFrame(app, (f) => f.includes('WEB-4 Dark mode') && f.includes(' Details '));
    } finally {
      release();
      app.unmount();
    }
  });

  it('keeps the highlighted Story when switching views, and the view when switching Boards', async () => {
    const t = await seed();
    const app = await open(t);
    await app.press(KEYS.right);
    await waitForFrame(app, '┃ WEB-4');
    await app.press('v');
    await waitForFrame(app, (f) => /› +WEB-4 Dark mode/.test(f));
    await app.press('j', 'v');
    await waitForFrame(app, (f) => f.includes('┃ WEB-5') && f.includes('● Doing (1)'));
    await app.press('v', ']');
    await waitForFrame(app, (f) => f.includes('API api') && f.includes('▾ Backlog (0)'));
    app.unmount();
  });

  it('scrolls a long list to follow the cursor', async () => {
    const t = await seed();
    const app = await open(t, { rows: 10 });
    await app.press('v');
    let frame = await waitForFrame(app, (f) => /› +WEB-1 Login/.test(f) && f.includes('more'));
    expect(frame).not.toContain('Release v1');
    await app.press(...Array(7).fill('j'));
    frame = await waitForFrame(app, (f) => /› +WEB-6 Release v1/.test(f));
    expect(frame).toMatch(/↑ \d+ more/);
    expect(frame).not.toContain('▾ Backlog');
    app.unmount();
  });

  it('switches view with a click on the header, and folds a section with clicks on its heading', async () => {
    const t = await seed();
    const mouse = new EventEmitter();
    const app = await open(t, { mouse });
    const click = async (text: string) => {
      const lines = frameLines(app);
      const y = lines.findIndex((line) => line.includes(text));
      const x = lines[y]?.indexOf(text) ?? -1;
      mouse.emit('mouse', { kind: 'press', x, y });
      mouse.emit('mouse', { kind: 'release', x, y });
      await tick();
    };
    // Click targets register in effects, which can trail the first frame on a busy machine.
    await tick(200);
    await click('List');
    await waitForFrame(app, '▾ Backlog (3)');
    await tick(200);
    // The first click selects the heading, the second folds it.
    await click('Done (1)');
    await waitForFrame(app, '› ▾ Done (1)');
    await click('Done (1)');
    await waitForFrame(app, '▸ Done (1)');
    await click('Stages');
    await waitForFrame(app, '● Backlog (3)');
    app.unmount();
  });

  it('opens the settings with a click on the header, like ,', async () => {
    const t = await seed();
    const mouse = new EventEmitter();
    const app = await open(t, { mouse });
    // Click targets register in effects, which can trail the first frame on a busy machine.
    await tick(200);
    const lines = frameLines(app);
    const y = lines.findIndex((line) => line.includes('Settings ,'));
    const x = lines[y]?.indexOf('Settings') ?? -1;
    mouse.emit('mouse', { kind: 'press', x, y });
    mouse.emit('mouse', { kind: 'release', x, y });
    const frame = await waitForFrame(app, 'Website web · WEB (current)');
    expect(frame).toContain('Board › Settings');
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
        { key: 'x', name: 'X', category: 'board' },
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

  it('lists Stories by section in Stage order, leaving out the Stories of a folded section', () => {
    const stages = [
      { key: 'backlog', name: 'Backlog', category: 'backlog' as const },
      { key: 'b', name: 'B', category: 'board' as const },
      { key: 'c', name: 'C', category: 'board' as const },
      { key: 'done', name: 'Done', category: 'done' as const },
    ];
    const s = (key: string, stage: string) => ({ key, stage }) as never;
    const columns = groupColumns(stages, [s('A', 'c'), s('B', 'backlog'), s('C', 'b'), s('D', 'done')]);
    const text = (folded: string[]) =>
      listRows(stages, columns, new Set(folded as never[])).map((r) =>
        r.kind === 'section' ? `${r.title}:${r.count}${r.collapsed ? '+' : ''}` : `${r.story.key}@${r.stage.key}`,
      );
    expect(text([])).toEqual(['Backlog:1', 'B@backlog', 'Board:2', 'C@b', 'A@c', 'Done:1', 'D@done']);
    expect(text(['board'])).toEqual(['Backlog:1', 'B@backlog', 'Board:2+', 'Done:1', 'D@done']);
  });

  it('truncates text', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
