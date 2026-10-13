import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import type { RouteParams } from '../../src/tui/router';
import { relativeTime } from '../../src/tui/screens/comments/CommentsPanel';
import { fixedClock, fixedIds, makeBoard, makeStory, makeWorkspace, type TempRoot, tempRoot } from '../helpers';
import { KEYS, renderTui, tick, waitForFrame } from './helpers';

const web = { workspaceId: 'acme', boardId: 'web' };

async function setup() {
  const t = await tempRoot();
  await makeWorkspace(t.path, { id: 'acme', assignees: [{ handle: 'alice', name: 'Alice' }] });
  await makeBoard(t.path, { ...web, id: 'web', keyPrefix: 'WEB' });
  await makeStory(t.path, { ...web, key: 'WEB-1', name: 'Login', assignees: ['alice'] });
  return t;
}

/** The real App over a temp Data Root, opened on `screen`, with Me set to alice. */
async function open(t: TempRoot, screen: string, params: RouteParams = {}) {
  const toasts = createToastStore();
  const clock = fixedClock();
  const ctx: RowblyContext = {
    root: t.root,
    local: { version: 1 },
    me: 'alice',
    now: clock.now,
    newId: fixedIds(),
    warn: (message) => toasts.push('warning', message),
  };
  const services = createServices(ctx);
  const app = renderTui(<App ctx={ctx} services={services} initial={{ screen, params }} toasts={toasts} />);
  await waitForFrame(app, (frame) => !frame.includes('Loading'));
  return { app, services, clock };
}

const story = (t: TempRoot) => createRepositories(t.root).stories.findByKey('WEB-1');

let dir: string;
const saved = { EDITOR: process.env.EDITOR, VISUAL: process.env.VISUAL };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rowbly-editor-'));
  const script = join(dir, 'editor.sh');
  // Appends a line to whatever the panel handed in.
  await writeFile(script, '#!/bin/sh\nprintf "%s\\nfrom the editor" "$(cat "$1")" > "$1"\n');
  await chmod(script, 0o755);
  process.env.EDITOR = script;
  delete process.env.VISUAL;
});

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dir, { recursive: true, force: true });
});

describe('story detail Tasks tab', () => {
  it('adds a Task, moves its Stage and deletes it', async () => {
    const t = await setup();
    const { app } = await open(t, 'story', { key: 'WEB-1' });
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('No Tasks yet. Press n to create one.'));

    await app.press('n');
    await waitForFrame(app, (f) => f.includes('New Task on WEB-1'));
    await tick(50);
    await app.press(...'Write tests', KEYS.enter);
    await waitForFrame(app, (f) => f.includes('WEB-1.1 Write tests ● Backlog'));
    expect((await story(t)).tasks).toMatchObject([{ id: 'WEB-1.1', name: 'Write tests', stage: 'backlog' }]);

    await app.press('m');
    await waitForFrame(app, (f) => f.includes('Move WEB-1.1 to'));
    await app.press(KEYS.down, KEYS.down, KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Moved WEB-1.1 to in-progress') && f.includes('● In Progress'));
    const moved = await story(t);
    expect(moved.tasks[0]?.stage).toBe('in-progress');
    expect(moved.stage).toBe('backlog');

    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete WEB-1.1'));
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted WEB-1.1') && f.includes('No Tasks yet'));
    expect(await createRepositories(t.root).stories.findByKey('WEB-1')).toMatchObject({ tasks: [], nextTaskNumber: 2 });
    app.unmount();
  });

  it('edits a Task and opens its detail with inherited Assignees and Comments', async () => {
    const t = await setup();
    const { app, services } = await open(t, 'story', { key: 'WEB-1' });
    await services.tasks.create('WEB-1', { name: 'Old' });
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('WEB-1.1 Old'));
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Edit WEB-1.1'));
    await tick(50);
    await app.press(KEYS.backspace, KEYS.backspace, KEYS.backspace, ...'New', KEYS.enter);
    await waitForFrame(app, (f) => f.includes('WEB-1.1 New') && f.includes('Updated WEB-1.1'));

    await app.press(KEYS.enter);
    await waitForFrame(
      app,
      (f) => f.includes('alice (from the Story)') && f.includes('No Comments yet. Press c to add one.'),
    );
    await app.press('c');
    await waitForFrame(app, (f) => f.includes('Added Comment'));
    expect((await story(t)).tasks[0]?.comments).toMatchObject([{ author: 'alice', body: 'from the editor' }]);
    expect((await story(t)).comments).toEqual([]);
    app.unmount();
  });
});

describe('CommentsPanel', () => {
  it('adds, edits and deletes a Comment from the story detail tabs', async () => {
    const t = await setup();
    const { app, clock } = await open(t, 'story', { key: 'WEB-1' });
    await app.press(KEYS.tab, KEYS.tab);
    await waitForFrame(app, (f) => f.includes('No Comments yet'));

    await app.press('c');
    await waitForFrame(app, (f) => f.includes('Added Comment') && f.includes('alice · just now'));
    expect(app.lastFrame()).toContain('from the editor');
    expect((await story(t)).comments).toMatchObject([{ id: 'id000001', author: 'alice', body: 'from the editor' }]);

    clock.advance(5 * 60_000);
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Updated Comment') && f.includes('alice · 5m ago (edited)'));
    expect((await story(t)).comments[0]?.body).toBe('from the editor\nfrom the editor');

    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete the Comment by alice?'));
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted Comment') && f.includes('No Comments yet'));
    const after = await story(t);
    expect(after.comments).toEqual([]);
    expect(after.name).toBe('Login');
    app.unmount();
  });

  it('formats relative times', () => {
    const now = new Date('2026-10-12T17:21:07.000Z');
    expect(relativeTime('2026-10-12T17:21:00.000Z', now)).toBe('just now');
    expect(relativeTime('2026-10-12T14:21:07.000Z', now)).toBe('3h ago');
    expect(relativeTime('2026-10-10T17:21:07.000Z', now)).toBe('2d ago');
    expect(relativeTime('2025-10-12T17:21:07.000Z', now)).toBe('1y ago');
  });
});
