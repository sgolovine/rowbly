import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError, PluginError } from '../../src/core';
import { definePlugin, type PluginChangeSet, type PluginHookContext, readBinaryInput } from '../../src/plugin-api';
import { attachments } from '../../src/plugins/attachments';
import { addAttachment, listAttachments, removeAttachment } from '../../src/plugins/attachments/attachments';
import { comments } from '../../src/plugins/comments';
import { editComment } from '../../src/plugins/comments/comments';
import { github } from '../../src/plugins/github';
import { softwareFactory } from '../../src/plugins/software-factory';
import { touchRun } from '../../src/plugins/software-factory/heartbeat';
import { holdStory } from '../../src/plugins/software-factory/holds';
import { readRunMetadata, runRef } from '../../src/plugins/software-factory/runMetadata';
import { setStagePrompt } from '../../src/plugins/software-factory/stagePrompts';
import { clearRun, endRun, runsOverview, StageRunBag, startRun } from '../../src/plugins/software-factory/stageRuns';
import { attachWorker } from '../../src/plugins/software-factory/workerIdentity';
import { specs } from '../../src/plugins/specs';
import { createSpec, deleteSpec, editSpec, listStorySpecs } from '../../src/plugins/specs/specs';
import { storyLinking } from '../../src/plugins/story-linking';
import { addLink, readLinks, removeLink } from '../../src/plugins/story-linking/links';
import { tasks } from '../../src/plugins/tasks';
import { createTask, deleteTask, listTasks, updateTask } from '../../src/plugins/tasks/tasks';
import { invokePlugin } from '../../src/services';
import { inScope, type Stage } from '../../src/services/plugins/executionScope';
import { pathExists } from '../../src/storage';
import { io } from '../../src/storage/io';
import type { TuiPlugin } from '../../src/tui/hooks';
import { findStories, loadStorySearch } from '../../src/tui/shell/storySearch';
import { makeStory } from '../helpers';
import { deferred } from '../helpers/deferred';
import { echo, faulty, notes, order, tracer } from './fixtures';
import { pluginRoot, withPlugins } from './helpers';

vi.mock('node:child_process', { spy: true });

