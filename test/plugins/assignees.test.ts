// The Assignees Built-in Plugin through its own operations and its input to core operations: the
// roster in `plugins/assignees/roster.json`, a Story's Assignees in its bag, and its doctor checks.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConflictError, DataIntegrityError, NotFoundError, UsageError, ValidationError } from '../../src/core';
import { assignees } from '../../src/plugins/assignees';
import { listAssignees } from '../../src/plugins/assignees/roster';
import { addAssignee, editAssignee, removeAssignee } from '../../src/plugins/assignees/service';
import { pluginStoryRows } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { assigned, fixedClock, makeBoard, makeRoster, makeStory, type TempRoot } from '../helpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

const ROSTER = [
  { handle: 'sam', name: 'Sam' },
  { handle: 'ana', name: 'Ana' },
];

/** A Data Root with the Assignees Plugin on, its roster, and Board `web`. */
async function setup(opts: { roster?: typeof ROSTER; me?: string | null } = {}) {
  const t = await pluginRoot({ assignees: true });
  if (opts.roster) await makeRoster(t.path, opts.roster);
  const clock = fixedClock();
  const loaded = await withPlugins(t, [assignees], { me: opts.me ?? null, now: clock.now });
  return { t, clock, ...loaded, plugin: loaded.services.plugins.context('assignees') };
}

const stored = (t: TempRoot, key: string) => createRepositories(t.root).stories.findByKey(key);
const bagOf = async (t: TempRoot, key: string) => (await stored(t, key)).plugins?.assignees;

describe('the roster', () => {
  it('adds, lists and edits Assignees in plugins/assignees/roster.json, leaving rowbly.config.json alone', async () => {
    const { t, plugin } = await setup();
    const rootBefore = await readFile(join(t.path, 'rowbly.config.json'), 'utf8');
    expect(await listAssignees(plugin)).toEqual([]);
    expect(await addAssignee(plugin, { handle: 'sam', name: 'Sam', email: 'sam@example.com' })).toEqual({
      handle: 'sam',
      name: 'Sam',
      email: 'sam@example.com',
    });
    await addAssignee(plugin, { handle: 'ana', name: 'Ana', email: '' });
    expect(await listAssignees(plugin)).toEqual([
      { handle: 'sam', name: 'Sam', email: 'sam@example.com' },
      { handle: 'ana', name: 'Ana' },
    ]);
    expect(await editAssignee(plugin, 'sam', { name: 'Samantha' })).toEqual({
      handle: 'sam',
      name: 'Samantha',
      email: 'sam@example.com',
    });
    expect(await editAssignee(plugin, 'sam', { email: null })).toEqual({ handle: 'sam', name: 'Samantha' });
    expect(await editAssignee(plugin, 'ana', { email: 'ana@example.com' })).toMatchObject({ email: 'ana@example.com' });

    expect(await readFile(join(t.path, 'plugins/assignees/roster.json'), 'utf8')).toBe(
      `${JSON.stringify(
        {
          version: 1,
          assignees: [
            { handle: 'sam', name: 'Samantha' },
            { handle: 'ana', name: 'Ana', email: 'ana@example.com' },
          ],
        },
        null,
        2,
      )}\n`,
    );
    expect(await readFile(join(t.path, 'rowbly.config.json'), 'utf8')).toBe(rootBefore);
  });

  it('refuses duplicate handles, invalid emails and handles, and unknown Assignees', async () => {
    const { plugin } = await setup({ roster: ROSTER });
    await expect(addAssignee(plugin, { handle: 'sam', name: 'Other' })).rejects.toThrow(ConflictError);
    const badEmail = addAssignee(plugin, { handle: 'bo', name: 'Bo', email: 'not-an-email' });
    await expect(badEmail).rejects.toThrow(ValidationError);
    await expect(badEmail).rejects.toMatchObject({ details: { issues: [{ path: ['email'] }] } });
    await expect(editAssignee(plugin, 'sam', { email: 'nope' })).rejects.toThrow(ValidationError);
    await expect(addAssignee(plugin, { handle: 'Bad Handle', name: 'x' })).rejects.toThrow(ValidationError);
    await expect(editAssignee(plugin, 'ghost', { name: 'x' })).rejects.toThrow(NotFoundError);
    await expect(removeAssignee(plugin, 'ghost')).rejects.toThrow(NotFoundError);
    expect((await listAssignees(plugin)).map((a) => a.handle)).toEqual(['sam', 'ana']);
  });

  it('remove unassigns the handle from every Story on every Board and warns with the count', async () => {
    const { t, clock, plugin, warnings } = await setup({ roster: ROSTER });
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web', ...assigned('sam', 'ana') });
    await makeStory(t.path, { key: 'WEB-2', boardId: 'web', rank: 'a1', ...assigned('ana') });
    await makeStory(t.path, { key: 'API-1', boardId: 'api', ...assigned('sam') });
    clock.advance(1000);
    const now = clock.now().toISOString();

    expect(await removeAssignee(plugin, 'sam')).toEqual({ handle: 'sam', storiesUpdated: 2 });
    expect(warnings).toEqual(['Assignee "sam" removed from 2 stories']);
    expect((await listAssignees(plugin)).map((a) => a.handle)).toEqual(['ana']);
    expect(await stored(t, 'WEB-1')).toMatchObject({ plugins: { assignees: { assignees: ['ana'] } }, updatedAt: now });
    // A Story left without Assignees has no bag; one that never had the handle is not touched.
    expect((await stored(t, 'API-1')).plugins).toBeUndefined();
    expect((await stored(t, 'WEB-2')).updatedAt).not.toBe(now);

    await addAssignee(plugin, { handle: 'bob', name: 'Bob' });
    await makeStory(t.path, { key: 'API-2', boardId: 'api', rank: 'a1', ...assigned('bob') });
    expect(await removeAssignee(plugin, 'bob')).toEqual({ handle: 'bob', storiesUpdated: 1 });
    expect(warnings.at(-1)).toBe('Assignee "bob" removed from 1 story');
  });

  it('a roster file that cannot be read is DATA_INTEGRITY and is kept as it is', async () => {
    const { t, plugin } = await setup();
    await makeRoster(t.path, []);
    const path = join(t.path, 'plugins/assignees/roster.json');
    await writeFile(path, '{ not json');
    await expect(listAssignees(plugin)).rejects.toThrow(DataIntegrityError);
    await expect(addAssignee(plugin, { handle: 'sam', name: 'Sam' })).rejects.toThrow(DataIntegrityError);
    expect(await readFile(path, 'utf8')).toBe('{ not json');
  });
});

