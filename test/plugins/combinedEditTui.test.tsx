// ARCH-43 in the TUI: the Story and Task forms submit an edit and a Stage change as one operation.
import { describe, expect, it } from 'vitest';
import { type Change, type DeepReadonly, definePlugin } from '../../src/plugin-api';
import type { Story } from '../../src/schemas';
import { makeStory } from '../helpers';
import { KEYS, waitForFrame } from '../tui/helpers';
import { notes } from './fixtures';
import { pluginRoot, readJsonFile, storyFile } from './helpers';
import { focusFormField, openPluginApp } from './tuiHelpers';

const OPS = ['stories.update', 'stories.move', 'tasks.update', 'tasks.move'] as const;
const reacted: string[] = [];

type Changes = { changes: readonly DeepReadonly<Change>[] };

/** Whether the Story, or one of its Tasks, enters the `done` Stage. */
function entersDone({ changes }: Changes): boolean {
  return changes.some((c) => {
    if (c.type !== 'story' || !c.before || !c.after) return false;
    if (c.before.stage !== 'done' && c.after.stage === 'done') return true;
    return c.after.tasks.some(
      (t) => t.stage === 'done' && c.before?.tasks.find((b) => b.id === t.id)?.stage !== 'done',
    );
  });
}

/** Rejects a Stage transition into `done`, and records each reaction. */
const gate = definePlugin({
  id: 'gate',
  name: 'Gate',
  description: '',
  hooks: Object.fromEntries(
    OPS.map((op) => [
      op,
      {
        guard: ({ changes }: { changes: Changes }) => (entersDone(changes) ? { reject: 'not done yet' } : undefined),
        react: () => void reacted.push(op),
      },
    ]),
  ),
});

/** WEB-1 in `backlog` with a Note, a Task and an unknown Plugin's bag; WEB-2 already in `todo`. */
async function setup() {
  reacted.length = 0;
  const t = await pluginRoot({ notes: true, gate: true });
  await makeStory(t.path, {
    boardId: 'web',
    key: 'WEB-1',
    name: 'Old',
    rank: 'a5',
    nextTaskNumber: 2,
    tasks: [
      {
        id: 'WEB-1.1',
        name: 'Task',
        description: '',
        stage: 'backlog',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    plugins: { notes: { note: 'old' }, ghost: { kept: true } },
  });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-2', stage: 'todo', rank: 'a3' });
  return t;
}

/** Edits the name, the Note and the Stage (`rights` steps along the Stage select), then submits. */
async function editStory(t: Awaited<ReturnType<typeof setup>>, rights: number) {
  const { app } = await openPluginApp(t, [notes, gate], { screen: 'story-form', params: { key: 'WEB-1' } });
  await waitForFrame(app, (f) => f.includes('Edit WEB-1') && f.includes('Note'));
  await app.press(KEYS.end, ' new');
  await focusFormField(app, 'Stage');
  await app.press(...Array(rights).fill(KEYS.right));
  await focusFormField(app, 'Note');
  await app.press(KEYS.end, '!', KEYS.ctrlS);
  return app;
}

describe('Story form (ARCH-43)', () => {
  it('a rejecting Stage-transition guard saves none of the edit', async () => {
    const t = await setup();
    const before = await readJsonFile(t, storyFile('WEB-1'));
    const app = await editStory(t, 3);
    await waitForFrame(app, 'not done yet');
    expect(await readJsonFile(t, storyFile('WEB-1'))).toEqual(before);
    expect(reacted).toEqual([]);
    app.unmount();
  });

  it('saves the edit and the Stage once, at the bottom of the destination Stage', async () => {
    const t = await setup();
    const app = await editStory(t, 1);
    await waitForFrame(app, 'Updated WEB-1');
    const saved = await readJsonFile(t, storyFile('WEB-1'));
    expect(saved).toMatchObject({ name: 'Old new', stage: 'todo' });
    expect(String(saved.rank) > 'a3').toBe(true);
    expect(saved.plugins).toEqual({ notes: { note: 'old!' }, ghost: { kept: true } });
    await waitForFrame(app, () => reacted.length > 0);
    expect(reacted).toEqual(['stories.update']);
    app.unmount();
  });

  it('an unchanged Stage keeps the Rank', async () => {
    const t = await setup();
    const app = await editStory(t, 0);
    await waitForFrame(app, 'Updated WEB-1');
    expect(await readJsonFile(t, storyFile('WEB-1'))).toMatchObject({ name: 'Old new', stage: 'backlog', rank: 'a5' });
    app.unmount();
  });
});

describe('Task form (ARCH-43)', () => {
  async function editTask(t: Awaited<ReturnType<typeof setup>>, rights: number) {
    const { app } = await openPluginApp(t, [notes, gate], { screen: 'task-form', params: { id: 'WEB-1.1' } });
    await waitForFrame(app, (f) => f.includes('Edit WEB-1.1') && f.includes('Name*'));
    await app.press(KEYS.end, ' new');
    await focusFormField(app, 'Stage');
    await app.press(...Array(rights).fill(KEYS.right), KEYS.ctrlS);
    return app;
  }

  it('a rejecting Stage-transition guard saves none of the edit', async () => {
    const t = await setup();
    const before = await readJsonFile(t, storyFile('WEB-1'));
    const app = await editTask(t, 3);
    await waitForFrame(app, 'not done yet');
    expect(await readJsonFile(t, storyFile('WEB-1'))).toEqual(before);
    expect(reacted).toEqual([]);
    app.unmount();
  });

  it('saves the edit and the Stage in one operation', async () => {
    const t = await setup();
    const app = await editTask(t, 2);
    await waitForFrame(app, 'Updated WEB-1.1');
    const saved = (await readJsonFile(t, storyFile('WEB-1'))) as unknown as Story;
    expect(saved.tasks[0]).toMatchObject({ name: 'Task new', stage: 'in-progress' });
    await waitForFrame(app, () => reacted.length > 0);
    expect(reacted).toEqual(['tasks.update']);
    app.unmount();
  });
});
