import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, PluginError, ValidationError } from '../../src/core';
import { type Change, type DeepReadonly, definePlugin } from '../../src/plugin-api';
import { StorySchema } from '../../src/schemas';
import { pluginStoryRows } from '../../src/services';
import { pathExists } from '../../src/storage';
import { FIXED_NOW, makeStory, writeFixture } from '../helpers';
import { echo, faulty, notes, order, stamp, tracer } from './fixtures';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

/** A Plugin that keeps every Change Set it is shown, by stage. */
function spy(id = 'spy', ops: string[] = ['stories.move']) {
  const seen: { stage: string; name: string; changes: Change[] }[] = [];
  const record = (stage: string) => (e: { name: string; changes: { changes: readonly DeepReadonly<Change>[] } }) => {
    seen.push({ stage, name: e.name, changes: structuredClone([...e.changes.changes]) as Change[] });
    return undefined;
  };
  const hooks = Object.fromEntries(
    ops.map((op) => [op, { guard: record('guard'), react: record('react'), transform: record('transform') }]),
  );
  return { plugin: definePlugin({ id, name: id, description: '', hooks }), seen };
}

describe('transform (ADR-0012)', () => {
  it('writes Plugin input into the new Story in the same save, and the result shows it', async () => {
    const t = await pluginRoot({ notes: true });
    const { services } = await withPlugins(t, [notes]);
    const story = await services.stories.create('web', { name: 'Login', plugins: { notes: { note: 'hi' } } });
    expect(story.plugins).toEqual({ notes: { note: 'hi' } });
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({ notes: { note: 'hi' } });

    const edited = await services.stories.update('WEB-1', { plugins: { notes: { note: null } } });
    expect(edited).not.toHaveProperty('plugins');
    expect(await readJsonFile(t, storyFile('WEB-1'))).not.toHaveProperty('plugins');
  });

  it('invalid Plugin input fails the operation before the save; no input changes nothing', async () => {
    const t = await pluginRoot({ notes: true });
    const { services } = await withPlugins(t, [notes]);
    await expect(services.stories.create('web', { name: 'A', plugins: { notes: { note: 1 } } })).rejects.toThrow(
      'invalid Notes input',
    );
    expect(await services.stories.list('web', {})).toEqual([]);
    expect((await services.stories.create('web', { name: 'B' })).plugins).toBeUndefined();
  });

  it('runs before guards, which run before the save, which runs before reactions', async () => {
    const t = await pluginRoot({ tracer: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [tracer]);
    // `order` is shared by the whole file: every test that reads it empties it first.
    order.length = 0;
    await services.stories.move('WEB-1', 'todo');
    expect(order).toEqual(['transform:1', 'guard', 'react:todo']);
  });

  it('a thrown error fails the operation as INTERNAL, naming the Plugin; nothing is saved', async () => {
    const t = await pluginRoot({ faulty: true });
    const { services } = await withPlugins(t, [faulty]);
    const err = await services.boards.update('web', { name: 'Renamed' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginError);
    expect(err).toMatchObject({
      code: 'INTERNAL',
      exitCode: 1,
      message: 'Plugin "faulty" failed in the transform of boards.update: kaboom',
      hint: 'turn it off with `rowbly plugins disable faulty`',
      details: { plugin: 'faulty', operation: 'boards.update', stage: 'transform' },
    });
    expect((await services.boards.get('web')).name).toBe('Website');
  });
});

describe('guard', () => {
  it('rejects: nothing is saved and the error is a CONFLICT naming the Plugin', async () => {
    const t = await pluginRoot({ notes: { blocked: ['Nope'] } });
    const { services, warnings } = await withPlugins(t, [notes]);
    const err = await services.stories.create('web', { name: 'Nope' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({
      exitCode: 4,
      message: 'Notes refuses a Story named "Nope"',
      hint: 'pick another name',
      details: { plugin: 'notes' },
    });
    expect(await services.stories.list('web', {})).toEqual([]);
    // No reaction to an operation that did not happen.
    expect(warnings).toEqual([]);
  });

  it('sees the operation input, e.g. to refuse a Board deletion without --force', async () => {
    const t = await pluginRoot({ tracer: true });
    const { services } = await withPlugins(t, [tracer]);
    await expect(services.boards.remove('web', { force: false })).rejects.toThrow('Board "web" has tracer files');
    await services.boards.remove('web', { force: true });
    await expect(services.boards.get('web')).rejects.toThrow(NotFoundError);
  });

  it('sees the final Change Set, after every transform', async () => {
    const { plugin, seen } = spy('spy', ['stories.create']);
    const t = await pluginRoot({ notes: true, spy: true });
    const { services } = await withPlugins(t, [notes, plugin]);
    await services.stories.create('web', { name: 'A', plugins: { notes: { note: 'x' } } });
    const guard = seen.find((s) => s.stage === 'guard');
    expect(guard?.changes).toMatchObject([
      { type: 'story', before: null, after: { plugins: { notes: { note: 'x' } } } },
    ]);
  });
});

describe('replace', () => {
  it('runs instead of core, may call core, and fills the same Change Set', async () => {
    const t = await pluginRoot({ stamp: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [stamp]);
    const task = await services.tasks.create('WEB-1', { name: 'Write tests' });
    expect(task.name).toBe('[stamped] Write tests');
    expect((await services.tasks.get('WEB-1.1')).task.name).toBe('[stamped] Write tests');
  });

  it('errors from core keep their own code when the replacement calls it', async () => {
    const t = await pluginRoot({ stamp: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [stamp]);
    await expect(services.tasks.create('WEB-1', { name: 'x', stage: 'nope' })).rejects.toThrow(ValidationError);
  });
});

describe('react', () => {
  it('runs after the save with the result; command mode waits for it', async () => {
    const t = await pluginRoot({ notes: true });
    const { services, warnings } = await withPlugins(t, [notes]);
    await services.stories.create('web', { name: 'A' });
    expect(warnings).toEqual(['notes saw WEB-1 created']);
  });

  it('a failure only warns; the change stays saved', async () => {
    const t = await pluginRoot({ echo: true });
    const { services, warnings } = await withPlugins(t, [echo]);
    await services.boards.update('web', { name: 'Renamed' });
    expect((await services.boards.get('web')).name).toBe('Renamed');
    expect(warnings).toEqual(['Plugin "echo" failed to react to boards.update: echo failed']);
  });

  it('the TUI does not wait for reactions', async () => {
    let release = () => {};
    let reacted = () => {};
    const done: string[] = [];
    const finished = new Promise<void>((resolve) => {
      reacted = resolve;
    });
    const slow = definePlugin({
      id: 'slow',
      name: 'Slow',
      description: '',
      hooks: {
        'boards.update': {
          react: async () => {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            done.push('reacted');
            reacted();
          },
        },
      },
    });
    const t = await pluginRoot({ slow: true });
    const { services } = await withPlugins(t, [slow], { backgroundReactions: true });
    await services.boards.update('web', { name: 'Renamed' });
    expect(done).toEqual([]);
    release();
    await finished;
    expect(done).toEqual(['reacted']);
  });
});

describe('Change Sets', () => {
  it('holds each record before and after: a move, and a forced Board deletion with its Stories', async () => {
    const { plugin, seen } = spy('spy', ['stories.move', 'boards.remove']);
    const t = await pluginRoot({ spy: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [plugin]);
    await services.stories.move('WEB-1', 'done');
    const move = seen.find((s) => s.stage === 'react' && s.name === 'stories.move')?.changes;
    expect(move).toMatchObject([
      { type: 'story', before: { key: 'WEB-1', stage: 'backlog' }, after: { stage: 'done' } },
    ]);

    await services.boards.remove('web', { force: true });
    const removal = seen.find((s) => s.stage === 'guard' && s.name === 'boards.remove')?.changes;
    expect(removal?.map((c) => [c.type, c.before !== null, c.after !== null])).toEqual([
      ['story', true, false],
      ['board', true, false],
    ]);
  });

  it('every core operation passes its Plugin input to the hooks as `plugins`', async () => {
    const inputs: unknown[] = [];
    const watch = definePlugin({
      id: 'watch',
      name: 'Watch',
      description: '',
      hooks: Object.fromEntries(
        ['stories.rank', 'tasks.move', 'assignees.remove', 'context.use'].map((op) => [
          op,
          {
            transform: ({ name, pluginInput }: { name: string; pluginInput: unknown }) =>
              void inputs.push([name, pluginInput]),
          },
        ]),
      ),
    });
    const t = await pluginRoot({ watch: true });
    await makeStory(t.path, {
      boardId: 'web',
      key: 'WEB-1',
      tasks: [{ id: 'WEB-1.1', name: 'T', description: '', stage: 'backlog', ...stamps() }],
      nextTaskNumber: 2,
    });
    const { services } = await withPlugins(t, [watch]);
    const plugins = { watch: 1 };
    await services.stories.rank('WEB-1', 'top', { plugins });
    await services.tasks.move('WEB-1.1', 'done', { plugins });
    await services.assignees.remove('alice', { plugins });
    await services.context.use('web', { plugins });
    expect(inputs).toEqual([
      ['stories.rank', 1],
      ['tasks.move', 1],
      ['assignees.remove', 1],
      ['context.use', 1],
    ]);
  });
});

describe("a Plugin's own operations and files (ADR-0013)", () => {
  it('go through the pipeline: other Plugins can guard them', async () => {
    const wary = definePlugin({
      id: 'wary',
      name: 'Wary',
      description: '',
      hooks: { 'notes.add': { guard: () => ({ reject: 'no notes today' }) } },
    });
    const t = await pluginRoot({ notes: true, wary: true });
    const { services } = await withPlugins(t, [notes, wary]);
    const plugin = services.plugins.context('notes');
    const add = () => plugin.operation('add', {}, (changes) => changes.writeFile('dataRoot', 'a.txt', 'A'));
    await expect(add()).rejects.toThrow('no notes today');
    expect(await plugin.files.list('dataRoot')).toEqual([]);
  });

  it('live in plugins/<id>/ beside what they belong to, and go with a deleted Story or Board', async () => {
    const t = await pluginRoot({ notes: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [notes]);
    const plugin = services.plugins.context('notes');
    await plugin.operation('write', {}, async (changes) => {
      await changes.writeFile('dataRoot', 'root.txt', 'R');
      await changes.writeFile({ board: 'web' }, 'deep/board.txt', 'B');
      await changes.writeFile({ story: 'web-1' }, 'story.txt', 'S');
      expect(await changes.readFile({ story: 'WEB-1' }, 'story.txt')).toBe('S');
    });
    expect(await pathExists(join(t.path, 'plugins/notes/root.txt'))).toBe(true);
    expect(await plugin.files.list({ board: 'web' })).toEqual(['deep/board.txt']);
    expect(await plugin.files.read({ story: 'WEB-1' }, 'story.txt')).toBe('S');
    await expect(plugin.files.read('dataRoot', '../escape')).rejects.toThrow(ValidationError);

    await plugin.operation('delete', {}, (changes) => changes.deleteFile({ board: 'web' }, 'deep/board.txt'));
    expect(await pathExists(join(t.path, 'boards/web/plugins'))).toBe(false);

    await services.stories.remove('WEB-1');
    expect(await pathExists(join(t.path, 'boards/web/stories/WEB-1'))).toBe(false);
    await plugin.operation('again', {}, (changes) => changes.writeFile({ board: 'web' }, 'b.txt', 'B'));
    await services.boards.remove('web', { force: true });
    expect(await readdir(t.path)).not.toContain('boards/web');
    expect(await plugin.files.list('dataRoot')).toEqual(['root.txt']);
  });

  it('doctor --fix moves a renumbered Story with its whole folder', async () => {
    const t = await pluginRoot({ notes: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Kept' });
    // A merge brought a later Story also keyed WEB-1, in a folder of its own, with a Plugin file.
    const later = await makeStory(t.path, {
      boardId: 'web',
      key: 'WEB-1',
      name: 'Moved',
      rank: 'a1',
      createdAt: LATER,
    });
    await writeFixture(join(t.path, 'boards/web/stories/WEB-7/story.json'), StorySchema, later);
    await mkdir(join(t.path, 'boards/web/stories/WEB-7/plugins/notes'), { recursive: true });
    await writeFile(join(t.path, 'boards/web/stories/WEB-7/plugins/notes/n.txt'), 'N');
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Kept' });
    const { services } = await withPlugins(t, [notes]);

    const report = await services.doctor.fix();
    expect(report.fixed.map((f) => f.code)).toEqual(['DUPLICATE_KEY']);
    const moved = (await services.stories.list('web', {})).find((s) => s.name === 'Moved');
    expect(moved?.key).toBe('WEB-8');
    expect(await services.plugins.context('notes').files.read({ story: 'WEB-8' }, 'n.txt')).toBe('N');
    expect(await pathExists(join(t.path, 'boards/web/stories/WEB-7'))).toBe(false);
  });
});

describe('filters', () => {
  it("each Plugin filter in StoryFilter.plugins must match through the Plugin's filterStories", async () => {
    const t = await pluginRoot({ notes: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { notes: { note: 'x' } } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', rank: 'a1' });
    const { services } = await withPlugins(t, [notes]);
    const keys = async (filter: unknown) =>
      (await services.stories.list('web', { plugins: { notes: filter } })).map((s) => s.key);
    expect(await keys(true)).toEqual(['WEB-1']);
    expect(await keys(false)).toEqual(['WEB-2']);
    await expect(services.stories.list('web', { plugins: { tracer: true } })).rejects.toThrow('cannot filter');
  });
});

const LATER = '2026-10-13T00:00:00.000Z';

function stamps() {
  return { createdAt: FIXED_NOW, updatedAt: FIXED_NOW };
}

describe('Story rows', () => {
  it('come from each Plugin in registry order; one that throws only warns', async () => {
    const broken = definePlugin({
      id: 'broken',
      name: 'Broken',
      description: '',
      storyRows: async () => {
        throw new Error('no rows');
      },
    });
    const t = await pluginRoot({ notes: true, broken: true, tracer: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-3', plugins: { notes: { note: 'n' } } });
    const { ctx, services, warnings } = await withPlugins(t, [notes, broken, tracer]);
    const rows = await pluginStoryRows(ctx, services, await services.stories.get('WEB-3'));
    expect(rows).toEqual([
      { label: 'Note', value: 'note: n' },
      { label: 'Number', value: '3' },
    ]);
    expect(warnings).toEqual(['Plugin "broken" failed to show its rows: no rows']);
  });
});
