import { mkdir, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError, PluginError } from '../../src/core';
import { definePlugin, type PluginChangeSet } from '../../src/plugin-api';
import { comments } from '../../src/plugins/comments';
import { editComment } from '../../src/plugins/comments/comments';
import { storyLinking } from '../../src/plugins/story-linking';
import { addLink } from '../../src/plugins/story-linking/links';
import { tasks } from '../../src/plugins/tasks';
import { updateTask } from '../../src/plugins/tasks/tasks';
import { pathExists } from '../../src/storage';
import { io } from '../../src/storage/io';
import { makeStory } from '../helpers';
import { deferred } from '../helpers/deferred';
import { echo, faulty, notes, order, tracer } from './fixtures';
import { pluginRoot, withPlugins } from './helpers';

describe('transform (ADR-0012)', () => {
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
  it('Story Linking deletion and repair are atomic and preserve other Plugin Data', async () => {
    let refuse = true;
    const gate = definePlugin({
      id: 'gate',
      name: 'Gate',
      description: '',
      hooks: {
        'stories.remove': { guard: () => (refuse ? { reject: 'hold deletion' } : undefined) },
        'doctor.fix': { guard: () => (refuse ? { reject: 'hold repair' } : undefined) },
      },
    });
    const t = await pluginRoot({ 'story-linking': true, gate: true });
    const other = { ghost: { nested: ['kept'] } };
    await makeStory(t.path, {
      boardId: 'web',
      key: 'WEB-1',
      plugins: {
        ...other,
        'story-linking': { blocks: ['WEB-2', 'WEB-99'] },
      },
    });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', rank: 'a1', plugins: other });
    const { services } = await withPlugins(t, [storyLinking, gate]);
    const before = await services.stories.list('web', {});
    await expect(services.stories.remove('WEB-2')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await services.stories.list('web', {})).toEqual(before);
    await expect(services.doctor.fix()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await services.stories.list('web', {})).toEqual(before);
    refuse = false;
    await services.doctor.fix();
    expect((await services.stories.get('WEB-1')).plugins).toEqual({ ...other, 'story-linking': { blocks: ['WEB-2'] } });
    await services.stories.remove('WEB-2');
    expect((await services.stories.get('WEB-1')).plugins).toEqual(other);
    await expect(services.stories.get('WEB-2')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('invalid owned bags reject mutations and deletion cleanup without saving staged changes', async () => {
    const t = await pluginRoot({ 'story-linking': true, tasks: true, comments: true });
    const timestamp = '2026-01-01T00:00:00.000Z';
    const task = {
      number: 1,
      name: 'First',
      description: '',
      stage: 'backlog',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const comment = { id: 'duplicate', author: null, body: 'First', createdAt: timestamp, updatedAt: timestamp };
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { 'story-linking': { blocks: ['WEB-3'] } } });
    await makeStory(t.path, {
      boardId: 'web',
      key: 'WEB-2',
      rank: 'a1',
      plugins: {
        ghost: { kept: true },
        'story-linking': { blocks: 'unknown shape' },
        tasks: { nextNumber: 2, tasks: [task, { ...task, name: 'Second' }] },
        comments: { comments: [comment, { ...comment, body: 'Second' }] },
      },
    });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-3', rank: 'a2' });
    const { services } = await withPlugins(t, [storyLinking, tasks, comments]);
    const before = await services.stories.list('web', {});
    const file = join(t.path, 'boards/web/stories/WEB-2/story.json');
    const bytes = await readFile(file);
    await expect(addLink(services.plugins.context('story-linking'), 'WEB-2', 'WEB-3')).rejects.toMatchObject({
      code: 'DATA_INTEGRITY',
    });
    await expect(services.stories.remove('WEB-3')).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
    await expect(updateTask(services.plugins.context('tasks'), 'WEB-2.1', { name: 'Overwrite' })).rejects.toMatchObject(
      {
        code: 'DATA_INTEGRITY',
        exitCode: 6,
      },
    );
    await expect(
      editComment(services.plugins.context('comments'), 'WEB-2', 'duplicate', 'Overwrite'),
    ).rejects.toMatchObject({
      code: 'DATA_INTEGRITY',
      exitCode: 6,
    });
    const findings = (await services.doctor.check()).findings;
    for (const id of ['tasks', 'comments'])
      expect(findings).toContainEqual(
        expect.objectContaining({
          code: 'PLUGIN_DATA_INVALID',
          severity: 'warning',
          fixable: false,
          path: 'boards/web/stories/WEB-2/story.json',
          details: expect.objectContaining({ plugin: id }),
        }),
      );
    await services.doctor.fix();
    expect(await services.stories.list('web', {})).toEqual(before);
    expect(await readFile(file)).toEqual(bytes);
  });

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
});

describe('react', () => {
  it('releases a background reaction read acquired after its operation returns', async () => {
    const reading = deferred();
    const release = deferred();
    const finished = deferred();
    const reader = definePlugin({
      id: 'reader',
      name: 'Reader',
      description: '',
      async react({ plugin }) {
        try {
          await plugin.localData();
        } finally {
          finished.resolve();
        }
      },
    });
    const t = await pluginRoot({ reader: true });
    const { services } = await withPlugins(t, [reader], { backgroundReactions: true });
    const link = io.link;
    let acquisitions = 0;
    const spy = vi.spyOn(io, 'link').mockImplementation(async (from, to) => {
      if (to === join(t.path, '.lock') && ++acquisitions === 2) {
        reading.resolve();
        await release.promise;
      }
      return link(from, to);
    });
    try {
      const saving = services.stories.create('web', { name: 'Saved' });
      await reading.promise;
      await saving;
      release.resolve();
      await finished.promise;
      expect(await pathExists(join(t.path, '.lock'))).toBe(false);
    } finally {
      release.resolve();
      await finished.promise;
      spy.mockRestore();
    }
  });

  it('a failure only warns; the change stays saved', async () => {
    const t = await pluginRoot({ echo: true });
    const { services, warnings } = await withPlugins(t, [echo]);
    await services.boards.update('web', { name: 'Renamed' });
    expect((await services.boards.get('web')).name).toBe('Renamed');
    expect(warnings).toEqual(['Plugin "echo" failed to react to boards.update: echo failed']);
  });
});

describe('binary Plugin files', () => {
  it('keeps bytes private through transforms, guards, stored reads and sealed writers', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 255, 128]);
    let writer: PluginChangeSet | undefined;
    const binary = definePlugin({
      id: 'binary',
      name: 'Binary',
      description: '',
      hooks: {
        'stories.create': {
          async transform({ changes, result, plugin }) {
            writer = changes;
            const scope = { story: result.key };
            const input = new Uint8Array(bytes);
            const writing = changes.writeBinaryFile(scope, 'image.png', input);
            input.fill(0); // The copy must precede the first asynchronous scope read.
            await writing;
            const pending = await changes.readBinaryFile(scope, 'image.png');
            expect(pending).toEqual(bytes);
            pending?.fill(0);
            expect(await changes.readBinaryFile(scope, 'image.png')).toEqual(bytes);
            expect(await plugin.files.readBinary('dataRoot', 'image.png')).toBeNull();
            await changes.writeBinaryFile('dataRoot', 'image.png', bytes);
            await changes.writeBinaryFile({ board: 'web' }, 'image.png', bytes);
            await changes.writeFile(scope, 'note.txt', 'unchanged text API');
            expect(await changes.readFile(scope, 'note.txt')).toBe('unchanged text API');
          },
          async guard({ changes, result }) {
            expect('writeBinaryFile' in changes).toBe(false);
            await expect(writer?.writeBinaryFile('dataRoot', 'late.png', bytes)).rejects.toMatchObject({
              code: 'INTERNAL',
            });
            const files = changes.changes.filter((change) => change.type === 'file');
            expect(files[0]?.after).toMatchObject({
              kind: 'binary',
              size: bytes.length,
              sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            });
            expect(Object.isFrozen(files[0]?.after)).toBe(true);
            expect(await changes.readBinaryFile({ story: result.key }, 'image.png')).toEqual(bytes);
          },
        },
      },
    });
    const t = await pluginRoot({ binary: true });
    const { services } = await withPlugins(t, [binary]);
    const story = await services.stories.create('web', { name: 'Binary' });
    const plugin = services.plugins.context('binary');
    const scope = { story: story.key };
    const stored = await plugin.files.readBinary(scope, 'image.png');
    expect(stored).toEqual(bytes);
    stored?.fill(0);
    expect(await plugin.files.readBinary(scope, 'image.png')).toEqual(bytes);
    expect(await readFile(join(t.path, `boards/web/stories/${story.key}/plugins/binary/image.png`))).toEqual(
      Buffer.from(bytes),
    );
    expect((await services.doctor.check()).findings.filter((f) => f.code === 'DATA_INTEGRITY')).toEqual([]);
    await plugin.operation('delete', {}, async (changes) => {
      await changes.deleteFile(scope, 'image.png');
      expect(await changes.readBinaryFile(scope, 'image.png')).toBeNull();
      expect(changes.changes.find((c) => c.type === 'file')?.before).toMatchObject({
        kind: 'binary',
        size: bytes.length,
      });
    });
    expect(await plugin.files.readBinary(scope, 'image.png')).toBeNull();
    await plugin.operation('delete-text', {}, async (changes) => {
      await changes.deleteFile(scope, 'note.txt');
      expect(changes.changes.find((c) => c.type === 'file')?.before).toBe('unchanged text API');
    });
    await expect(writer?.writeBinaryFile(scope, 'late.png', bytes)).rejects.toMatchObject({ code: 'INTERNAL' });
    // Binary paths must use the existing symlink policy for both reads and writes.
    await mkdir(join(t.path, 'elsewhere'));
    await symlink(join(t.path, 'elsewhere'), join(t.path, 'plugins/binary/linked'), 'dir');
    await expect(plugin.files.readBinary('dataRoot', 'linked/image.png')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      plugin.operation('linked', {}, (changes) => changes.writeBinaryFile('dataRoot', 'linked/image.png', bytes)),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
