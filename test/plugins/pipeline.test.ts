import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError, PluginError } from '../../src/core';
import { definePlugin } from '../../src/plugin-api';
import { storyLinking } from '../../src/plugins/story-linking';
import { addLink } from '../../src/plugins/story-linking/links';
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

  it('an invalid Story Linking bag rejects mutations and deletion cleanup without saving staged changes', async () => {
    const t = await pluginRoot({ 'story-linking': true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { 'story-linking': { blocks: ['WEB-3'] } } });
    await makeStory(t.path, {
      boardId: 'web',
      key: 'WEB-2',
      rank: 'a1',
      plugins: {
        ghost: { kept: true },
        'story-linking': { blocks: 'unknown shape' },
      },
    });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-3', rank: 'a2' });
    const { services } = await withPlugins(t, [storyLinking]);
    const before = await services.stories.list('web', {});
    await expect(addLink(services.plugins.context('story-linking'), 'WEB-2', 'WEB-3')).rejects.toMatchObject({
      code: 'DATA_INTEGRITY',
    });
    await expect(services.stories.remove('WEB-3')).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
    await services.doctor.fix();
    expect(await services.stories.list('web', {})).toEqual(before);
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
