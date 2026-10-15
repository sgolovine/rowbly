// ARCH-43: a Story or Task edit that also changes Stage is one operation, so it commits or rejects as a whole.
import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../../src/core';
import { type Change, type DeepReadonly, definePlugin } from '../../src/plugin-api';
import { makeStory } from '../helpers';
import { notes } from '../plugins/fixtures';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from '../plugins/helpers';

const web = { boardId: 'web' };
const OPS = ['stories.update', 'stories.move', 'tasks.update', 'tasks.move'] as const;

type Changes = { changes: readonly DeepReadonly<Change>[] };

/** The Story changes whose Stage, or one of whose Tasks' Stage, goes to `done`. */
function entersDone({ changes }: Changes): boolean {
  return changes.some((c) => {
    if (c.type !== 'story' || !c.before || !c.after) return false;
    if (c.before.stage !== 'done' && c.after.stage === 'done') return true;
    return c.after.tasks.some(
      (t) => t.stage === 'done' && c.before?.tasks.find((b) => b.id === t.id)?.stage !== 'done',
    );
  });
}

/** Rejects any Stage transition into `done`, through whichever operation makes it. */
const gate = definePlugin({
  id: 'gate',
  name: 'Gate',
  description: '',
  hooks: Object.fromEntries(
    OPS.map((op) => [
      op,
      { guard: ({ changes }: { changes: Changes }) => (entersDone(changes) ? { reject: 'not done yet' } : undefined) },
    ]),
  ),
});

/** Counts reactions per operation. */
function counter() {
  const reacted: string[] = [];
  const plugin = definePlugin({
    id: 'counter',
    name: 'Counter',
    description: '',
    hooks: Object.fromEntries(OPS.map((op) => [op, { react: () => void reacted.push(op) }])),
  });
  return { plugin, reacted };
}

/** WEB-1 in `backlog` with a Note, a Task and an unknown Plugin's bag; WEB-2 and WEB-3 already in `todo`. */
async function setup() {
  const t = await pluginRoot({ notes: true, gate: true, counter: true });
  await makeStory(t.path, {
    ...web,
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
    plugins: { notes: { note: 'old' }, ghost: { kept: true, extra: [1] } },
  });
  await makeStory(t.path, { ...web, key: 'WEB-2', stage: 'todo', rank: 'a1' });
  await makeStory(t.path, { ...web, key: 'WEB-3', stage: 'todo', rank: 'a3' });
  const count = counter();
  const setup = await withPlugins(t, [notes, gate, count.plugin]);
  return { t, ...setup, reacted: count.reacted };
}

