import { describe, expect, it } from 'vitest';
import type { LocalState } from '../../src/schemas';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { fixedClock, fixedIds, makeBoard, makeStory, type TempRoot, tempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from './helpers';

const web = { boardId: 'web' };

async function setup() {
  const t = await tempRoot();
  await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB', name: 'Web' });
  return t;
}

/** The real App over a temp Data Root, opened on `screen`. */
async function open(t: TempRoot, screen: string, local: LocalState = { version: 1 }) {
  const toasts = createToastStore();
  const ctx: RowblyContext = {
    root: t.root,
    local,
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => toasts.push('warning', message),
  };
  const app = renderTui(
    <App ctx={ctx} services={createServices(ctx)} initial={{ screen, params: {} }} toasts={toasts} />,
  );
  await waitForFrame(app, (frame) => !frame.includes('Loading'));
  return app;
}

const stageKeys = async (t: TempRoot) =>
  ((await createRepositories(t.root).boards.get('web')).stages ?? []).map((s) => s.key);

describe('stages screen', () => {
  it('shows the order, category badges and the level with its inherited source', async () => {
    const t = await setup();
    const app = await open(t, 'stages');
    const frame = app.lastFrame() ?? '';
    expect(frame).toContain('Level:  board   global');
    expect(frame).toContain('inherited from default (copied to board on first');
    expect(frame).toContain('› 1. ● Backlog backlog · todo');
    expect(frame).toContain('3. ● In Progress in-progress · in_progress');
    await app.press('l');
    await waitForFrame(app, (f) => f.includes('copied to global'));
    app.unmount();
  });

  it('adds a Stage at a position relative to the highlighted Stage', async () => {
    const t = await setup();
    const app = await open(t, 'stages');
    await app.press('j', 'j', 'n');
    expect(app.lastFrame()).toContain('Add a Stage');
    expect(app.lastFrame()).toContain('‹ after in-progress ›');
    await app.press(...'qa', KEYS.down, ...'QA', KEYS.down, KEYS.right, KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('4. ● QA qa · in_progress'));
    expect(await stageKeys(t)).toEqual(['backlog', 'todo', 'in-progress', 'qa', 'done']);
    expect(app.lastFrame()).toContain('· own list');
    app.unmount();
  });

  it('moves a Stage last and first with B and T', async () => {
    const t = await setup();
    const app = await open(t, 'stages');
    expect(app.lastFrame()).toContain('T/B move first/last');
    await app.press('B');
    await waitForFrame(app, (f) => f.includes('› 4. ● Backlog'));
    expect(await stageKeys(t)).toEqual(['todo', 'in-progress', 'done', 'backlog']);
    await app.press('T');
    await waitForFrame(app, (f) => f.includes('› 1. ● Backlog'));
    expect(await stageKeys(t)).toEqual(['backlog', 'todo', 'in-progress', 'done']);
    app.unmount();
  });

  it('moves a Stage down and edits it', async () => {
    const t = await setup();
    const app = await open(t, 'stages');
    await app.press('J');
    await waitForFrame(app, (f) => f.includes('› 2. ● Backlog'));
    expect(await stageKeys(t)).toEqual(['todo', 'backlog', 'in-progress', 'done']);
    await app.press('e', ...Array(7).fill(KEYS.backspace), ...'Icebox', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('2. ● Icebox backlog'));
    app.unmount();
  });

  it('removing a Stage in use asks for a move-to target', async () => {
    const t = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', stage: 'backlog' });
    const app = await open(t, 'stages');
    await app.press('d');
    expect(app.lastFrame()).toContain('Remove Stage Backlog at the board level?');
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Backlog is used by 1 Stories and 0 Tasks. Move them to:'));
    await app.press('j', KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Removed Backlog; moved 1 Stories and 0 Tasks to in-progress'));
    expect(await stageKeys(t)).toEqual(['todo', 'in-progress', 'done']);
    expect((await createRepositories(t.root).stories.findByKey('WEB-1')).stage).toBe('in-progress');
    app.unmount();
  });

  it('esc cancels a form without leaving the screen', async () => {
    const t = await setup();
    const app = await open(t, 'stages');
    expect(app.lastFrame()).toContain('n add ·');
    await app.press('n');
    expect(app.lastFrame()).toContain('Add a Stage');
    // The form's own esc replaces the shell's "esc back" in the footer.
    expect(app.lastFrame()).toContain('esc cancel · g go to');
    expect(app.lastFrame()).not.toContain('esc back');
    await app.press(KEYS.escape);
    expect(app.lastFrame()).not.toContain('Add a Stage');
    expect(app.lastFrame()).toContain('Level:');
    app.unmount();
  });
});

describe('fields screen', () => {
  it('adds a select field through the type-specific form, then strips values on option edit', async () => {
    const t = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1' });
    const app = await open(t, 'fields');
    expect(app.lastFrame()).toContain('No Custom Fields. Press n to add one.');
    await app.press('n', 'j', 'j', 'j', 'j', 'j', KEYS.enter);
    expect(app.lastFrame()).toContain('Add a select field');
    expect(app.lastFrame()).toContain('Options (a,b,c)');
    await app.press(...'size', KEYS.down, ...'Size', KEYS.down, KEYS.down, KEYS.down, ...'s,m,l', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Size size · select: s, m, l'));

    const repos = createRepositories(t.root);
    await repos.stories.put({ ...(await repos.stories.findByKey('WEB-1')), customFields: { size: 'l' } });
    await app.press('e', KEYS.down, KEYS.down, KEYS.down, KEYS.backspace, KEYS.backspace, KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Updated size') && f.includes('select: s, m\n'));
    expect(app.lastFrame()).toContain('stripped 1 value of "size"');
    expect((await repos.stories.findByKey('WEB-1')).customFields).toEqual({});
    app.unmount();
  });

  it('shows number settings in the form and removes a field', async () => {
    const t = await setup();
    const app = await open(t, 'fields');
    await app.press('n', 'j', KEYS.enter);
    expect(app.lastFrame()).toContain('Whole numbers');
    await app.press(...'est', KEYS.down, ...'Estimate', KEYS.down, KEYS.down, KEYS.down, '0', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Estimate est · number (≥ 0)'));
    await app.press('d', 'y');
    await waitForFrame(app, (f) => f.includes('Removed Estimate; stripped 0 values'));
    app.unmount();
  });
});

describe('boards screen', () => {
  it('creates, edits and deletes Boards, asking again when a Board has Stories', async () => {
    const t = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1' });
    const app = await open(t, 'boards', { version: 1, board: 'web' });
    expect(app.lastFrame()).toContain('Web web · WEB (current)');

    await app.press('n', ...'api', KEYS.down, ...'Api', KEYS.down, ...'API', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Created Api (API)') && f.includes('Api api · API'));

    await app.press('e', KEYS.backspace, KEYS.backspace, KEYS.backspace, ...'API svc', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('API svc api · API'));

    await app.press('j', 'd', 'y');
    await waitForFrame(app, (f) => f.includes('Web has 1 Stories. Delete the Board and all of them?'));
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted Web'));
    expect((await createRepositories(t.root).boards.list()).map((b) => b.id)).toEqual(['api']);
    app.unmount();
  });

  it('opens Stages for the highlighted Board', async () => {
    const t = await setup();
    const app = await open(t, 'boards');
    await app.press('s');
    await waitForFrame(app, (f) => f.includes('Web Stages') && f.includes('1. ● Backlog'));
    app.unmount();
  });
});
