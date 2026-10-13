import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { LocalState } from '../../src/schemas';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { fixedClock, fixedIds, makeBoard, makeRootConfig, type TempRoot, tempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from './helpers';

async function emptyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rowbly-tui-setup-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** The real App over a temp Data Root, opened on `screen` with the given Local State. */
function renderApp(
  t: TempRoot,
  screen: string,
  local: LocalState = { version: 1 },
  params: Record<string, unknown> = {},
) {
  const toasts = createToastStore();
  const ctx: RowblyContext = {
    root: t.root,
    local,
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => toasts.push('warning', message),
  };
  const app = renderTui(<App ctx={ctx} services={createServices(ctx)} initial={{ screen, params }} toasts={toasts} />);
  return { app, ctx };
}

describe('setup screen (first run)', () => {
  it('initializes in the cwd through the form and opens the app on the new Data Root', async () => {
    const cwd = await emptyDir();
    const home = await emptyDir();
    const app = renderTui(<App ctx={null} services={null} initial={{ screen: 'setup', params: { cwd, home } }} />);
    await waitForFrame(app, 'No Data Root found');
    expect(app.lastFrame()).toContain(join(cwd, '.rowbly'));
    expect(app.lastFrame()).toContain(join(home, '.rowbly'));

    await app.press(KEYS.enter);
    await waitForFrame(app, 'Board id');
    expect(app.lastFrame()).toContain(`Create ${join(cwd, '.rowbly')}`);
    expect(app.lastFrame()).toContain('Leave the Board id empty to skip the first Board.');
    expect(app.lastFrame()).not.toContain('Workspace');
    // Board id; Board name and prefix take their defaults.
    await app.press(...'web', KEYS.enter);
    // The board view (WP09: home opens it when a Board is in context), with the new context in the sidebar.
    await waitForFrame(app, (f) => f.includes('▌ 1 web') && f.includes('● Backlog (0)'));

    const repos = createRepositories({ path: join(cwd, '.rowbly'), kind: 'local' });
    expect(await repos.boards.get('web')).toMatchObject({ name: 'web', keyPrefix: 'WEB' });
    expect(await repos.localState.get()).toEqual({ version: 1, board: 'web' });
    expect(await readFile(join(cwd, '.rowbly', '.gitignore'), 'utf8')).toBe('local.json\n');
    app.unmount();
  });

  it('can initialize globally without a first Board', async () => {
    const cwd = await emptyDir();
    const home = await emptyDir();
    const app = renderTui(<App ctx={null} services={null} initial={{ screen: 'setup', params: { cwd, home } }} />);
    await waitForFrame(app, 'No Data Root found');
    await app.press('j', KEYS.enter);
    await waitForFrame(app, 'Board id');
    await app.press(KEYS.enter);
    await waitForFrame(app, 'Go to');
    await access(join(home, '.rowbly', 'rowbly.config.json'));
    await expect(access(join(home, '.rowbly', 'boards'))).rejects.toThrow();
    await expect(access(join(cwd, '.rowbly'))).rejects.toThrow();
    app.unmount();
  });

  it('refuses an existing target before showing the form', async () => {
    const t = await tempRoot();
    const app = renderTui(
      <App ctx={null} services={null} initial={{ screen: 'setup', params: { cwd: t.dir, home: t.dir } }} />,
    );
    await waitForFrame(app, 'No Data Root found');
    await app.press(KEYS.enter);
    await waitForFrame(app, 'Data Root already exists');
    expect(app.lastFrame()).not.toContain('Board id');
    expect(app.lastFrame()).toContain('No Data Root found');
    app.unmount();
  });
});

describe('context switcher', () => {
  async function twoBoards() {
    const t = await tempRoot();
    await makeRootConfig(t.path, { assignees: [{ handle: 'sam', name: 'Sam' }] });
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    return t;
  }

  it('switches Boards from the g palette', async () => {
    const t = await twoBoards();
    const { app, ctx } = renderApp(t, 'home', { version: 1, board: 'api' });
    await waitForFrame(app, (f) => f.includes('▌ 1 api') && f.includes('● Backlog (0)'));
    await app.press('g');
    // Context is the second-to-last palette entry.
    await app.press(...Array(7).fill('j'), KEYS.enter);
    await waitForFrame(app, 'api *');
    expect(app.lastFrame()).toContain('Switch Board');
    expect(app.lastFrame()).toContain('web web (WEB)');

    await app.press('j', KEYS.enter);
    await waitForFrame(app, 'Now using web');

    expect(ctx.local).toEqual({ version: 1, board: 'web' });
    expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, board: 'web' });
    // The board view at the root follows the new context (WP09).
    await waitForFrame(app, 'web web');
    expect(app.lastFrame()).toContain('▌ 2 web');
    app.unmount();
  });

  it('c clears the current Board', async () => {
    const t = await twoBoards();
    const { app, ctx } = renderApp(t, 'context', { version: 1, board: 'api', me: 'sam' });
    await waitForFrame(app, 'api *');
    await app.press('c');
    await waitForFrame(app, 'Cleared the current Board');
    expect(ctx.local).toEqual({ version: 1, me: 'sam' });
    // The header reads `ctx.me`, which is set before Local State is written.
    await vi.waitFor(async () =>
      expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, me: 'sam' }),
    );
    app.unmount();
  });

  it('says how to start when there are no Boards', async () => {
    const t = await tempRoot();
    // A home that already has `.rowbly`, so the picker does not offer to create the global Data Root.
    const { app } = renderApp(t, 'context', { version: 1 }, { home: t.dir });
    await waitForFrame(app, 'No Boards yet. Create one from Boards.');
    expect(app.lastFrame()).toContain('Switch Board');
    expect(app.lastFrame()).not.toContain('Create global Data Root');
    app.unmount();
  });

  it('the whoami picker lists the roster and claims a handle', async () => {
    const t = await twoBoards();
    const { app, ctx } = renderApp(t, 'home');
    await waitForFrame(app, 'Go to');
    await app.press('g', ...Array(7).fill('j'), KEYS.enter);
    await waitForFrame(app, 'Switch Board');
    await app.press('m');
    await waitForFrame(app, 'sam Sam');
    expect(app.lastFrame()).toContain('Me: not set');
    expect(app.lastFrame()).toContain('Roster');
    await app.press(KEYS.enter);
    await waitForFrame(app, 'me: sam');
    expect(ctx.me).toBe('sam');
    // The header reads `ctx.me`, which is set before Local State is written.
    await vi.waitFor(async () =>
      expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, me: 'sam' }),
    );
    expect(app.lastFrame()).toContain('me: sam');
    app.unmount();
  });
});