describe('Assignees of Stories', () => {
  it('stories.create and stories.update take assignees, add and remove, with me as Me', async () => {
    const { t, services } = await setup({ roster: ROSTER, me: 'ana' });
    const created = await services.stories.create('web', {
      name: 'A',
      plugins: { assignees: { assignees: ['sam', 'me', 'sam'] } },
    });
    expect(created.plugins).toEqual({ assignees: { assignees: ['sam', 'ana'] } });
    expect(created.createdBy).toBe('ana');

    await services.stories.update('WEB-1', { plugins: { assignees: { remove: ['me'] } } });
    expect(await bagOf(t, 'WEB-1')).toEqual({ assignees: ['sam'] });
    await services.stories.update('WEB-1', { plugins: { assignees: { add: ['ana'], remove: ['sam'] } } });
    expect(await bagOf(t, 'WEB-1')).toEqual({ assignees: ['ana'] });
    await services.stories.update('WEB-1', { plugins: { assignees: { assignees: ['sam'] } } });
    expect(await bagOf(t, 'WEB-1')).toEqual({ assignees: ['sam'] });
    // An empty list clears the bag.
    await services.stories.update('WEB-1', { plugins: { assignees: { assignees: [] } } });
    expect((await stored(t, 'WEB-1')).plugins).toBeUndefined();
    // Replacing and adding at once is refused.
    await expect(
      services.stories.update('WEB-1', { plugins: { assignees: { assignees: ['sam'], add: ['ana'] } } }),
    ).rejects.toThrow(ValidationError);
  });

  it('createdBy is Me as is, even outside the roster, and null without Me', async () => {
    const outside = await setup({ roster: ROSTER, me: 'stranger' });
    expect((await outside.services.stories.create('web', { name: 'A' })).createdBy).toBe('stranger');
    const nobody = await setup({ roster: ROSTER });
    expect((await nobody.services.stories.create('web', { name: 'A' })).createdBy).toBeNull();
  });

  it('refuses me without Me, and unknown handles with the valid ones in details; nothing is saved', async () => {
    const { t, services } = await setup({ roster: ROSTER });
    await expect(
      services.stories.create('web', { name: 'A', plugins: { assignees: { assignees: ['me'] } } }),
    ).rejects.toThrow(UsageError);
    const unknown = services.stories.create('web', {
      name: 'A',
      plugins: { assignees: { assignees: ['zed', 'sam'] } },
    });
    await expect(unknown).rejects.toThrow(ValidationError);
    await expect(unknown).rejects.toMatchObject({
      message: 'unknown Assignee "zed"',
      details: { validHandles: ['sam', 'ana'], issues: [{ path: ['assignees'], message: 'unknown Assignee "zed"' }] },
    });
    expect(await createRepositories(t.root).stories.allInBoard('web')).toEqual([]);
  });

  it('adding to an invalid stored list throws rather than overwriting it', async () => {
    const { t, services } = await setup({ roster: ROSTER });
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web', plugins: { assignees: { assignees: 'sam' } } });
    await expect(services.stories.update('WEB-1', { plugins: { assignees: { add: ['ana'] } } })).rejects.toThrow(
      DataIntegrityError,
    );
    expect(await bagOf(t, 'WEB-1')).toEqual({ assignees: 'sam' });
  });

  it('filters stories.list by any of the handles, with me as Me', async () => {
    const { t, services } = await setup({ roster: ROSTER, me: 'ana' });
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web', ...assigned('sam') });
    await makeStory(t.path, { key: 'WEB-2', boardId: 'web', rank: 'a1', ...assigned('ana') });
    await makeStory(t.path, { key: 'WEB-3', boardId: 'web', rank: 'a2' });
    const keys = async (handles: string[]) =>
      (await services.stories.list('web', { plugins: { assignees: handles } })).map((s) => s.key);
    expect(await keys(['me'])).toEqual(['WEB-2']);
    expect(await keys(['sam', 'ana'])).toEqual(['WEB-1', 'WEB-2']);

    const noMe = await setup({ roster: ROSTER });
    await makeStory(noMe.t.path, { key: 'WEB-1', boardId: 'web' });
    await expect(noMe.services.stories.list('web', { plugins: { assignees: ['me'] } })).rejects.toThrow(UsageError);
  });

  it('shows a Story row', async () => {
    const { t, ctx, services } = await setup({ roster: ROSTER });
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web', ...assigned('sam', 'ana') });
    await makeStory(t.path, { key: 'WEB-2', boardId: 'web', rank: 'a1' });
    expect(await pluginStoryRows(ctx, services, await stored(t, 'WEB-1'))).toEqual([
      { label: 'Assignees', value: 'sam, ana' },
    ]);
    expect(await pluginStoryRows(ctx, services, await stored(t, 'WEB-2'))).toEqual([
      { label: 'Assignees', value: 'none' },
    ]);
  });
});

