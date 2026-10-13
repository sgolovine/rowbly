import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DataIntegrityError, NotFoundError } from '../../src/core';
import { createRepositories, paths } from '../../src/storage';
import { FIXED_NOW, makeBoard, makeEpic, makeStory, makeWorkspace, tempRoot } from '../helpers';

describe('paths', () => {
  it('covers every path in the Data Root layout', () => {
    const p = paths({ path: '/r/.rowbly', kind: 'local' });
    expect(p.rootConfig).toBe('/r/.rowbly/rowbly.config.json');
    expect(p.localState).toBe('/r/.rowbly/local.json');
    expect(p.workspace('acme')).toBe('/r/.rowbly/workspaces/acme');
    expect(p.workspaceConfig('acme')).toBe('/r/.rowbly/workspaces/acme/workspace.config.json');
    expect(p.board('acme', 'web')).toBe('/r/.rowbly/workspaces/acme/boards/web');
    expect(p.boardConfig('acme', 'web')).toBe('/r/.rowbly/workspaces/acme/boards/web/board.config.json');
    expect(p.storiesDir('acme', 'web')).toBe('/r/.rowbly/workspaces/acme/boards/web/stories');
    expect(p.story('acme', 'web', 'WEB-4')).toBe('/r/.rowbly/workspaces/acme/boards/web/stories/WEB-4.json');
    expect(p.epicsDir('acme')).toBe('/r/.rowbly/workspaces/acme/epics');
    expect(p.epic('acme', 'launch')).toBe('/r/.rowbly/workspaces/acme/epics/launch.json');
  });
});

describe('root config and Local State', () => {
  it('a missing local.json reads as { version: 1 }', async () => {
    const t = await tempRoot();
    const repos = createRepositories(t.root);
    expect(await repos.localState.get()).toEqual({ version: 1 });
    await repos.localState.put({ version: 1, workspace: 'acme', me: 'ana' });
    expect(await repos.localState.get()).toEqual({ version: 1, workspace: 'acme', me: 'ana' });
  });

  it('reads and writes rowbly.config.json', async () => {
    const t = await tempRoot();
    const repos = createRepositories(t.root);
    expect(await repos.rootConfig.get()).toEqual({ version: 1 });
    await repos.rootConfig.put({
      version: 1,
      customFields: [{ key: 'points', name: 'Points', type: 'number', required: false }],
    });
    expect((await repos.rootConfig.get()).customFields).toHaveLength(1);
  });
});

describe('workspaces', () => {
  it('lists, gets, puts and deletes', async () => {
    const t = await tempRoot();
    const repos = createRepositories(t.root);
    expect(await repos.workspaces.list()).toEqual([]);
    await makeWorkspace(t.path, { id: 'beta' });
    const alpha = await makeWorkspace(t.path, { id: 'alpha' });
    // Folders that do not match the layout are ignored.
    await mkdir(join(t.path, 'workspaces', 'no-config'));
    await mkdir(join(t.path, 'workspaces', 'Not_A_Slug'));
    expect((await repos.workspaces.list()).map((w) => w.id)).toEqual(['alpha', 'beta']);
    expect(await repos.workspaces.get('alpha')).toEqual(alpha);

    await repos.workspaces.put({ ...alpha, name: 'Alpha!' });
    expect((await repos.workspaces.get('alpha')).name).toBe('Alpha!');

    await repos.workspaces.delete('alpha');
    await expect(repos.workspaces.get('alpha')).rejects.toThrow(NotFoundError);
    await expect(repos.workspaces.delete('alpha')).rejects.toThrow(NotFoundError);
  });

  it('an id that does not match its folder is DataIntegrityError', async () => {
    const t = await tempRoot();
    const ws = await makeWorkspace(t.path, { id: 'acme' });
    const wrong = join(t.path, 'workspaces', 'other', 'workspace.config.json');
    await mkdir(join(t.path, 'workspaces', 'other'), { recursive: true });
    await writeFile(wrong, JSON.stringify(ws));
    const err = await createRepositories(t.root)
      .workspaces.get('other')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataIntegrityError);
    expect((err as DataIntegrityError).details.path).toBe(wrong);
  });
});

describe('boards', () => {
  it('lists, gets, finds by prefix and checks ids against the path', async () => {
    const t = await tempRoot();
    const repos = createRepositories(t.root);
    await makeWorkspace(t.path, { id: 'acme' });
    const web = await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    await makeBoard(t.path, { id: 'api', workspaceId: 'acme', keyPrefix: 'API' });
    expect((await repos.boards.list('acme')).map((b) => b.id)).toEqual(['api', 'web']);
    expect(await repos.boards.list('missing')).toEqual([]);
    expect(await repos.boards.get({ workspaceId: 'acme', boardId: 'web' })).toEqual(web);
    expect(await repos.boards.findByPrefix('WEB')).toEqual(web);
    expect(await repos.boards.findByPrefix('NOPE')).toBeNull();
    await expect(repos.boards.get({ workspaceId: 'acme', boardId: 'nope' })).rejects.toThrow(NotFoundError);

    // The prefix index is refreshed when a Board is written through the repository.
    await repos.boards.put({ ...web, id: 'mobile', keyPrefix: 'MOB' });
    expect((await repos.boards.findByPrefix('MOB'))?.id).toBe('mobile');
    await repos.boards.delete({ workspaceId: 'acme', boardId: 'mobile' });
    expect(await repos.boards.findByPrefix('MOB')).toBeNull();
  });

  it('a workspaceId that does not match the path is DataIntegrityError', async () => {
    const t = await tempRoot();
    const board = await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    const path = join(t.path, 'workspaces', 'acme', 'boards', 'web', 'board.config.json');
    await writeFile(path, JSON.stringify({ ...board, workspaceId: 'other' }));
    await expect(createRepositories(t.root).boards.get({ workspaceId: 'acme', boardId: 'web' })).rejects.toThrow(
      DataIntegrityError,
    );
  });
});

