// WP12: TUI paths for the command-mode capabilities the WP11 parity audit found missing.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { LocalState } from '../../src/schemas';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import type { RouteParams } from '../../src/tui/router';
import {
  fixedClock,
  fixedIds,
  makeBoard,
  makeEpic,
  makeStory,
  makeWorkspace,
  type TempRoot,
  tempRoot,
} from '../helpers';
import { KEYS, renderTui, waitForFrame } from './helpers';

const web = { workspaceId: 'acme', boardId: 'web' };
const api = { workspaceId: 'acme', boardId: 'api' };
const CONTEXT: LocalState = { version: 1, workspace: 'acme', board: 'web' };

/**
 * Workspace acme with Boards web (own Stages) and api (inherits), a global Custom Field, and a
 * second Workspace labs with its own Board and Epic.
 */
async function seed() {
  const t = await tempRoot();
  await writeFile(
    join(t.path, 'rowbly.config.json'),
    `${JSON.stringify({ version: 1, customFields: [{ key: 'size', name: 'Size', type: 'select', options: ['s', 'm'], required: true }] }, null, 2)}\n`,
  );
  await makeWorkspace(t.path, { id: 'acme', name: 'Acme', assignees: [{ handle: 'alice', name: 'Alice' }] });
  await makeBoard(t.path, {
    ...web,
    id: 'web',
    name: 'Website',
    keyPrefix: 'WEB',
    description: 'The public site',
    stages: [
      { key: 'todo', name: 'Todo', category: 'todo' },
      { key: 'done', name: 'Done', category: 'done' },
    ],
  });
  await makeBoard(t.path, { ...api, id: 'api', name: 'API', keyPrefix: 'API' });
  await makeStory(t.path, { ...web, key: 'WEB-1', name: 'Login', stage: 'todo', rank: 'a0', priority: 'P1' });
  await makeStory(t.path, { ...web, key: 'WEB-2', name: 'Signup', stage: 'todo', rank: 'a1' });
  await makeStory(t.path, { ...web, key: 'WEB-3', name: 'Lost', stage: 'gone', rank: 'a0' });
  await makeStory(t.path, { ...api, key: 'API-1', name: 'Tokens', stage: 'backlog', rank: 'a0', priority: 'P1' });
  await makeWorkspace(t.path, { id: 'labs', name: 'Labs' });
  await makeBoard(t.path, { id: 'lab', workspaceId: 'labs', name: 'Lab', keyPrefix: 'LAB' });
  await makeEpic(t.path, { id: 'moonshot', workspaceId: 'labs', name: 'Moonshot' });
  return t;
}

/** The real App over the temp Data Root, opened on `screen` with the current context acme/web. */
function open(t: TempRoot, screen: string, params: RouteParams = {}, local: LocalState = CONTEXT) {
  const toasts = createToastStore();
  const ctx: RowblyContext = {
    root: t.root,
    local: { ...local },
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => toasts.push('warning', message),
  };
  const app = renderTui(<App ctx={ctx} services={createServices(ctx)} initial={{ screen, params }} toasts={toasts} />);
  return { app, ctx };
}

const localOnDisk = (t: TempRoot) => createRepositories(t.root).localState.get();

