import { DataIntegrityError, isSlug, NotFoundError, parseStoryKey, STORY_KEY_RE } from '../core';
import {
  type BoardConfig,
  BoardConfigSchema,
  type DataRoot,
  type KeyPrefix,
  type LocalState,
  LocalStateSchema,
  type RowblyConfig,
  RowblyConfigSchema,
  type Slug,
  type Story,
  type StoryKey,
  StorySchema,
} from '../schemas';
import { listEntries, readJson, remove, writeJson } from './jsonStore';
import { paths } from './paths';

export interface RootConfigRepository {
  get(): Promise<RowblyConfig>;
  put(config: RowblyConfig): Promise<void>;
}

export interface LocalStateRepository {
  /** A missing `local.json` reads as `{ version: 1 }`. */
  get(): Promise<LocalState>;
  put(state: LocalState): Promise<void>;
}

export interface BoardRepository {
  list(): Promise<BoardConfig[]>;
  get(id: Slug): Promise<BoardConfig>;
  put(board: BoardConfig): Promise<void>;
  /** Deletes the Board folder recursively. */
  delete(id: Slug): Promise<void>;
  findByPrefix(prefix: KeyPrefix): Promise<BoardConfig | null>;
}

export interface StoryRepository {
  allInBoard(board: Slug): Promise<Story[]>;
  /** Case-insensitive key, resolved through the prefix index. */
  findByKey(key: string): Promise<Story>;
  put(story: Story): Promise<void>;
  delete(board: Slug, key: StoryKey): Promise<void>;
  /** Highest Story Key number on the Board, or 0. */
  maxNumber(board: Slug): Promise<number>;
}

export interface Repositories {
  rootConfig: RootConfigRepository;
  localState: LocalStateRepository;
  boards: BoardRepository;
  stories: StoryRepository;
}

/** Repositories over one Data Root. Caches (such as the prefix index) live as long as the returned object. */
export function createRepositories(root: DataRoot): Repositories {
  const p = paths(root);
  // Board key prefix → Board id, built from every board.config.json on first use.
  let prefixIndex: Promise<Map<KeyPrefix, Slug>> | null = null;

  const boards: BoardRepository = {
    async list() {
      const ids = (await listEntries(p.boardsDir, 'directory')).filter(isSlug);
      const found = await Promise.all(ids.map((id) => orNull(boards.get(id))));
      return found.filter((board) => board !== null);
    },
    async get(id) {
      if (!isSlug(id)) throw boardNotFound(id);
      const path = p.boardConfig(id);
      const board = await rethrowNotFound(readJson(path, BoardConfigSchema), () => boardNotFound(id));
      expectMatch(path, 'id', board.id, id);
      return board;
    },
    async put(board) {
      await writeJson(p.boardConfig(board.id), BoardConfigSchema, board);
      prefixIndex = null;
    },
    async delete(id) {
      if (!isSlug(id)) throw boardNotFound(id);
      await rethrowNotFound(remove(p.board(id)), () => boardNotFound(id));
      prefixIndex = null;
    },
    async findByPrefix(prefix) {
      const id = (await getPrefixIndex()).get(prefix.toUpperCase());
      return id ? boards.get(id) : null;
    },
  };

  function getPrefixIndex(): Promise<Map<KeyPrefix, Slug>> {
    prefixIndex ??= buildPrefixIndex().catch((err) => {
      prefixIndex = null;
      throw err;
    });
    return prefixIndex;
  }

  async function buildPrefixIndex(): Promise<Map<KeyPrefix, Slug>> {
    const index = new Map<KeyPrefix, Slug>();
    for (const board of await boards.list()) {
      // A duplicate prefix is a `doctor` finding; the first Board (by id order) wins here.
      if (!index.has(board.keyPrefix)) index.set(board.keyPrefix, board.id);
    }
    return index;
  }

  async function readStory(board: Slug, key: StoryKey): Promise<Story> {
    const path = p.story(board, key);
    const story = await rethrowNotFound(readJson(path, StorySchema), () => storyNotFound(key));
    expectMatch(path, 'key', story.key, key);
    expectMatch(path, 'boardId', story.boardId, board);
    return story;
  }

  async function storyKeysInBoard(board: Slug): Promise<StoryKey[]> {
    const files = await listEntries(p.storiesDir(board), 'file');
    return files
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((key) => STORY_KEY_RE.test(key));
  }

  const stories: StoryRepository = {
    async allInBoard(board) {
      const keys = await storyKeysInBoard(board);
      const all = await Promise.all(keys.map((key) => readStory(board, key)));
      return all.sort((a, b) => storyNumber(a.key) - storyNumber(b.key) || a.key.localeCompare(b.key));
    },
    async findByKey(input) {
      const { key, prefix } = parseStoryKey(input);
      const board = (await getPrefixIndex()).get(prefix);
      if (!board) throw storyNotFound(key, `no Board has key prefix "${prefix}"`);
      return readStory(board, key);
    },
    async put(story) {
      await writeJson(p.story(story.boardId, story.key), StorySchema, story);
    },
    async delete(board, key) {
      if (!STORY_KEY_RE.test(key)) throw storyNotFound(key);
      await rethrowNotFound(remove(p.story(board, key)), () => storyNotFound(key));
    },
    async maxNumber(board) {
      const { keyPrefix } = await boards.get(board);
      const numbers = (await storyKeysInBoard(board))
        .map((key) => parseStoryKey(key))
        .filter((parts) => parts.prefix === keyPrefix)
        .map((parts) => parts.n);
      return Math.max(0, ...numbers);
    },
  };

  return {
    rootConfig: {
      get: () => readJson(p.rootConfig, RowblyConfigSchema),
      put: (config) => writeJson(p.rootConfig, RowblyConfigSchema, config),
    },
    localState: {
      async get() {
        try {
          return await readJson(p.localState, LocalStateSchema);
        } catch (err) {
          if (err instanceof NotFoundError) return { version: 1 };
          throw err;
        }
      },
      put: (state) => writeJson(p.localState, LocalStateSchema, state),
    },
    boards,
    stories,
  };
}

function storyNumber(key: StoryKey): number {
  return parseStoryKey(key).n;
}

/** The id stored inside a file must equal its folder/file name (contracts §1). */
function expectMatch(path: string, field: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new DataIntegrityError(`${path}: ${field} "${actual}" does not match its path ("${expected}")`, {
      details: { path, field, actual, expected },
      hint: 'run `rowbly doctor`',
    });
  }
}

async function rethrowNotFound<T>(promise: Promise<T>, error: () => NotFoundError): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof NotFoundError) throw error();
    throw err;
  }
}

/** A folder without its config file is not part of the layout, so lists skip it. */
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

function boardNotFound(id: string): NotFoundError {
  return new NotFoundError(`Board "${id}" not found`);
}

function storyNotFound(key: string, hint?: string): NotFoundError {
  return new NotFoundError(`Story "${key}" not found`, { hint });
}