describe('doctor', () => {
  it('removes Assignees that are not in the roster, and clears a Me outside it', async () => {
    const { t, services } = await setup({ roster: ROSTER });
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web', ...assigned('sam', 'ghost') });
    await writeFile(join(t.path, 'local.json'), `${JSON.stringify({ version: 1, me: 'stranger' })}\n`);
    const report = await services.doctor.check();
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ASSIGNEES_UNKNOWN_ASSIGNEE',
          severity: 'warning',
          path: storyFile('WEB-1'),
          message: 'WEB-1 has Assignees not in the roster: ghost',
          fixable: true,
        }),
        expect.objectContaining({
          code: 'ASSIGNEES_UNKNOWN_ME',
          severity: 'warning',
          path: 'local.json',
          message: 'Me "stranger" is not in the roster',
          fixable: true,
        }),
      ]),
    );
    const fixed = await services.doctor.fix();
    expect(fixed.fixed.map((f) => f.message)).toEqual(
      expect.arrayContaining(['removed ghost from WEB-1', 'cleared me "stranger" from Local State']),
    );
    expect(await bagOf(t, 'WEB-1')).toEqual({ assignees: ['sam'] });
    expect(await readJsonFile(t, 'local.json')).toEqual({ version: 1 });
    expect(fixed.findings.filter((f) => f.code.startsWith('ASSIGNEES_'))).toEqual([]);
  });

  it('reports a roster file that cannot be read as ROSTER_UNAVAILABLE and leaves it', async () => {
    const { t, services } = await setup({ roster: ROSTER });
    const path = join(t.path, 'plugins/assignees/roster.json');
    await writeFile(path, '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n');
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web', ...assigned('ghost') });
    const { findings } = await services.doctor.check();
    const own = findings.filter((f) => f.code.startsWith('ASSIGNEES_'));
    expect(own).toEqual([
      expect.objectContaining({
        code: 'ASSIGNEES_ROSTER_UNAVAILABLE',
        severity: 'error',
        path: 'plugins/assignees/roster.json',
        fixable: false,
      }),
    ]);
    expect(own[0]?.message).toContain('git conflict markers');
    await services.doctor.fix();
    expect(await readFile(path, 'utf8')).toContain('<<<<<<< HEAD');
    expect(await bagOf(t, 'WEB-1')).toEqual({ assignees: ['ghost'] });
  });
});