describe('transform (ADR-0012)', () => {
  it('creates Plugin bags, Story Spec files and incoming links atomically; rejected input saves nothing', async () => {
    const t = await pluginRoot({ tasks: true, specs: true, 'story-linking': true, github: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-10', plugins: { ghost: { kept: true } } });
    const { services } = await withPlugins(t, [tasks, specs, storyLinking, github]);
    const input = {
      name: 'Atomic Story',
      plugins: {
        github: { pr: 'https://GITHUB.com/owner/name/pull/123/' },
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
    expect(created.plugins?.github).toEqual({ pr: 'https://github.com/owner/name/pull/123' });
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
        github: { pr: 'https://github.com/owner/name/pull/124' },
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
    expect(edited.plugins?.github).toEqual({ pr: 'https://github.com/owner/name/pull/124' });
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
    const invalidUrlBytes = await readFile(storyPath);
    await expect(
      services.stories.update(created.key, {
        name: 'Must not save',
        plugins: { github: { pr: 'https://user:password@github.com/owner/name/pull/1' } },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await readFile(storyPath)).toEqual(invalidUrlBytes);
    const cleared = await services.stories.update(created.key, { plugins: { github: { pr: null } } });
    expect(cleared.plugins?.github).toBeUndefined();
    expect(cleared.plugins?.tasks).toEqual(edited.plugins?.tasks);
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

  it('a thrown error fails mutations without saving, while failed display contributions preserve core search', async () => {
    const t = await pluginRoot({ faulty: true, 'software-factory': true, notes: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [softwareFactory, faulty, notes]);
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
    // A hold the transform rejects leaves no hold file behind.
    const hold = holdStory(services.plugins.context('software-factory'), 'WEB-1', { reason: 'By hand' });
    await expect(hold).rejects.toMatchObject({ code: 'INTERNAL', details: { stage: 'transform' } });
    expect(await pathExists(join(t.path, 'boards/web/stories/WEB-1/plugins/software-factory/hold.json'))).toBe(false);
    await makeStory(t.path, {
      boardId: 'web',
      key: 'WEB-2',
      name: 'Original searchable name',
      plugins: { faulty: { nested: { kept: true } } },
    });
    const inventory = await services.stories.list('web', {});
    const expected = structuredClone(inventory);
    // Reuse the exact service-owned inventory to detect mutation, including nested Plugin Data.
    const list = vi.spyOn(services.stories, 'list').mockResolvedValue(inventory);
    const calls: string[] = [];
    const contributors: TuiPlugin[] = [
      {
        id: 'faulty',
        actions: [],
        tui: {
          async loadStorySearchText({ stories }) {
            const story = stories.find((s) => s.key === 'WEB-2');
            if (!story) throw new Error('Missing fixture');
            story.name = 'Poisoned name';
            story.labels.push('poison');
            (story.plugins as { faulty: { nested: { kept: boolean } } }).faulty.nested.kept = false;
            (stories as typeof inventory).splice(0);
            throw new Error('Unavailable loader');
          },
        },
      },
      {
        id: 'software-factory',
        actions: [],
        tui: {
          async loadStorySearchText({ stories }) {
            expect(stories).toEqual(expected);
            return (story) => {
              expect(story).toEqual(expected.find((s) => s.key === story.key));
              calls.push(`mapper:${story.key}`);
              story.name = 'Poisoned mapper';
              story.labels.push('mapper');
              if (story.key === 'WEB-2') {
                (story.plugins as { faulty: { nested: { kept: boolean } } }).faulty.nested.kept = false;
              }
              throw new Error('Unavailable mapper');
            };
          },
          storySearchText({ story }) {
            expect(story).toEqual(expected.find((s) => s.key === story.key));
            calls.push(`legacy:${story.key}`);
            story.name = 'Poisoned legacy callback';
            story.labels.push('legacy');
            if (story.key === 'WEB-2') {
              (story.plugins as { faulty: { nested: { kept: boolean } } }).faulty.nested.kept = false;
            }
            throw new Error('Unavailable legacy callback');
          },
        },
      },
      {
        id: 'notes',
        actions: [],
        tui: {
          async loadStorySearchText({ stories }) {
            expect(stories).toEqual(expected);
            return (story) => {
              expect(story).toEqual(expected.find((s) => s.key === story.key));
              calls.push(`observer:${story.key}`);
              story.labels.push('private copy');
              return ['loaded text'];
            };
          },
          storySearchText({ story }) {
            expect(story).toEqual(expected.find((s) => s.key === story.key));
            return ['legacy text'];
          },
        },
      },
    ];
    try {
      const entries = await loadStorySearch(services, contributors, 'web');
      expect(inventory).toEqual(expected);
      expect(entries.map((entry) => entry.story)).toEqual(expected);
      expect(findStories(entries, 'Original searchable name').map((entry) => entry.story.key)).toEqual(['WEB-2']);
      expect(entries.every((entry) => entry.fields.slice(-2).join('|') === 'loaded text|legacy text')).toBe(true);
      expect(calls).toEqual(expected.flatMap((s) => [`mapper:${s.key}`, `legacy:${s.key}`, `observer:${s.key}`]));
    } finally {
      list.mockRestore();
    }
  });
});

describe('guard', () => {
  it('refuses factory starts and retries after concurrent or pending blocker changes without saving the Run', async () => {
    let pendingBlocker = false;
    let invalidateAttachment: 'worker' | 'ref' | 'identity' | null = null;
    const invalidate = async ({
      changes,
      plugin,
      result,
    }: {
      changes: PluginChangeSet;
      plugin: PluginHookContext;
      result: unknown;
    }) => {
      if (invalidateAttachment === 'identity') {
        const scope = { story: (result as { key: string }).key };
        const metadata = JSON.parse((await changes.readFile(scope, 'run-metadata.json')) ?? 'null');
        metadata.identity.machine = 'different-machine';
        metadata.identity.threadId = 'different-thread';
        await changes.writeFile(scope, 'run-metadata.json', JSON.stringify(metadata));
      } else if (invalidateAttachment)
        await changes.updateStory((result as { key: string }).key, (s) => ({
          ...plugin.writeBag(s, {
            stageRun: {
              ...StageRunBag.parse(s.plugins?.['software-factory']).stageRun,
              ...(invalidateAttachment === 'worker' ? { worker: 'another-worker' } : { attempt: 99 }),
            },
          }),
        }));
    };
    const factoryPlugin = definePlugin({
      ...softwareFactory,
      hooks: {
        ...softwareFactory.hooks,
        'software-factory.attach': { ...softwareFactory.hooks?.['software-factory.attach'], transform: invalidate },
        'software-factory.touch': { ...softwareFactory.hooks?.['software-factory.touch'], transform: invalidate },
      },
    });
    const linking = definePlugin({
      ...storyLinking,
      hooks: {
        ...storyLinking.hooks,
        'software-factory.start': {
          ...storyLinking.hooks?.['software-factory.start'],
          async transform({ changes, plugin }) {
            if (pendingBlocker)
              await changes.updateStory('WEB-1', (story) => ({
                ...plugin.writeBag(story, { blocks: ['WEB-2'] }),
                stage: 'todo',
              }));
          },
        },
      },
    });
    const t = await pluginRoot({ 'story-linking': true, 'software-factory': true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', stage: 'done' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', stage: 'todo' });
    const { services } = await withPlugins(t, [linking, factoryPlugin]);
    const factory = services.plugins.context('software-factory');
    const links = services.plugins.context('story-linking');
    await setStagePrompt(factory, { level: 'board', board: 'web', stage: 'todo' }, { enabled: true });
    const eligibility = async () =>
      (await runsOverview(factory, 'web')).stories.find((s) => s.key === 'WEB-2')?.eligibility;
    await expect(services.stories.list('web', { plugins: { 'story-linking': { blocks: 42 } } })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { plugin: 'story-linking' },
    });
    const file = join(t.path, 'boards/web/stories/WEB-2/story.json');
    for (const retry of [false, true]) {
      expect(await eligibility()).toEqual({ eligible: true, reasons: [] });
      const bytes = await readFile(file);
      // Hold the initial read so a link and Stage change commit before start takes its operation lock.
      const entered = deferred();
      const resume = deferred();
      const get = factory.services.stories.get;
      const spy = vi.spyOn(factory.services.stories, 'get').mockImplementationOnce(async (key) => {
        const story = await get(key);
        entered.resolve();
        await resume.promise;
        return story;
      });
      const starting = startRun(factory, 'WEB-2', { worker: 'worker', retry });
      const refused = expect(starting).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { eligibility: { eligible: false, reasons: [expect.objectContaining({ code: 'BLOCKED' })] } },
      });
      try {
        await entered.promise;
        await services.stories.move('WEB-1', 'todo');
        await addLink(links, 'WEB-1', 'WEB-2');
        resume.resolve();
        await refused;
      } finally {
        resume.resolve();
        spy.mockRestore();
      }
      expect(await readFile(file)).toEqual(bytes);
      await services.stories.move('WEB-1', 'done');
      expect(await eligibility()).toEqual({ eligible: true, reasons: [] });
      // The owning Plugin's transform reopens the completed blocker in the pending Change Set.
      const before = await services.stories.list('web', {});
      pendingBlocker = true;
      try {
        await expect(startRun(factory, 'WEB-2', { worker: 'worker', retry })).rejects.toMatchObject({
          code: 'CONFLICT',
          details: { plugin: 'story-linking', stage: 'guard' },
        });
      } finally {
        pendingBlocker = false;
      }
      expect(await services.stories.list('web', {})).toEqual(before);
      expect(await readFile(file)).toEqual(bytes);
      await startRun(factory, 'WEB-2', { worker: 'worker', retry });
      if (!retry) await endRun(factory, 'WEB-2', { status: 'failed', reason: 'retry later' });
    }
    expect((await services.stories.get('WEB-2')).plugins?.['software-factory']).toMatchObject({
      stageRun: { status: 'running', attempt: 2 },
    });
    // The fixture clock is frozen: clear/new-start and leave/return can repeat the entire RunRef.
    const metadataFile = join(t.path, 'boards/web/stories/WEB-2/plugins/software-factory/run-metadata.json');
    const story = await services.stories.get('WEB-2');
    const ref = runRef(StageRunBag.parse(story.plugins?.['software-factory']).stageRun);
    const attachment = {
      ...ref,
      worker: 'mcp:actual',
      machine: 'rook',
      harness: 't3',
      threadId: 'mcp:actual',
      source: 'receipt ROW-49',
    };
    const beforeAttachStory = await readFile(file);
    const beforeAttachMetadata = await readFile(metadataFile);
    for (const invalidation of ['worker', 'ref'] as const) {
      invalidateAttachment = invalidation;
      try {
        await expect(attachWorker(factory, 'WEB-2', attachment)).rejects.toMatchObject({
          code: 'CONFLICT',
          details: { stage: 'guard' },
        });
      } finally {
        invalidateAttachment = null;
      }
      expect(await readFile(file)).toEqual(beforeAttachStory);
      expect(await readFile(metadataFile)).toEqual(beforeAttachMetadata);
    }
    const selected = JSON.parse(await readFile(metadataFile, 'utf8'));
    selected.selection = {
      provider: 'codex',
      model: 'gpt-6.1-sol',
      options: [],
      rule: 'user named',
      fallback: null,
      usage: 'unknown',
      selectedBy: null,
      selectedAt: ref.startedAt,
    };
    await writeFile(metadataFile, JSON.stringify(selected));
    const attached = await attachWorker(factory, 'WEB-2', attachment);
    expect(JSON.parse(await readFile(metadataFile, 'utf8')).selection).toEqual(selected.selection);
    // A touch checks its Run and worker again after transforms, and keeps the other sections (ADR-0048 §2).
    const touch = { ...ref, worker: attached.identity.worker, source: 'worker message' };
    const beforeTouchBytes = await readFile(metadataFile);
    const beforeTouch = beforeTouchBytes.toString('utf8');
    const beforeTouchStory = await readFile(file);
    for (const invalidation of ['ref', 'identity'] as const) {
      invalidateAttachment = invalidation;
      try {
        await expect(touchRun(factory, 'WEB-2', touch)).rejects.toMatchObject({ code: 'CONFLICT' });
      } finally {
        invalidateAttachment = null;
      }
      expect(await readFile(metadataFile)).toEqual(beforeTouchBytes);
      expect(await readFile(file)).toEqual(beforeTouchStory);
    }
    await expect(touchRun(factory, 'WEB-2', { ...touch, worker: 'mcp:other' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await readFile(metadataFile, 'utf8')).toBe(beforeTouch);
    const touched = await touchRun(factory, 'WEB-2', touch);
    const enriched = JSON.parse(await readFile(metadataFile, 'utf8'));
    expect(enriched).toEqual({ ...JSON.parse(beforeTouch), heartbeat: touched.heartbeat });
    const unchangedMetadata = await readFile(metadataFile);
    const unchangedStory = await readFile(file);
    await attachWorker(factory, 'WEB-2', attachment);
    expect(await readFile(metadataFile)).toEqual(unchangedMetadata);
    expect(await readFile(file)).toEqual(unchangedStory);
    await expect(attachWorker(factory, 'WEB-2', { ...attachment, machine: 'thinkpad' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    invalidateAttachment = 'worker';
    try {
      await expect(attachWorker(factory, 'WEB-2', attachment)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { stage: 'guard' },
      });
    } finally {
      invalidateAttachment = null;
    }
    expect(await readFile(metadataFile)).toEqual(unchangedMetadata);
    expect(await readFile(file)).toEqual(unchangedStory);
    await endRun(factory, 'WEB-2', { status: 'failed', reason: 'launch lost' });
    expect(await readFile(metadataFile)).toEqual(unchangedMetadata);
    const retried = await startRun(factory, 'WEB-2', { worker: 'new-launch', retry: true });
    expect(JSON.parse(await readFile(metadataFile, 'utf8'))).toEqual({ version: 1, run: runRef(retried.stageRun) });
    await expect(attachWorker(factory, 'WEB-2', attachment)).rejects.toMatchObject({ code: 'CONFLICT' });
    await clearRun(factory, 'WEB-2');
    expect(await pathExists(metadataFile)).toBe(false);
    const firstVisit = await startRun(factory, 'WEB-2', { worker: 'new-launch' });
    const firstIdentity = { ...attachment, ...runRef(firstVisit.stageRun) };
    await rm(metadataFile); // A legacy Run has no metadata yet: attach can initialize it.
    await attachWorker(factory, 'WEB-2', firstIdentity);
    await clearRun(factory, 'WEB-2');
    const sameRef = await startRun(factory, 'WEB-2', { worker: 'new-launch' });
    expect(runRef(sameRef.stageRun)).toEqual(runRef(firstVisit.stageRun));
    expect(JSON.parse(await readFile(metadataFile, 'utf8'))).toEqual({ version: 1, run: runRef(sameRef.stageRun) });
    await attachWorker(factory, 'WEB-2', firstIdentity);
    await services.stories.move('WEB-2', 'in-progress');
    expect(await pathExists(metadataFile)).toBe(false);
    await services.stories.move('WEB-2', 'todo');
    const returned = await startRun(factory, 'WEB-2', { worker: 'new-launch' });
    expect(runRef(returned.stageRun)).toEqual(runRef(firstVisit.stageRun));
    expect(await readRunMetadata(factory, await services.stories.get('WEB-2'))).toMatchObject({
      status: 'valid',
      current: true,
      metadata: { run: runRef(returned.stageRun) },
    });
    expect(JSON.parse(await readFile(metadataFile, 'utf8')).identity).toBeUndefined();
    // An earlier release may leave a recognized file behind; attach initializes only for this Run.
    await writeFile(metadataFile, JSON.stringify(enriched));
    expect(await readRunMetadata(factory, await services.stories.get('WEB-2'))).toMatchObject({
      status: 'valid',
      current: false,
    });
    await attachWorker(factory, 'WEB-2', { ...attachment, ...runRef(returned.stageRun) });
    expect(JSON.parse(await readFile(metadataFile, 'utf8')).selection).toBeUndefined();
    for (const opaque of ['{"version":2,"future":"kept"}', '{"version":1,"extra":"kept"}', 'broken JSON']) {
      await writeFile(metadataFile, opaque);
      expect((await services.doctor.check()).findings).toContainEqual(
        expect.objectContaining({
          code: opaque.includes('"version":2')
            ? 'SOFTWARE_FACTORY_RUN_METADATA_UNSUPPORTED_VERSION'
            : 'SOFTWARE_FACTORY_RUN_METADATA_INVALID',
        }),
      );
      const before = await readFile(file);
      await expect(
        attachWorker(factory, 'WEB-2', { ...attachment, ...runRef(returned.stageRun) }),
      ).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
      expect(await readFile(file)).toEqual(before);
      await clearRun(factory, 'WEB-2');
      expect(await readFile(metadataFile, 'utf8')).toBe(opaque);
      await expect(startRun(factory, 'WEB-2', { worker: 'new-launch' })).rejects.toMatchObject({
        code: 'DATA_INTEGRITY',
      });
      expect(await readFile(metadataFile, 'utf8')).toBe(opaque);
      // Restore only the legacy Run to test the next opaque-file refusal.
      await writeFile(file, before);
    }
    const opaqueTarget = join(t.path, 'unreadable-run-details.json');
    await writeFile(opaqueTarget, JSON.stringify(enriched));
    const beforeUnreadable = await readFile(file);
    await rm(metadataFile);
    await symlink(opaqueTarget, metadataFile);
    expect(await readRunMetadata(factory, await services.stories.get('WEB-2'))).toMatchObject({ status: 'invalid' });
    expect((await services.doctor.check()).findings).toContainEqual(
      expect.objectContaining({ code: 'SOFTWARE_FACTORY_RUN_METADATA_INVALID' }),
    );
    await expect(attachWorker(factory, 'WEB-2', { ...attachment, ...runRef(returned.stageRun) })).rejects.toMatchObject(
      { code: 'DATA_INTEGRITY' },
    );
    await clearRun(factory, 'WEB-2');
    await expect(startRun(factory, 'WEB-2', { worker: 'new-launch' })).rejects.toMatchObject({
      code: 'DATA_INTEGRITY',
    });
    expect(await readFile(opaqueTarget, 'utf8')).toBe(JSON.stringify(enriched));
    await rm(metadataFile);
    await writeFile(file, beforeUnreadable);
    await writeFile(metadataFile, JSON.stringify({ version: 1, run: runRef(returned.stageRun) }));
    await endRun(factory, 'WEB-2', { status: 'failed', reason: 'retry later' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { 'story-linking': { blocks: 'future shape' } } });
    const saved = await readFile(file);
    await expect(eligibility()).rejects.toMatchObject({ code: 'DATA_INTEGRITY', details: { plugin: 'story-linking' } });
    await expect(startRun(factory, 'WEB-2', { worker: 'worker', retry: true })).rejects.toMatchObject({
      code: 'DATA_INTEGRITY',
    });
    expect(await readFile(file)).toEqual(saved);
    // An enabled provider that cannot load is an error, not an empty blocker list.
    const unavailable = await withPlugins(t, [softwareFactory]);
    await expect(runsOverview(unavailable.services.plugins.context('software-factory'), 'web')).rejects.toMatchObject({
      code: 'USAGE',
    });
    // Disabled Plugin data remains intact and contributes no eligibility restriction.
    await services.plugins.disable('story-linking');
    const disabled = await withPlugins(t, [storyLinking, softwareFactory]);
    expect(await runsOverview(disabled.services.plugins.context('software-factory'), 'web')).toMatchObject({
      stories: expect.arrayContaining([
        expect.objectContaining({ key: 'WEB-2', eligibility: { eligible: true, reasons: [] } }),
      ]),
    });
    expect((await disabled.services.stories.get('WEB-1')).plugins?.['story-linking']).toEqual({
      blocks: 'future shape',
    });
    expect(
      (
        await startRun(disabled.services.plugins.context('software-factory'), 'WEB-2', {
          worker: 'worker',
          retry: true,
        })
      ).stageRun.attempt,
    ).toBe(2);
  });
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
    const t = await pluginRoot({ 'story-linking': true, tasks: true, comments: true, attachments: true, github: true });
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
        github: { pr: 'https://github.com/owner/name/pull/1', version: 999, opaque: ['keep'] },
      },
    });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-3', rank: 'a2' });
    const { services } = await withPlugins(t, [storyLinking, tasks, comments, attachments, github]);
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
    for (const pr of [null, 'https://github.com/owner/name/pull/2'])
      await expect(
        services.stories.update('WEB-2', { name: 'Must not save', plugins: { github: { pr } } }),
      ).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
    const findings = (await services.doctor.check()).findings;
    await expect(
      addAttachment(services.plugins.context('attachments'), 'WEB-2', {
        name: 'image.png',
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      }),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
    for (const id of ['tasks', 'comments', 'attachments', 'github'])
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
  it('keeps Plugin files and external reads inside their capability and lifetime boundaries', async () => {
    await externalReadBoundary();
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

    // Batched reads (ADR-0052) answer each request in order; a file or Story scope fails on its own.
    const folder = join(t.path, 'plugins/binary');
    await writeFile(join(folder, 'a.txt'), 'A');
    const failed = (code: string) => ({ status: 'failed', code, message: expect.any(String) });
    expect(
      await plugin.files.readMany([
        { scope: 'dataRoot', name: 'a.txt' },
        { scope: 'dataRoot', name: 'gone.txt' },
        { scope: 'dataRoot', name: 'linked/image.png' },
        { scope: { story: 'WEB-99' }, name: 'a.txt' },
        { scope: 'dataRoot', name: 'a.txt' },
      ]),
    ).toEqual([
      { status: 'found', text: 'A' },
      { status: 'missing' },
      failed('VALIDATION'),
      failed('NOT_FOUND'),
      {
        status: 'found',
        text: 'A',
      },
    ]);
    expect(await plugin.files.listMany(['dataRoot', { story: 'WEB-99' }])).toEqual([
      { status: 'found', names: ['a.txt', 'image.png'] },
      failed('NOT_FOUND'),
    ]);
    // Each batch of 32 is its own read scope: a change that queued for the lock during one goes before the next.
    const requests = Array.from({ length: 33 }, (_, n) => ({ scope: 'dataRoot' as const, name: `n${n}.txt` }));
    for (const { name } of requests) await writeFile(join(folder, name), 'old');
    const reading = deferred();
    const resume = deferred();
    const queued = deferred();
    const read = io.readFile;
    const readSpy = vi.spyOn(io, 'readFile').mockImplementation(async (path) => {
      if (path === join(folder, 'n0.txt')) {
        reading.resolve();
        await resume.promise;
      }
      return read(path);
    });
    const timer = globalThis.setTimeout;
    let timerSpy: { mockRestore(): void } | undefined;
    try {
      const many = plugin.files.readMany(requests);
      await reading.promise;
      // `acquireLock` sets its 10 s deadline once a caller has its place in the lock's queue.
      timerSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
        if (typeof ms === 'number' && ms > 5_000) queued.resolve();
        return timer(fn, ms);
      }) as typeof setTimeout);
      const change = plugin.operation('rewrite', {}, (changes) => changes.writeFile('dataRoot', 'n32.txt', 'new'));
      await queued.promise;
      resume.resolve();
      const [result] = await Promise.all([many, change]);
      expect([result[0], result[32]]).toEqual([
        { status: 'found', text: 'old' },
        { status: 'found', text: 'new' },
      ]);
    } finally {
      resume.resolve();
      readSpy.mockRestore();
      timerSpy?.mockRestore();
    }
    // An invalid name rejects the call before anything is read; so does a Story that cannot be read.
    await expect(
      plugin.files.readMany([
        { scope: 'dataRoot', name: 'a.txt' },
        { scope: 'dataRoot', name: '../a.txt' },
      ]),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await writeFile(join(t.path, `boards/web/stories/${story.key}/story.json`), '{ not json');
    await expect(
      plugin.files.readMany([
        { scope: 'dataRoot', name: 'a.txt' },
        { scope, name: 'note.txt' },
      ]),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
    await expect(plugin.files.listMany([scope])).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
  });
});

/** Exercise the actual runner protocol without credentials, network, sleeps or a live child. */
async function externalReadBoundary() {
  const children: (EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> })[] = [];
  const realSpawn = (await vi.importActual<typeof childProcess>('node:child_process')).spawn;
  const spawn = vi.mocked(childProcess.spawn).mockImplementation((...args) => {
    if (args[0] !== 'gh') return Reflect.apply(realSpawn, childProcess, args);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    child.kill.mockImplementation((signal) => {
      if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null));
      return true;
    });
    children.push(child);
    return child as unknown as ReturnType<typeof childProcess.spawn>;
  });
  const reader = definePlugin({ id: 'reader', name: 'Reader', description: '', externalReads: ['gh-pr-view'] });
  const t = await pluginRoot({ reader: true, notes: true });
  const { services, host } = await withPlugins(t, [reader, notes]);
  const ordinary = services.plugins.context('reader');
  const lease = new AbortController();
  const screen = services.plugins.screenContext('reader', lease.signal);
  const parameters = { url: 'https://github.com/owner/name/pull/1' };
  const call = () => screen.externalRead('gh-pr-view', parameters);
  try {
    await expect(ordinary.externalRead('gh-pr-view', parameters)).rejects.toBeInstanceOf(PluginError);
    const command = invokePlugin({ plugin: 'reader', stage: 'command' }, () =>
      ordinary.externalRead('gh-pr-view', parameters),
    );
    expect(children).toHaveLength(1);
    children[0]?.stdout.write('command');
    children[0]?.emit('close', 0);
    await expect(command).resolves.toEqual({ exitCode: 0, stdout: 'command', stderr: '' });
    expect(spawn).toHaveBeenLastCalledWith(
      'gh',
      [
        'pr',
        'view',
        parameters.url,
        '--json',
        'number,title,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup',
      ],
      expect.objectContaining({ cwd: t.path, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }),
    );
    for (const stage of [
      'body',
      'replacement',
      'transform',
      'guard',
      'commit',
      'reaction',
      'doctor-check',
      'doctor-fix',
      'field',
      'filter',
      'row',
      'option-input',
    ] satisfies Stage[]) {
      await inScope({ operationId: 'boundary', operation: 'stories.update', plugin: 'reader', stage }, async () => {
        await expect(call()).rejects.toBeInstanceOf(PluginError);
      });
    }
    await services.stories.create('web', { name: 'No external read from the operation body' });
    await expect(
      screen.operation('bad', {}, async () => {
        await call();
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    await inScope({ operationId: 'ended', operation: 'command', plugin: 'reader', stage: 'command' }, async (scope) => {
      scope.ended = true;
      await expect(call()).rejects.toBeInstanceOf(PluginError);
    });
    await inScope({ operationId: 'other', operation: 'command', plugin: 'notes', stage: 'command' }, async () => {
      await expect(call()).rejects.toBeInstanceOf(PluginError);
    });
    const undeclared = services.plugins.screenContext('notes', lease.signal);
    await expect(undeclared.externalRead('gh-pr-view', parameters)).rejects.toBeInstanceOf(PluginError);
    await expect(screen.externalRead('gh-pr-view', { url: '--help' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      screen.externalRead('gh-pr-view', { url: 'https://user:password@github.com/owner/name/pull/1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(children).toHaveLength(1);

    const success = call();
    children.at(-1)?.stdout.write('screen');
    children.at(-1)?.emit('close', 0);
    await expect(success).resolves.toMatchObject({ stdout: 'screen' });
    // Fake clocks exercise deadlines and escalation, while controlled promises exercise the queue.
    vi.useFakeTimers();
    for (const stream of ['stdout', 'stderr'] as const) {
      const bounded = expect(call()).rejects.toMatchObject({
        code: 'USAGE',
        message: expect.stringContaining('output limit'),
      });
      const child = children.at(-1);
      child?.[stream].write(Buffer.alloc(stream === 'stdout' ? 1024 * 1024 + 1 : 64 * 1024 + 1));
      expect(child?.kill).toHaveBeenCalledWith('SIGTERM');
      await vi.advanceTimersByTimeAsync(250);
      await bounded;
      expect(child?.kill).toHaveBeenCalledWith('SIGKILL');
    }
    const timed = expect(call()).rejects.toMatchObject({
      code: 'USAGE',
      message: expect.stringContaining('timed out'),
    });
    await vi.advanceTimersByTimeAsync(10_250);
    await timed;

    const cancelled = new AbortController();
    const first = call(),
      second = call();
    const queued = expect(
      screen.externalRead('gh-pr-view', parameters, { signal: cancelled.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const count = children.length;
    cancelled.abort();
    await queued;
    expect(children).toHaveLength(count);
    const waiting = Array.from({ length: 8 }, () => call());
    await expect(call()).rejects.toMatchObject({ code: 'USAGE', message: expect.stringContaining('queue is full') });
    children.at(-2)?.emit('close', 0);
    children.at(-1)?.emit('close', 0);
    await Promise.all([first, second]);
    await Promise.resolve();
    expect(children.length).toBe(count + 2);
    const pending = waiting.map((promise) => expect(promise).rejects.toMatchObject({ name: 'AbortError' }));
    lease.abort();
    expect(screen.externalReadSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    await Promise.all(pending);
    await expect(call()).rejects.toMatchObject({ name: 'AbortError' });
    const fresh = services.plugins.screenContext('reader', new AbortController().signal);
    const disposing = expect(fresh.externalRead('gh-pr-view', parameters)).rejects.toMatchObject({
      name: 'AbortError',
    });
    host.dispose?.();
    expect(fresh.externalReadSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    await disposing;
    await expect(fresh.externalRead('gh-pr-view', parameters)).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    const disabled = await withPlugins(t, [reader]);
    try {
      const context = disabled.services.plugins.screenContext('reader', new AbortController().signal);
      const stopping = expect(context.externalRead('gh-pr-view', parameters)).rejects.toMatchObject({
        name: 'AbortError',
      });
      await disabled.services.plugins.disable('reader');
      await stopping;
      expect(context.externalReadSignal.aborted).toBe(true);
      await expect(context.externalRead('gh-pr-view', parameters)).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      disabled.host.dispose?.();
    }
  } finally {
    host.dispose?.();
    for (const child of children) child.emit('close', null);
    vi.useRealTimers();
    spawn.mockRestore();
    await t.cleanup();
  }
}
