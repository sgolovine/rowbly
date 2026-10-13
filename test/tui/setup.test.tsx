import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { LocalState } from '../../src/schemas';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import { fixedClock, fixedIds, makeBoard, makeWorkspace, type TempRoot, tempRoot } from '../helpers';
import { KEYS, renderTui, waitForFrame } from './helpers';

async function emptyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rowbly-tui-setup-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** The real App over a temp Data Root, opened on `screen` with the given Local State. */
function renderApp(t: TempRoot, screen: string, local: LocalState = { version: 1 }) {
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
    await waitForFrame(app, 'Workspace id');
    expect(app.lastFrame()).toContain(`Create ${join(cwd, '.rowbly')}`);
    // Workspace id, name; Board id; Board name and prefix take their defaults.
    await app.press(...'acme', KEYS.down, ...'Acme', KEYS.down, ...'web', KEYS.enter);
    // The board view (WP09: home opens it when a Board is in context), with the new context in the header.
    await waitForFrame(app, 'acme › web › Board');

    const repos = createRepositories({ path: join(cwd, '.rowbly'), kind: 'local' });
    expect(await repos.boards.get({ workspaceId: 'acme', boardId: 'web' })).toMatchObject({
      name: 'web',
      keyPrefix: 'WEB',
    });
    expect(await repos.localState.get()).toEqual({ version: 1, workspace: 'acme', board: 'web' });
    expect(await readFile(join(cwd, '.rowbly', '.gitignore'), 'utf8')).toBe('local.json\n');
    app.unmount();
  });

  it('can initialize globally without a first Workspace', async () => {
    const cwd = await emptyDir();
    const home = await emptyDir();
    const app = renderTui(<App ctx={null} services={null} initial={{ screen: 'setup', params: { cwd, home } }} />);
    await waitForFrame(app, 'No Data Root found');
    await app.press('j', KEYS.enter);
    await waitForFrame(app, 'Workspace id');
    await app.press(KEYS.enter);
    await waitForFrame(app, 'Go to');
    await access(join(home, '.rowbly', 'rowbly.config.json'));
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
    expect(app.lastFrame()).not.toContain('Workspace id');
    expect(app.lastFrame()).toContain('No Data Root found');
    app.unmount();
  });
});

describe('context switcher', () => {
  async function twoWorkspaces() {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme', name: 'Acme', assignees: [{ handle: 'sam', name: 'Sam' }] });
    await makeWorkspace(t.path, { id: 'labs', name: 'Labs' });
    await makeBoard(t.path, { id: 'api', workspaceId: 'acme', keyPrefix: 'API' });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    return t;
  }

  it('switches Boards from the g palette', async () => {
    const t = await twoWorkspaces();
    const { app, ctx } = renderApp(t, 'home', { version: 1, workspace: 'acme', board: 'api' });
    await waitForFrame(app, 'acme › api › Board');
    await app.press('g');
    // Context is the last palette entry.
    await app.press(...Array(8).fill('j'), KEYS.enter);
    await waitForFrame(app, 'acme *');
    expect(app.lastFrame()).toContain('Switch Workspace');

    await app.press(KEYS.enter);
    await waitForFrame(app, 'api *');
    expect(app.lastFrame()).toContain('Switch Board in acme');
    await app.press('j', KEYS.enter);
    await waitForFrame(app, 'web acme/web');

    expect(ctx.local).toEqual({ version: 1, workspace: 'acme', board: 'web' });
    expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, workspace: 'acme', board: 'web' });
    expect(app.lastFrame()).toContain('Now using acme/web');
    // The board view at the root follows the new context (WP09).
    expect(app.lastFrame()).toContain('acme › web › Board');
    expect(app.lastFrame()).toContain('web acme/web');
    app.unmount();
  });

  it('a Workspace without Boards is used directly', async () => {
    const t = await twoWorkspaces();
    const { app, ctx } = renderApp(t, 'context');
    await waitForFrame(app, 'labs');
    await app.press('j', KEYS.enter);
    await waitForFrame(app, 'Now using labs');
    expect(ctx.local).toEqual({ version: 1, workspace: 'labs' });
    expect(app.lastFrame()).toContain('Now using labs');
    app.unmount();
  });

  it('the whoami picker lists the roster and claims a handle', async () => {
    const t = await twoWorkspaces();
    const { app, ctx } = renderApp(t, 'home', { version: 1, workspace: 'acme' });
    await waitForFrame(app, 'Go to');
    await app.press('g', ...Array(8).fill('j'), KEYS.enter);
    await waitForFrame(app, 'acme *');
    await app.press('m');
    await waitForFrame(app, 'sam Sam');
    expect(app.lastFrame()).toContain('Me: not set');
    expect(app.lastFrame()).toContain('Roster of acme');
    await app.press(KEYS.enter);
    await waitForFrame(app, 'me: sam');
    expect(ctx.me).toBe('sam');
    expect(await createRepositories(t.root).localState.get()).toEqual({ version: 1, workspace: 'acme', me: 'sam' });
    expect(app.lastFrame()).toContain('me: sam');
    app.unmount();
  });
});