describe('stories.update with a Stage (ARCH-43)', () => {
  it('a rejecting Stage-transition guard keeps the name, Plugin bags and Stage unchanged', async () => {
    const { t, services, reacted } = await setup();
    const before = await readJsonFile(t, storyFile('WEB-1'));
    await expect(
      services.stories.update('WEB-1', { name: 'New', stage: 'done', plugins: { notes: { note: 'new' } } }),
    ).rejects.toThrow(ConflictError);
    expect(await readJsonFile(t, storyFile('WEB-1'))).toEqual(before);
    expect(reacted).toEqual([]);
  });

  it('saves and reacts once, moving the Story to the bottom of the destination Stage', async () => {
    const { t, services, reacted } = await setup();
    const saved = await services.stories.update('WEB-1', {
      name: 'New',
      stage: 'todo',
      plugins: { notes: { note: 'new' } },
    });
    expect(reacted).toEqual(['stories.update']);
    expect(saved).toMatchObject({ name: 'New', stage: 'todo' });
    expect(saved.rank > 'a3').toBe(true);
    const file = await readJsonFile(t, storyFile('WEB-1'));
    expect(file).toMatchObject({ name: 'New', stage: 'todo', rank: saved.rank });
    expect(file.plugins).toEqual({ notes: { note: 'new' }, ghost: { kept: true, extra: [1] } });
  });

  it('an unchanged Stage keeps the Rank', async () => {
    const { services } = await setup();
    expect(await services.stories.update('WEB-1', { name: 'New', stage: 'backlog' })).toMatchObject({
      stage: 'backlog',
      rank: 'a5',
    });
    expect((await services.stories.update('WEB-2', { name: 'Two' })).rank).toBe('a1');
    // A JSON caller's `null` is no Stage, as in `create`.
    const unset = { stage: null } as unknown as { stage: string };
    expect(await services.stories.update('WEB-3', unset)).toMatchObject({ stage: 'todo', rank: 'a3' });
    expect(await services.tasks.update('WEB-1.1', unset)).toMatchObject({ stage: 'backlog' });
  });

  it('moving through edit gives the same Stage and Rank as `move`', async () => {
    const viaEdit = await setup();
    const viaMove = await setup();
    const edited = await viaEdit.services.stories.update('WEB-1', { stage: 'todo' });
    const moved = await viaMove.services.stories.move('WEB-1', 'todo');
    expect({ stage: edited.stage, rank: edited.rank }).toEqual({ stage: moved.stage, rank: moved.rank });
    expect(await readJsonFile(viaEdit.t, storyFile('WEB-1'))).toEqual(
      await readJsonFile(viaMove.t, storyFile('WEB-1')),
    );
  });

  it('rejects an unknown Stage with the same error as `move`, saving nothing', async () => {
    const { t, services } = await setup();
    const before = await readJsonFile(t, storyFile('WEB-1'));
    const viaEdit = await services.stories.update('WEB-1', { name: 'New', stage: 'nope' }).catch((e) => e);
    const viaMove = await services.stories.move('WEB-1', 'nope').catch((e) => e);
    expect(viaEdit).toBeInstanceOf(ValidationError);
    expect(viaEdit.message).toBe('unknown Stage "nope"');
    expect({ details: viaEdit.details, hint: viaEdit.hint }).toEqual({ details: viaMove.details, hint: viaMove.hint });
    expect(await readJsonFile(t, storyFile('WEB-1'))).toEqual(before);
  });
});

describe('tasks.update with a Stage (ARCH-43)', () => {
  it('a rejecting Stage-transition guard keeps the Task name and Stage unchanged', async () => {
    const { t, services, reacted } = await setup();
    const before = await readJsonFile(t, storyFile('WEB-1'));
    await expect(services.tasks.update('WEB-1.1', { name: 'Renamed', stage: 'done' })).rejects.toThrow(ConflictError);
    expect(await readJsonFile(t, storyFile('WEB-1'))).toEqual(before);
    expect(reacted).toEqual([]);
  });

  it('saves and reacts once, like `move`', async () => {
    const viaEdit = await setup();
    const viaMove = await setup();
    const edited = await viaEdit.services.tasks.update('WEB-1.1', { name: 'Renamed', stage: 'in-progress' });
    expect(viaEdit.reacted).toEqual(['tasks.update']);
    expect(edited).toMatchObject({ name: 'Renamed', stage: 'in-progress' });
    await viaMove.services.tasks.update('WEB-1.1', { name: 'Renamed' });
    await viaMove.services.tasks.move('WEB-1.1', 'in-progress');
    expect(await readJsonFile(viaEdit.t, storyFile('WEB-1'))).toEqual(
      await readJsonFile(viaMove.t, storyFile('WEB-1')),
    );
  });

  it('rejects an unknown Stage with the same error as `move`', async () => {
    const { services } = await setup();
    const viaEdit = await services.tasks.update('WEB-1.1', { stage: 'nope' }).catch((e) => e);
    const viaMove = await services.tasks.move('WEB-1.1', 'nope').catch((e) => e);
    expect(viaEdit).toBeInstanceOf(ValidationError);
    expect({ message: viaEdit.message, details: viaEdit.details, hint: viaEdit.hint }).toEqual({
      message: viaMove.message,
      details: viaMove.details,
      hint: viaMove.hint,
    });
  });
});
