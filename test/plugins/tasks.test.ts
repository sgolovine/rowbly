import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConflictError, DataIntegrityError, NotFoundError, UsageError, ValidationError } from '../../src/core';
import { tasks } from '../../src/plugins/tasks';
import { type TasksBag as Bag, TasksBag } from '../../src/plugins/tasks/model';
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  moveTask,
  storedTasks,
  updateTask,
} from '../../src/plugins/tasks/tasks';
import { createRepositories } from '../../src/storage';
import { fixedClock, makeStory } from '../helpers';
import { pluginTestHost, storyFile } from './helpers';

async function setup() {
  const clock = fixedClock();
  const loaded = await pluginTestHost({ plugins: [tasks], now: clock.now });
  await makeStory(loaded.t.path, { boardId: 'web', key: 'WEB-1', assignees: [] });
  const plugin = loaded.context('tasks');
  const story = () => createRepositories(loaded.root).stories.findByKey('WEB-1');
  /** The saved Tasks bag of WEB-1. */
  const bag = async () => TasksBag.parse((await story()).plugins?.tasks);
  return { ...loaded, clock, plugin, story, bag };
}

const task = (number: number, stage: string) => ({
  number,
  name: `Task ${number}`,
  description: '',
  stage,
  createdAt: '2026-10-12T17:21:07.000Z',
  updatedAt: '2026-10-12T17:21:07.000Z',
});