describe('stories', () => {
  async function seed() {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    await makeWorkspace(t.path, { id: 'labs' });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    await makeBoard(t.path, { id: 'ml', workspaceId: 'labs', keyPrefix: 'ML' });
    return t;
  }

  it('reads all Stories on a Board, ordered by number', async () => {
    const t = await seed();
    const ref = { workspaceId: 'acme', boardId: 'web' };
    for (const key of ['WEB-10', 'WEB-2', 'WEB-1']) await makeStory(t.path, { key, ...ref });
    await writeFile(join(t.path, 'workspaces/acme/boards/web/stories/notes.txt'), 'ignored');
    const repos = createRepositories(t.root);
    expect((await repos.stories.allInBoard(ref)).map((s) => s.key)).toEqual(['WEB-1', 'WEB-2', 'WEB-10']);
    expect(await repos.stories.allInBoard({ workspaceId: 'acme', boardId: 'none' })).toEqual([]);
  });

  it('finds a Story by key across Workspaces, case-insensitively', async () => {
    const t = await seed();
    await makeStory(t.path, { key: 'WEB-1', workspaceId: 'acme', boardId: 'web' });
    const ml = await makeStory(t.path, { key: 'ML-7', workspaceId: 'labs', boardId: 'ml', name: 'Train' });
    const repos = createRepositories(t.root);
    expect(await repos.stories.findByKey('ml-7')).toEqual(ml);
    expect((await repos.stories.findByKey('WEB-1')).workspaceId).toBe('acme');
  });

  it('an unknown prefix or number is NotFoundError', async () => {
    const t = await seed();
    const repos = createRepositories(t.root);
    await expect(repos.stories.findByKey('NOPE-1')).rejects.toThrow(NotFoundError);
    await expect(repos.stories.findByKey('WEB-99')).rejects.toThrow(NotFoundError);
  });

  it('a key that does not match the file name is DataIntegrityError', async () => {
    const t = await seed();
    const story = await makeStory(t.path, { key: 'WEB-1', workspaceId: 'acme', boardId: 'web' });
    await writeFile(
      join(t.path, 'workspaces/acme/boards/web/stories/WEB-2.json'),
      JSON.stringify({ ...story, key: 'WEB-1' }),
    );
    await expect(createRepositories(t.root).stories.findByKey('WEB-2')).rejects.toThrow(DataIntegrityError);
  });

  it('puts, deletes and computes the highest Story Key number', async () => {
    const t = await seed();
    const ref = { workspaceId: 'acme', boardId: 'web' };
    const repos = createRepositories(t.root);
    expect(await repos.stories.maxNumber(ref)).toBe(0);
    const story = await makeStory(t.path, { key: 'WEB-3', ...ref });
    await repos.stories.put({ ...story, key: 'WEB-12', updatedAt: FIXED_NOW });
    expect(await repos.stories.maxNumber(ref)).toBe(12);
    await repos.stories.delete(ref, 'WEB-12');
    expect(await repos.stories.maxNumber(ref)).toBe(3);
    await expect(repos.stories.delete(ref, 'WEB-12')).rejects.toThrow(NotFoundError);
  });
});

describe('epics', () => {
  it('lists, gets, puts and deletes', async () => {
    const t = await tempRoot();
    const repos = createRepositories(t.root);
    await makeWorkspace(t.path, { id: 'acme' });
    expect(await repos.epics.list('acme')).toEqual([]);
    const launch = await makeEpic(t.path, { id: 'launch', workspaceId: 'acme' });
    await makeEpic(t.path, { id: 'beta', workspaceId: 'acme' });
    expect((await repos.epics.list('acme')).map((e) => e.id)).toEqual(['beta', 'launch']);
    expect(await repos.epics.get('acme', 'launch')).toEqual(launch);
    await repos.epics.put({ ...launch, closed: true });
    expect((await repos.epics.get('acme', 'launch')).closed).toBe(true);
    const written = await readFile(join(t.path, 'workspaces/acme/epics/launch.json'), 'utf8');
    expect(written.endsWith('}\n')).toBe(true);
    await repos.epics.delete('acme', 'launch');
    await expect(repos.epics.get('acme', 'launch')).rejects.toThrow(NotFoundError);
  });
});
