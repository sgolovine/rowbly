import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DataIntegrityError, NotFoundError } from '../../src/core';
import { createRepositories, paths } from '../../src/storage';
import { FIXED_NOW, makeBoard, makeStory, tempRoot } from '../helpers';

describe('paths', () => {
  it('covers every path in the Data Root layout', () => {
    const p = paths({ path: '/r/.rowbly', kind: 'local' });
    expect(p.rootConfig).toBe('/r/.rowbly/rowbly.config.json');
    expect(p.localState).toBe('/r/.rowbly/local.json');
    expect(p.boardsDir).toBe('/r/.rowbly/boards');
    expect(p.board('web')).toBe('/r/.rowbly/boards/web');
    expect(p.boardConfig('web')).toBe('/r/.rowbly/boards/web/board.config.json');
    expect(p.storiesDir('web')).toBe('/r/.rowbly/boards/web/stories');
    expect(p.story('web', 'WEB-4')).toBe('/r/.rowbly/boards/web/stories/WEB-4/story.json');
  });
});

describe('root config and Local State', () => {
  it('a missing local.json reads as { version: 1 }', async () => {
    const t = await tempRoot();
    const repos = createRepositories(t.root);
    expect(await repos.localState.get()).toEqual({ version: 1 });
    await repos.localState.put({ version: 1, board: 'web', me: 'ana' });
    expect(await repos.localState.get()).toEqual({ version: 1, board: 'web', me: 'ana' });
  });

  it('reads and writes rowbly.config.json', async () => {
    const t = await tempRoot();
    const repos = createRepositories(t.root);
    // A config without a roster reads with an empty one.
    expect(await repos.rootConfig.get()).toEqual({ version: 1, assignees: [] });
    await repos.rootConfig.put({
      version: 1,
      assignees: [{ handle: 'sam', name: 'Sam' }],
      customFields: [{ key: 'points', name: 'Points', type: 'number', required: false }],
    });
    const config = await repos.rootConfig.get();
    expect(config.customFields).toHaveLength(1);
    expect(config.assignees).toEqual([{ handle: 'sam', name: 'Sam' }]);
  });
});

describe('boards', () => {
  it('lists, gets, finds by prefix and checks ids against the path', async () => {
    const t = await tempRoot();
    const repos = createRepositories(t.root);
    expect(await repos.boards.list()).toEqual([]);
    const web = await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    // Folders that do not match the layout are ignored.
    await mkdir(join(t.path, 'boards', 'no-config'));
    await mkdir(join(t.path, 'boards', 'Not_A_Slug'));
    expect((await repos.boards.list()).map((b) => b.id)).toEqual(['api', 'web']);
    expect(await repos.boards.get('web')).toEqual(web);
    expect(await repos.boards.findByPrefix('WEB')).toEqual(web);
    expect(await repos.boards.findByPrefix('NOPE')).toBeNull();
    await expect(repos.boards.get('nope')).rejects.toThrow(NotFoundError);

    // The prefix index is refreshed when a Board is written through the repository.
    await repos.boards.put({ ...web, id: 'mobile', keyPrefix: 'MOB' });
    expect((await repos.boards.findByPrefix('MOB'))?.id).toBe('mobile');
    await repos.boards.delete('mobile');
    expect(await repos.boards.findByPrefix('MOB')).toBeNull();
    await expect(repos.boards.delete('mobile')).rejects.toThrow(NotFoundError);
  });

  it('an id that does not match its folder is DataIntegrityError', async () => {
    const t = await tempRoot();
    const board = await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    const wrong = join(t.path, 'boards', 'other', 'board.config.json');
    await mkdir(join(t.path, 'boards', 'other'), { recursive: true });
    await writeFile(wrong, JSON.stringify(board));
    const err = await createRepositories(t.root)
      .boards.get('other')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataIntegrityError);
    expect((err as DataIntegrityError).details.path).toBe(wrong);
  });
});

describe('stories', () => {
  async function seed() {
    const t = await tempRoot();
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    await makeBoard(t.path, { id: 'ml', keyPrefix: 'ML' });
    return t;
  }

  it('reads all Stories on a Board, ordered by number', async () => {
    const t = await seed();
    for (const key of ['WEB-10', 'WEB-2', 'WEB-1']) await makeStory(t.path, { key, boardId: 'web' });
    await writeFile(join(t.path, 'boards/web/stories/notes.txt'), 'ignored');
    const repos = createRepositories(t.root);
    expect((await repos.stories.allInBoard('web')).map((s) => s.key)).toEqual(['WEB-1', 'WEB-2', 'WEB-10']);
    expect(await repos.stories.allInBoard('none')).toEqual([]);
  });

  it('finds a Story by key across Boards, case-insensitively', async () => {
    const t = await seed();
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web' });
    const ml = await makeStory(t.path, { key: 'ML-7', boardId: 'ml', name: 'Train' });
    const repos = createRepositories(t.root);
    expect(await repos.stories.findByKey('ml-7')).toEqual(ml);
    expect((await repos.stories.findByKey('WEB-1')).boardId).toBe('web');
  });

  it('an unknown prefix or number is NotFoundError', async () => {
    const t = await seed();
    const repos = createRepositories(t.root);
    await expect(repos.stories.findByKey('NOPE-1')).rejects.toThrow(NotFoundError);
    await expect(repos.stories.findByKey('WEB-99')).rejects.toThrow(NotFoundError);
  });

  it('a key that does not match the file name is DataIntegrityError', async () => {
    const t = await seed();
    const story = await makeStory(t.path, { key: 'WEB-1', boardId: 'web' });
    await mkdir(join(t.path, 'boards/web/stories/WEB-2'));
    await writeFile(join(t.path, 'boards/web/stories/WEB-2/story.json'), JSON.stringify({ ...story, key: 'WEB-1' }));
    await expect(createRepositories(t.root).stories.findByKey('WEB-2')).rejects.toThrow(DataIntegrityError);
  });

  it('puts, deletes and computes the highest Story Key number', async () => {
    const t = await seed();
    const repos = createRepositories(t.root);
    expect(await repos.stories.maxNumber('web')).toBe(0);
    const story = await makeStory(t.path, { key: 'WEB-3', boardId: 'web' });
    await repos.stories.put({ ...story, key: 'WEB-12', updatedAt: FIXED_NOW });
    expect(await repos.stories.maxNumber('web')).toBe(12);
    await repos.stories.delete('web', 'WEB-12');
    expect(await repos.stories.maxNumber('web')).toBe(3);
    await expect(repos.stories.delete('web', 'WEB-12')).rejects.toThrow(NotFoundError);
  });
});