describe('tasks.create', () => {
  it('numbers Tasks from nextNumber, never reusing a deleted id', async () => {
    const { plugin, bag } = await setup();
    for (const name of ['One', 'Two', 'Three']) await createTask(plugin, 'web-1', { name });
    await deleteTask(plugin, 'WEB-1.3');
    const fourth = await createTask(plugin, 'WEB-1', { name: 'Four' });
    expect(fourth.id).toBe('WEB-1.4');
    const saved = await bag();
    expect(saved.nextNumber).toBe(5);
    expect(saved.tasks.map((t) => t.number)).toEqual([1, 2, 4]);
  });

  it('defaults to the first effective Stage and stamps the Story', async () => {
    const { plugin, story, clock } = await setup();
    clock.advance(60_000);
    const created = await createTask(plugin, 'WEB-1', { name: 'Write tests' });
    expect(created).toEqual({
      id: 'WEB-1.1',
      number: 1,
      name: 'Write tests',
      description: '',
      stage: 'backlog',
      createdAt: '2026-10-12T17:22:07.000Z',
      updatedAt: '2026-10-12T17:22:07.000Z',
    });
    expect((await story()).updatedAt).toBe('2026-10-12T17:22:07.000Z');
  });

  it('rejects an unknown Stage and an empty name', async () => {
    const { plugin } = await setup();
    await expect(createTask(plugin, 'WEB-1', { name: 'X', stage: 'nope' })).rejects.toBeInstanceOf(ValidationError);
    const err = await createTask(plugin, 'WEB-1', { name: '' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details.issues).toEqual([expect.objectContaining({ path: ['name'] })]);
  });

  it('throws NotFoundError for an unknown Story', async () => {
    const { plugin } = await setup();
    await expect(createTask(plugin, 'WEB-9', { name: 'X' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('tasks mutations', () => {
  it('update and move stamp both the Task and the Story', async () => {
    const { plugin, story, bag, clock } = await setup();
    await createTask(plugin, 'WEB-1', { name: 'Old' });
    clock.advance(1000);
    const updated = await updateTask(plugin, 'web-1.1', { name: 'New', description: 'Body' });
    expect(updated).toMatchObject({ name: 'New', description: 'Body', updatedAt: '2026-10-12T17:21:08.000Z' });
    clock.advance(1000);
    const moved = await moveTask(plugin, 'WEB-1.1', 'done');
    expect(moved).toMatchObject({ id: 'WEB-1.1', stage: 'done', updatedAt: '2026-10-12T17:21:09.000Z' });
    expect((await story()).updatedAt).toBe('2026-10-12T17:21:09.000Z');
    const { id: _id, ...stored } = moved;
    expect((await bag()).tasks[0]).toEqual(stored);
  });

  it('move rejects a Stage not on the Board', async () => {
    const { plugin } = await setup();
    await createTask(plugin, 'WEB-1', { name: 'X' });
    const err = await moveTask(plugin, 'WEB-1.1', 'unknown-stage').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details.validStages).toEqual(['backlog', 'todo', 'in-progress', 'done']);
  });

  it('get, list and errors for unknown or malformed ids', async () => {
    const { plugin } = await setup();
    const created = await createTask(plugin, 'WEB-1', { name: 'X' });
    expect(await listTasks(plugin, 'WEB-1')).toEqual([created]);
    expect((await getTask(plugin, 'web-1.1')).task).toEqual(created);
    await expect(getTask(plugin, 'WEB-1.7')).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteTask(plugin, 'WEB-1.7')).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTask(plugin, 'WEB-1')).rejects.toBeInstanceOf(UsageError);
  });

  it('removes the Tasks of a deleted Story with it', async () => {
    const { plugin, services } = await setup();
    await createTask(plugin, 'WEB-1', { name: 'X' });
    await services.stories.remove('WEB-1');
    await expect(getTask(plugin, 'WEB-1.1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('an invalid Tasks bag', () => {
  async function invalid() {
    const setupResult = await setup();
    const path = join(setupResult.t.path, storyFile('WEB-1'));
    const raw = JSON.parse(await readFile(path, 'utf8'));
    raw.plugins = { tasks: { nextNumber: 'one', tasks: 'none' } };
    await writeFile(path, JSON.stringify(raw));
    return { ...setupResult, path };
  }

  it('shows as unavailable, never as empty', async () => {
    const { plugin, story } = await invalid();
    expect(storedTasks(plugin, await story())).toBeNull();
    expect(await tasks.storyRows?.(await story(), plugin)).toEqual([
      { label: 'Tasks', value: 'unavailable (invalid)' },
    ]);
  });

  it('refuses every change with DATA_INTEGRITY and keeps the stored bag', async () => {
    const { plugin, path } = await invalid();
    const before = await readFile(path, 'utf8');
    await expect(createTask(plugin, 'WEB-1', { name: 'X' })).rejects.toBeInstanceOf(DataIntegrityError);
    await expect(listTasks(plugin, 'WEB-1')).rejects.toBeInstanceOf(DataIntegrityError);
    expect(await readFile(path, 'utf8')).toBe(before);
  });
});

describe('stories show row', () => {
  it('counts Tasks in a done Stage', async () => {
    const { plugin, story } = await setup();
    await createTask(plugin, 'WEB-1', { name: 'One' });
    await createTask(plugin, 'WEB-1', { name: 'Two', stage: 'done' });
    const rows = await tasks.storyRows?.(await story(), plugin);
    expect(rows).toEqual([{ label: 'Tasks', value: '1/2 done' }]);
  });
});

describe('stages.remove', () => {
  it('refuses while Tasks use the Stage, asking for a Stage to move them to', async () => {
    const { plugin, services, bag } = await setup();
    await createTask(plugin, 'WEB-1', { name: 'One', stage: 'todo' });
    const err = await services.stages.remove({ level: 'global' }, 'todo', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).message).toBe('Stage "todo" is used by 1 Task');
    expect((err as ConflictError).details).toMatchObject({ tasks: 1, needsMoveTo: true, plugin: 'tasks' });
    expect((await services.stages.list('web')).stages.map((s) => s.key)).toContain('todo');
    expect((await bag()).tasks[0]?.stage).toBe('todo');
  });

  it('moves the Tasks with --move-to and warns how many moved', async () => {
    const { plugin, services, bag, warnings } = await setup();
    await createTask(plugin, 'WEB-1', { name: 'One', stage: 'todo' });
    await createTask(plugin, 'WEB-1', { name: 'Two', stage: 'done' });
    expect(await services.stages.remove({ level: 'global' }, 'todo', { moveTo: 'backlog' })).toEqual({
      storiesMoved: 0,
    });
    expect((await bag()).tasks.map((t) => t.stage)).toEqual(['backlog', 'done']);
    expect(warnings).toContain('moved 1 Task to backlog');
  });
});

describe('doctor', () => {
  async function withBag(value: Bag) {
    const loaded = await setup();
    const path = join(loaded.t.path, storyFile('WEB-1'));
    const raw = JSON.parse(await readFile(path, 'utf8'));
    raw.plugins = { tasks: value };
    await writeFile(path, JSON.stringify(raw));
    return loaded;
  }

  it('reports a Task in an unknown Stage', async () => {
    const { services } = await withBag({ nextNumber: 2, tasks: [task(1, 'gone')] });
    expect((await services.doctor.check()).findings).toEqual([
      expect.objectContaining({
        code: 'TASKS_UNKNOWN_STAGE',
        severity: 'error',
        message: 'WEB-1.1 is in unknown Stage "gone"',
        fixable: false,
      }),
    ]);
  });

  it('fixes a next Task number at or below the highest Task', async () => {
    const { services, bag } = await withBag({ nextNumber: 2, tasks: [task(1, 'todo'), task(3, 'todo')] });
    expect((await services.doctor.check()).findings).toEqual([
      expect.objectContaining({ code: 'TASKS_COUNTER_BEHIND', severity: 'warning', fixable: true }),
    ]);
    const report = await services.doctor.fix();
    expect(report.fixed.map((f) => f.message)).toEqual(['set WEB-1 next Task number to 4']);
    expect((await bag()).nextNumber).toBe(4);
    expect((await services.doctor.check()).findings).toEqual([]);
  });

  it('gives a renumbered Story Task Ids under its new key', async () => {
    const { t, plugin, services } = await setup();
    await createTask(plugin, 'WEB-1', { name: 'Kept' });
    const early = JSON.parse(await readFile(join(t.path, storyFile('WEB-1')), 'utf8'));
    // A later Story sits at WEB-1's path, while the earlier one was copied to WEB-2's path.
    const late = { ...early, name: 'Late', createdAt: '2026-10-13T00:00:00.000Z' };
    await writeFile(join(t.path, storyFile('WEB-1')), JSON.stringify(late));
    await mkdir(dirname(join(t.path, storyFile('WEB-2'))), { recursive: true });
    await writeFile(join(t.path, storyFile('WEB-2')), JSON.stringify(early));
    const report = await services.doctor.fix();
    expect(report.fixed.map((f) => f.message)).toContain('renumbered WEB-1 ("Late") to WEB-3');
    expect((await getTask(plugin, 'WEB-3.1')).task).toMatchObject({ id: 'WEB-3.1', name: 'Kept' });
  });
});