describe('G1 Board detail (boards show)', () => {
  it('opens on enter from the Boards list with Story counts per Stage and where the lists come from', async () => {
    const t = await seed();
    const { app } = open(t, 'boards');
    await waitForFrame(app, 'Website web · WEB (current)');
    expect(app.lastFrame()).toContain('enter open · v view board');
    // Boards are listed by id: api, then web.
    await app.press('j', KEYS.enter);
    const frame = await waitForFrame(app, 'Key prefix');
    expect(frame).toMatch(/Board\s+acme\/web/);
    expect(frame).toMatch(/Name\s+Website/);
    expect(frame).toMatch(/Key prefix\s+WEB/);
    expect(frame).toContain('The public site');
    expect(frame).toContain('Stages (from board)');
    expect(frame).toContain('● Todo todo · todo 2 Stories');
    expect(frame).toContain('● Done done · done 0 Stories');
    expect(frame).toContain('1 Story in unknown Stage "gone" (run Doctor)');
    expect(frame).toContain('Custom Fields (from global)');
    expect(frame).toContain('Size* size · select: s, m');
    expect(frame).toContain('v view board · o Stories · s stages · f fields');

    // `s` still opens the Board's Stages, as on the list.
    await app.press('s');
    await waitForFrame(app, (f) => f.includes('Website Stages') && f.includes('1. ● Todo'));
    app.unmount();
  });

  it('shows an inheriting Board with default Stages and no fields of its own', async () => {
    const t = await seed();
    const { app } = open(t, 'board-detail', { ref: api });
    const frame = await waitForFrame(app, 'Key prefix');
    expect(frame).toContain('Stages (from default)');
    expect(frame).toContain('● Backlog backlog · todo 1 Story');
    expect(frame).not.toContain('unknown Stage');
    app.unmount();
  });
});

describe('G2 effective configuration (config show)', () => {
  it('is reachable from the g palette and shows the Board in context with each source level', async () => {
    const t = await seed();
    await makeWorkspace(t.path, {
      id: 'labs',
      name: 'Labs',
      stages: [{ key: 'idea', name: 'Idea', category: 'todo' }],
    });
    const { app } = open(t, 'home', {}, { version: 1, workspace: 'labs', board: 'lab' });
    await waitForFrame(app, 'labs › lab › Board');
    await app.press('g');
    await waitForFrame(app, 'Config');
    // The first enter ends filtering, the second opens the highlighted destination.
    await app.press('/', ...'conf', KEYS.enter, KEYS.enter);
    const frame = await waitForFrame(app, 'Key prefix');
    expect(frame).toContain('labs › lab › Board › Config');
    expect(frame).toMatch(/Board\s+labs\/lab/);
    expect(frame).toContain('Stages (from workspace)');
    expect(frame).toContain('● Idea idea · todo 0 Stories');
    expect(frame).toContain('Custom Fields (from global)');
    app.unmount();
  });
});

describe('G3 all-Boards Stories list (stories list --all-boards)', () => {
  it('A toggles every Board of the Workspace, with a Board label on each row, and filters still apply', async () => {
    const t = await seed();
    const { app } = open(t, 'stories');
    await waitForFrame(app, 'WEB-1 Login');
    expect(app.lastFrame()).toContain('Board acme/web');
    expect(app.lastFrame()).not.toContain('API-1');
    expect(app.lastFrame()).toContain('A all Boards');

    await app.press('A');
    let frame = await waitForFrame(app, 'API-1 Tokens');
    expect(frame).toContain('All Boards in acme');
    expect(frame).toContain('A this Board only');
    // Each row carries its Board and that Board's Stage badge.
    expect(frame).toContain('api  API-1 Tokens ● Backlog P1');
    expect(frame).toContain('web  WEB-1 Login ● Todo P1');
    expect(frame).toContain('web  WEB-3 Lost ● gone?');
    expect(frame).not.toContain('LAB-');

    // Priorities: P1 across both Boards (stages, assignees, me, labels, priorities).
    await app.press('/', ...Array(4).fill(KEYS.down), KEYS.right, ' ', KEYS.enter);
    frame = await waitForFrame(app, (f) => f.includes('filters: P1') && !f.includes('WEB-2'));
    expect(frame).toContain('API-1 Tokens');
    expect(frame).toContain('WEB-1 Login');

    await app.press('A');
    frame = await waitForFrame(app, (f) => f.includes('Board acme/web') && !f.includes('API-1'));
    expect(frame).toContain('WEB-1 Login');
    app.unmount();
  });
});

