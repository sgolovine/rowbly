import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError, PluginError } from '../../src/core';
import { definePlugin, type PluginChangeSet, readBinaryInput } from '../../src/plugin-api';
import { attachments } from '../../src/plugins/attachments';
import { addAttachment, listAttachments, removeAttachment } from '../../src/plugins/attachments/attachments';
import { comments } from '../../src/plugins/comments';
import { editComment } from '../../src/plugins/comments/comments';
import { specs } from '../../src/plugins/specs';
import { createSpec, deleteSpec, editSpec, listStorySpecs } from '../../src/plugins/specs/specs';
import { storyLinking } from '../../src/plugins/story-linking';
import { addLink, readLinks, removeLink } from '../../src/plugins/story-linking/links';
import { tasks } from '../../src/plugins/tasks';
import { createTask, deleteTask, listTasks, updateTask } from '../../src/plugins/tasks/tasks';
import { pathExists } from '../../src/storage';
import { io } from '../../src/storage/io';
import { makeStory } from '../helpers';
import { deferred } from '../helpers/deferred';
import { echo, faulty, notes, order, tracer } from './fixtures';
import { pluginRoot, withPlugins } from './helpers';

describe('transform (ADR-0012)', () => {
  it('creates Plugin bags, Story Spec files and incoming links atomically; rejected input saves nothing', async () => {
    const t = await pluginRoot({ tasks: true, specs: true, 'story-linking': true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-10', plugins: { ghost: { kept: true } } });
    const { services } = await withPlugins(t, [tasks, specs, storyLinking]);
    const input = {
      name: 'Atomic Story',
      plugins: {
        tasks: { tasks: [{ name: 'First' }, { name: 'Second', stage: 'todo' }] },
        specs: {
          storySpecs: [
            { slug: 'design', text: '# Design' },
            { slug: 'checks', text: 'Checks' },
          ],
        },
        'story-linking': { blockedBy: ['WEB-10'] },
      },
    };
    const created = await services.stories.create('web', input);
    const specPath = (key: string, slug: string) => join(t.path, `boards/web/stories/${key}/plugins/specs/${slug}.md`);
    expect(await readFile(specPath(created.key, 'design'), 'utf8')).toBe('# Design');
    expect(await readFile(specPath(created.key, 'checks'), 'utf8')).toBe('# checks\n\nChecks');
    expect(created.plugins?.tasks).toMatchObject({
      nextNumber: 3,
      tasks: [
        { number: 1, stage: 'backlog' },
        { number: 2, stage: 'todo' },
      ],
    });
    expect((await services.stories.get('WEB-10')).plugins).toEqual({
      ghost: { kept: true },
      'story-linking': { blocks: [created.key] },
    });
    // Seed fields an older schema cannot interpret; editing known fields must retain them.
    const storyPath = join(t.path, `boards/web/stories/${created.key}/story.json`);
    const raw = JSON.parse(await readFile(storyPath, 'utf8'));
    raw.plugins.tasks.extraMetadata = { source: 'import' };
    raw.plugins.tasks.tasks[0].provenance = { source: 'original' };
    raw.plugins.tasks.tasks[1].provenance = { source: 'removed' };
    raw.plugins.specs = { specs: ['board-guide'], extraMetadata: { source: 'specs' } };
    await writeFile(storyPath, JSON.stringify(raw));
    const before = await services.stories.list('web', {});
    const boardBefore = await services.boards.get('web');
    // A later transform fails after Tasks and Spec files were staged.
    await expect(
      services.stories.create('web', {
        ...input,
        plugins: { ...input.plugins, 'story-linking': { blockedBy: ['WEB-999'] } },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await services.stories.list('web', {})).toEqual(before);
    expect(await services.boards.get('web')).toEqual(boardBefore);
    await expect(
      services.stories.create('web', {
        ...input,
        plugins: {
          specs: {
            storySpecs: [
              { slug: 'same', text: 'A' },
              { slug: 'same', text: 'B' },
            ],
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await services.stories.list('web', {})).toEqual(before);

    const savedTasks = await listTasks(services.plugins.context('tasks'), created.key);
    const patch = {
      name: 'Edited together',
      plugins: {
        tasks: {
          baseline: savedTasks,
          tasks: [
            { ...savedTasks[0], name: 'Renamed', createdAt: 'spoofed', provenance: { source: 'spoofed' } },
            { name: 'New Task', number: undefined, createdAt: 'spoofed' },
          ],
        },
        specs: {
          baselineSpecs: ['board-guide'],
          baselineStorySpecs: await listStorySpecs(services.plugins.context('specs'), created),
          specs: [],
          storySpecs: [
            { slug: 'design', text: '# Revised' },
            { slug: 'new-spec', text: 'New' },
          ],
        },
        'story-linking': { blocks: ['WEB-10'], blockedBy: [], baseline: { blocks: [], blockedBy: ['WEB-10'] } },
      },
    };
    // The late Links transform rejects after core, Tasks and Spec writes/deletions were staged.
    await expect(
      services.stories.update(created.key, {
        ...patch,
        plugins: { ...patch.plugins, 'story-linking': { blocks: ['WEB-999'], blockedBy: [] } },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { plugin: 'story-linking' } });
    expect(await services.stories.list('web', {})).toEqual(before);
    expect(await readFile(specPath(created.key, 'design'), 'utf8')).toBe('# Design');
    expect(await readFile(specPath(created.key, 'checks'), 'utf8')).toBe('# checks\n\nChecks');
    expect(await pathExists(specPath(created.key, 'new-spec'))).toBe(false);
    const edited = await services.stories.update(created.key, patch);
    expect(edited.name).toBe('Edited together');
    const editedTasks = await listTasks(services.plugins.context('tasks'), created.key);
    expect(editedTasks).toMatchObject([
      { number: 1, name: 'Renamed', createdAt: savedTasks[0]?.createdAt },
      { number: 3, name: 'New Task' },
    ]);
    expect(edited.plugins?.tasks).toMatchObject({
      nextNumber: 4,
      extraMetadata: { source: 'import' },
      tasks: [{ provenance: { source: 'original' } }, { number: 3 }],
    });
    expect(editedTasks).toHaveLength(2);
    expect(editedTasks[1]?.createdAt).not.toBe('spoofed');
    expect(edited.plugins?.specs).toEqual({ specs: [], extraMetadata: { source: 'specs' } });
    expect(await readFile(specPath(created.key, 'design'), 'utf8')).toBe('# Revised');
    expect(await pathExists(specPath(created.key, 'checks'))).toBe(false);
    expect(await readFile(specPath(created.key, 'new-spec'), 'utf8')).toBe('# new-spec\n\nNew');
    expect((await services.stories.get('WEB-10')).plugins).toEqual({ ghost: { kept: true } });
    expect(edited.plugins?.['story-linking']).toEqual({ blocks: ['WEB-10'] });
    const unchanged = await services.stories.update(created.key, { description: 'Only core' });
    expect(unchanged.plugins).toEqual(edited.plugins);
    const taskOnly = await services.stories.update(created.key, {
      plugins: { tasks: { tasks: editedTasks, baseline: editedTasks } },
    });
    expect(taskOnly.plugins?.tasks).toEqual(edited.plugins?.tasks);

    // Capture an editor draft, then complete another operation before the stale save.
    // Every conflict must leave core fields, all bags and Spec files at their latest values.
    const taskPlugin = services.plugins.context('tasks');
    const specPlugin = services.plugins.context('specs');
    const linkPlugin = services.plugins.context('story-linking');
    const assertConflict = async (plugins: Record<string, unknown>, plugin: string) => {
      const latest = await services.stories.list('web', {});
      const files = await listStorySpecs(specPlugin, created);
      await expect(services.stories.update(created.key, { name: 'Stale editor', plugins })).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { plugin, stage: 'transform' },
      });
      expect(await services.stories.list('web', {})).toEqual(latest);
      expect(await listStorySpecs(specPlugin, created)).toEqual(files);
      // Unchanged tabs contribute no input and never block an unrelated core edit.
      await services.stories.update(created.key, { description: 'Core after concurrent edit' });
      expect((await services.stories.get(created.key)).plugins).toEqual(
        latest.find((s) => s.key === created.key)?.plugins,
      );
    };
    for (const mutate of [
      () => createTask(taskPlugin, created.key, { name: 'Concurrent Task must survive' }),
      () => updateTask(taskPlugin, `${created.key}.1`, { name: 'Concurrent rename' }),
      () => deleteTask(taskPlugin, `${created.key}.1`),
    ]) {
      const baseline = await listTasks(taskPlugin, created.key);
      await mutate();
      await assertConflict(
        { tasks: { baseline, tasks: baseline.map((t) => ({ ...t, name: 'Draft rename' })) } },
        'tasks',
      );
    }
    for (const mutate of [
      () => createSpec(specPlugin, { board: 'web', story: created.key, slug: 'concurrent' }, '# Added'),
      () => editSpec(specPlugin, { board: 'web', story: created.key, slug: 'design' }, '# CLI text edit'),
      () => deleteSpec(specPlugin, { board: 'web', story: created.key, slug: 'concurrent' }),
    ]) {
      const baselineStorySpecs = await listStorySpecs(specPlugin, created);
      await mutate();
      await assertConflict(
        {
          tasks: { tasks: [], baseline: await listTasks(taskPlugin, created.key) },
          specs: { baselineStorySpecs, storySpecs: [] },
        },
        'specs',
      );
    }
    for (const mutate of [
      () => addLink(linkPlugin, 'WEB-10', created.key),
      () => removeLink(linkPlugin, created.key, 'WEB-10'),
    ]) {
      const view = await readLinks(linkPlugin, created.key);
      const baseline = {
        blocks: view.links.filter((l) => l.relation === 'blocks').map((l) => l.key),
        blockedBy: view.links.filter((l) => l.relation === 'blocked-by').map((l) => l.key),
      };
      await mutate();
      await assertConflict(
        {
          tasks: { tasks: [], baseline: await listTasks(taskPlugin, created.key) },
          specs: { storySpecs: [], baselineStorySpecs: await listStorySpecs(specPlugin, created) },
          'story-linking': { blocks: [], blockedBy: [], baseline },
        },
        'story-linking',
      );
    }
    // A Board Spec link edit also uses the loaded links as its baseline.
    await createSpec(specPlugin, { board: 'web', slug: 'guide' }, '# Guide');
    await services.stories.update(created.key, { plugins: { specs: { specs: ['guide'] } } });
    await assertConflict({ specs: { specs: [], baselineSpecs: [] } }, 'specs');
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
  it('Story Linking and Attachments mutations and repairs are atomic and preserve other Plugin Data', async () => {
    let refuse = true;
    const gate = definePlugin({
      id: 'gate',
      name: 'Gate',
      description: '',
      hooks: {
        'stories.remove': { guard: () => (refuse ? { reject: 'hold deletion' } : undefined) },
        'doctor.fix': { guard: () => (refuse ? { reject: 'hold repair' } : undefined) },
        'stories.create': {
          guard: ({ input }) => (refuse && input.plugins?.attachments ? { reject: 'hold image create' } : undefined),
        },
        'stories.update': {
          guard: ({ input }) => (refuse && input.plugins?.attachments ? { reject: 'hold image update' } : undefined),
        },
        'attachments.add': { guard: () => (refuse ? { reject: 'hold add' } : undefined) },
        'attachments.remove': { guard: () => (refuse ? { reject: 'hold remove' } : undefined) },
      },
    });
    const t = await pluginRoot({ 'story-linking': true, attachments: true, gate: true });
    const other = { ghost: { nested: ['kept'] } };
    await makeStory(t.path, {
      boardId: 'web',
      key: 'WEB-1',
      plugins: {
        ...other,
        'story-linking': { blocks: ['WEB-2', 'WEB-99'] },
        attachments: {
          attachments: [
            {
              id: 'missing',
              name: 'lost.png',
              type: 'image/png',
              size: 8,
              createdAt: '2026-01-01T00:00:00.000Z',
              createdBy: null,
            },
          ],
        },
      },
    });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', rank: 'a1', plugins: other });
    const { services } = await withPlugins(t, [storyLinking, attachments, gate]);
    const attachment = services.plugins.context('attachments');
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 255]);
    const folder = join(t.path, 'boards/web/stories/WEB-1/plugins/attachments');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'recover.png'), png);
    const before = await services.stories.list('web', {});
    await expect(addAttachment(attachment, 'WEB-1', { name: 'image.png', bytes: png })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await attachment.files.list({ story: 'WEB-1' })).toEqual(['recover.png']);
    const images = { images: [{ name: 'pending.png', png: Buffer.from(png).toString('base64') }] };
    await expect(
      services.stories.create('web', { name: 'Pending', plugins: { attachments: images } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      services.stories.update('WEB-1', { name: 'Unsaved', plugins: { attachments: images } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await services.stories.list('web', {})).toEqual(before);
    expect(await attachment.files.list({ story: 'WEB-1' })).toEqual(['recover.png']);

    await expect(services.stories.remove('WEB-2')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await services.stories.list('web', {})).toEqual(before);
    await expect(services.doctor.fix()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await services.stories.list('web', {})).toEqual(before);
    refuse = false;
    await services.doctor.fix();
    expect((await services.stories.get('WEB-1')).plugins).toEqual({ ...other, 'story-linking': { blocks: ['WEB-2'] } });
    expect(await readFile(join(folder, 'recover.png'))).toEqual(Buffer.from(png));
    expect((await services.doctor.check()).findings).toContainEqual(
      expect.objectContaining({ code: 'ATTACHMENTS_ORPHAN_FILE', fixable: false }),
    );
    const image = await addAttachment(attachment, 'WEB-1', { name: 'image.png', bytes: png });
    const withImage = await services.stories.get('WEB-1');
    refuse = true;
    await expect(removeAttachment(attachment, 'WEB-1', image.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await services.stories.get('WEB-1')).toEqual(withImage);
    expect(await attachment.files.readBinary({ story: 'WEB-1' }, `${image.id}.png`)).toEqual(png);
    refuse = false;
    await removeAttachment(attachment, 'WEB-1', image.id);
    expect(await attachment.files.readBinary({ story: 'WEB-1' }, `${image.id}.png`)).toBeNull();
    const created = await services.stories.create('web', { name: 'With image', plugins: { attachments: images } });
    const first = (await listAttachments(attachment, created.key))[0];
    expect(first).toMatchObject({ name: 'pending.png', size: png.length });
    expect(await attachment.files.readBinary({ story: created.key }, `${first?.id}.png`)).toEqual(png);
    await services.stories.update(created.key, { name: 'With two images', plugins: { attachments: images } });
    expect(await listAttachments(attachment, created.key)).toHaveLength(2);
    const saved = await services.stories.get(created.key);
    await expect(
      services.stories.update(created.key, {
        name: 'Invalid image',
        plugins: {
          attachments: {
            images: [images.images[0], { name: 'bad.png', png: Buffer.alloc(9).toString('base64') }],
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await services.stories.get(created.key)).toEqual(saved);
    expect(await attachment.files.list({ story: created.key })).toHaveLength(2);
    await services.stories.remove('WEB-2');
    expect((await services.stories.get('WEB-1')).plugins).toEqual(other);
    await expect(services.stories.get('WEB-2')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('invalid owned bags reject mutations and deletion cleanup without saving staged changes', async () => {
    const t = await pluginRoot({ 'story-linking': true, tasks: true, comments: true, attachments: true });
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
        attachments: { attachments: 'unknown data' },
      },
    });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-3', rank: 'a2' });
    const { services } = await withPlugins(t, [storyLinking, tasks, comments, attachments]);
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
    await expect(
      services.stories.update('WEB-2', { name: 'Overwrite', plugins: { tasks: { tasks: [] } } }),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
    await expect(
      services.stories.update('WEB-2', {
        name: 'Overwrite',
        plugins: { 'story-linking': { blocks: [], blockedBy: [] } },
      }),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
    const findings = (await services.doctor.check()).findings;
    await expect(
      addAttachment(services.plugins.context('attachments'), 'WEB-2', {
        name: 'image.png',
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      }),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
    for (const id of ['tasks', 'comments', 'attachments'])
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
    const coreOnly = await services.stories.update('WEB-2', { description: 'Invalid bags kept' });
    expect(coreOnly.plugins).toEqual(before.find((story) => story.key === 'WEB-2')?.plugins);
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
    const input = await readBinaryInput(join(t.path, 'plugins/binary/image.png'), bytes.length);
    expect(input).toEqual({ name: 'image.png', bytes });
    await expect(readBinaryInput(join(t.path, 'plugins/binary/image.png'), bytes.length - 1)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(plugin.openFile('dataRoot', '../outside.png')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(plugin.openFile('dataRoot', 'missing.png')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Binary paths must use the existing symlink policy for both reads and writes.
    await mkdir(join(t.path, 'elsewhere'));
    await symlink(join(t.path, 'elsewhere'), join(t.path, 'plugins/binary/linked'), 'dir');
    await expect(plugin.openFile('dataRoot', 'linked/image.png')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(plugin.files.readBinary('dataRoot', 'linked/image.png')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      plugin.operation('linked', {}, (changes) => changes.writeBinaryFile('dataRoot', 'linked/image.png', bytes)),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
