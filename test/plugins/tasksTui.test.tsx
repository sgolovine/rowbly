import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tasks } from '../../src/plugins/tasks';
import { TasksBag } from '../../src/plugins/tasks/model';
import { createTask } from '../../src/plugins/tasks/tasks';
import { createRepositories } from '../../src/storage';
import type { Route } from '../../src/tui/router';
import { fixedClock, makeStory, type TempRoot } from '../helpers';
import { KEYS, waitForFrame } from '../tui/helpers';
import { pluginRoot, storyFile, withPlugins } from './helpers';
import { openPluginApp } from './tuiHelpers';

async function setup() {
  const t = await pluginRoot({ tasks: true });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login', assignees: ['alice'] });
  return t;
}

/** Creates Tasks in WEB-1 before the App opens. */
async function seed(t: TempRoot, ...list: { name: string; stage?: string }[]) {
  const plugin = (await withPlugins(t, [tasks])).services.plugins.context('tasks');
  for (const input of list) await createTask(plugin, 'WEB-1', input);
}

/** The App with the Tasks Plugin on and Me set to alice, opened on `route`. */
async function open(t: TempRoot, route: Route) {
  const opened = await openPluginApp(t, [tasks], route, { me: 'alice', now: fixedClock().now });
  return opened;
}

/** The Story screen, with its Tasks tab selected and loaded. */
async function openTasksTab(t: TempRoot, ready: string) {
  const opened = await open(t, { screen: 'story', params: { key: 'WEB-1' } });
  await waitForFrame(opened.app, (f) => f.includes('move Stage') && f.includes('Login'));
  await opened.app.press(KEYS.tab);
  await waitForFrame(opened.app, (f) => f.includes(ready) && f.includes('new Task'));
  return opened;
}

const bag = async (t: TempRoot) => {
  const raw = (await createRepositories(t.root).stories.findByKey('WEB-1')).plugins?.tasks;
  return raw === undefined ? undefined : TasksBag.parse(raw);
};

describe('story detail Tasks tab', () => {
  it('adds a Task, moves its Stage and deletes it', async () => {
    const t = await setup();
    const { app } = await openTasksTab(t, 'No Tasks yet. Press n to create one.');

    await app.press('n');
    // The breadcrumb shows the title while the form loads; wait for the form itself.
    await waitForFrame(app, (f) => f.includes('New Task on WEB-1') && f.includes('Name*'));
    await app.press(...'Write tests', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('WEB-1.1 Write tests ● Backlog') && f.includes('move Task'));
    expect((await bag(t))?.tasks).toMatchObject([{ number: 1, name: 'Write tests', stage: 'backlog' }]);

    await app.press('m');
    await waitForFrame(app, (f) => f.includes('Move WEB-1.1 to'));
    await app.press(KEYS.down, KEYS.down, KEYS.enter);
    await waitForFrame(app, (f) => f.includes('Moved WEB-1.1 to in-progress') && f.includes('● In Progress'));
    expect((await bag(t))?.tasks[0]?.stage).toBe('in-progress');
    expect((await createRepositories(t.root).stories.findByKey('WEB-1')).stage).toBe('backlog');

    await waitForFrame(app, (f) => f.includes('delete Task'));
    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete WEB-1.1'));
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted WEB-1.1') && f.includes('No Tasks yet'));
    expect(await bag(t)).toEqual({ nextNumber: 2, tasks: [] });
  });

  it('edits a Task and opens its detail with inherited Assignees', async () => {
    const t = await setup();
    await seed(t, { name: 'Old' });
    const { app } = await openTasksTab(t, 'WEB-1.1 Old');
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Edit WEB-1.1') && f.includes('Name*'));
    await app.press(KEYS.backspace, KEYS.backspace, KEYS.backspace, ...'New', KEYS.ctrlEnter);
    await waitForFrame(
      app,
      (f) => f.includes('WEB-1.1 New') && f.includes('Updated WEB-1.1') && f.includes('open Task'),
    );

    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('alice (from the Story)'));
  });

  it('shows an invalid Tasks bag as unavailable', async () => {
    const t = await setup();
    const path = join(t.path, storyFile('WEB-1'));
    const raw = JSON.parse(await readFile(path, 'utf8'));
    raw.plugins = { tasks: { tasks: 'none' } };
    await writeFile(path, JSON.stringify(raw));
    const { app } = await open(t, { screen: 'story', params: { key: 'WEB-1' } });
    await waitForFrame(app, (f) => f.includes('move Stage') && f.includes('Login'));
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('Tasks unavailable'));
  });
});

describe('task detail', () => {
  it('edits, moves and deletes the Task with e, m and d, like the Tasks tab', async () => {
    const t = await setup();
    await seed(t, { name: 'Old' });
    const tab = await openTasksTab(t, 'WEB-1.1 Old');
    await tab.app.press(KEYS.enter);
    await waitForFrame(tab.app, (f) => f.includes('alice (from the Story)'));
    expect(tab.app.lastFrame()).toContain('e edit · m move Stage · d delete');

    await tab.app.press('e');
    await waitForFrame(tab.app, (f) => f.includes('Edit WEB-1.1') && f.includes('Name*'));
    await tab.app.press(KEYS.backspace, KEYS.backspace, KEYS.backspace, ...'New', KEYS.ctrlEnter);
    await waitForFrame(
      tab.app,
      (f) => f.includes('WEB-1.1 New') && f.includes('Updated WEB-1.1') && f.includes('move Stage'),
    );
    expect((await bag(t))?.tasks[0]?.name).toBe('New');

    await tab.app.press('m');
    await waitForFrame(tab.app, (f) => f.includes('Move WEB-1.1 to'));
    await tab.app.press(KEYS.down, KEYS.down, KEYS.enter);
    await waitForFrame(tab.app, (f) => f.includes('Moved WEB-1.1 to in-progress') && f.includes('● In Progress'));
    expect((await bag(t))?.tasks[0]?.stage).toBe('in-progress');

    await waitForFrame(tab.app, (f) => f.includes('d delete'));
    await tab.app.press('d');
    await waitForFrame(tab.app, (f) => f.includes('Delete WEB-1.1 "New"?'));
    await tab.app.press('n');
    await waitForFrame(tab.app, (f) => !f.includes('Delete WEB-1.1') && f.includes('d delete'));
    expect((await bag(t))?.tasks).toHaveLength(1);
    await tab.app.press('d');
    await waitForFrame(tab.app, (f) => f.includes('Delete WEB-1.1'));
    await tab.app.press('y');
    // Back on the Story's Tasks tab.
    await waitForFrame(tab.app, (f) => f.includes('Deleted WEB-1.1') && f.includes('No Tasks yet'));
    expect((await bag(t))?.tasks).toEqual([]);
  });
});

describe('board card', () => {
  it('shows ✓ done/total for a Story with Tasks', async () => {
    const t = await setup();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', name: 'Signup', rank: 'a1' });
    await seed(t, { name: 'One' }, { name: 'Two', stage: 'done' });
    const { app } = await open(t, { screen: 'board', params: { boardId: 'web' } });
    await waitForFrame(app, (f) => f.includes('Signup') && f.includes('✓ 1/2'));
    expect(app.lastFrame()?.match(/✓/g)).toHaveLength(1);
  });
});