describe('G4 viewing another Board or Workspace without changing the context', () => {
  it('v on the Boards list opens that board view and leaves local.json alone', async () => {
    const t = await seed();
    await createRepositories(t.root).localState.put(CONTEXT);
    const { app, ctx } = open(t, 'boards');
    await waitForFrame(app, 'Website web · WEB (current)');
    await app.press('v');
    const frame = await waitForFrame(app, (f) => f.includes('API-1') && f.includes('● Backlog (1)'));
    expect(frame).toContain('API acme/api · viewing only (context unchanged)');
    expect(frame).toContain('acme › web › Boards › Board');
    expect(ctx.local).toEqual(CONTEXT);
    expect(await localOnDisk(t)).toEqual(CONTEXT);

    // b still switches the context, and the board then follows it.
    await app.press('b');
    await waitForFrame(app, 'Website web');
    await app.press('j', KEYS.enter);
    await waitForFrame(app, (f) => f.includes('WEB-1') && !f.includes('viewing only'));
    expect(await localOnDisk(t)).toEqual(CONTEXT);
    await app.press('b');
    await waitForFrame(app, 'Website web (current)');
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('API-1'));
    expect(await localOnDisk(t)).toEqual({ version: 1, workspace: 'acme', board: 'api' });
    app.unmount();
  });

  it('the Board detail opens its Stories list without switching', async () => {
    const t = await seed();
    const { app, ctx } = open(t, 'board-detail', { ref: api });
    await waitForFrame(app, 'Key prefix');
    await app.press('o');
    const frame = await waitForFrame(app, 'API-1 Tokens');
    expect(frame).toContain('Board acme/api');
    expect(ctx.local).toEqual(CONTEXT);
    app.unmount();
  });

  it('v on the Workspaces list opens another Workspace, its Boards and Epics, without using it', async () => {
    const t = await seed();
    await createRepositories(t.root).localState.put(CONTEXT);
    const { app, ctx } = open(t, 'workspaces');
    await waitForFrame(app, 'labs Labs');
    expect(app.lastFrame()).toContain('v view without using');
    await app.press('j', 'v');
    await waitForFrame(app, /Boards\s+1/);
    expect(app.lastFrame()).toContain('labs (view)');
    expect(app.lastFrame()).not.toContain('Now using');

    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Workspace labs') && f.includes('Lab lab · LAB'));
    expect(app.lastFrame()).not.toContain('(current)');
    await app.press(KEYS.escape);
    await waitForFrame(app, 'manage the roster');
    await app.press('j', KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Open Epics in labs') && f.includes('Moonshot'));
    await app.press(KEYS.enter);
    await waitForFrame(app, /Epic\s+Moonshot \(moonshot\)/);

    expect(ctx.local).toEqual(CONTEXT);
    expect(await localOnDisk(t)).toEqual(CONTEXT);
    app.unmount();
  });
});

describe('G5 creating the global Data Root after one exists (init --global)', () => {
  async function tempHome(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'rowbly-home-'));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    return dir;
  }

  it('the Context screen offers it while ~/.rowbly is missing and runs the init form', async () => {
    const t = await seed();
    const home = await tempHome();
    const globalPath = join(home, '.rowbly');
    const { app, ctx } = open(t, 'context', { home });
    await waitForFrame(app, `Create global Data Root ${globalPath}`);
    // acme, labs, then the new entry.
    await app.press('j', 'j', KEYS.enter);
    await waitForFrame(app, `Create ${globalPath}`);
    await app.press(...'solo', KEYS.down, ...'Solo', KEYS.down, ...'notes', KEYS.enter);
    await waitForFrame(app, (f) => f.includes(`Created ${globalPath}`) && f.includes('Switch Workspace'));

    const global = createRepositories({ path: globalPath, kind: 'global' });
    expect(await global.boards.get({ workspaceId: 'solo', boardId: 'notes' })).toMatchObject({ keyPrefix: 'NOTES' });
    expect(await global.localState.get()).toEqual({ version: 1, workspace: 'solo', board: 'notes' });
    // The app stays on the current Data Root and context.
    expect(ctx.root).toEqual(t.root);
    expect(await localOnDisk(t)).toEqual({ version: 1 });
    expect(app.lastFrame()).toContain('acme › web');
    // Now that it exists, it is no longer offered (rechecked on return).
    await waitForFrame(app, (f) => !f.includes('Create global Data Root'));
    app.unmount();
  });
});
