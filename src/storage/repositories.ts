import { DataIntegrityError, isSlug, NotFoundError, parseStoryKey, STORY_KEY_RE } from '../core';
import {
  type BoardConfig,
  BoardConfigSchema,
  type BoardRef,
  type DataRoot,
  type Epic,
  EpicSchema,
  type KeyPrefix,
  type LocalState,
  LocalStateSchema,
  type RowblyConfig,
  RowblyConfigSchema,
  type Slug,
  type Story,
  type StoryKey,
  StorySchema,
  type WorkspaceConfig,
  WorkspaceConfigSchema,
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

export interface WorkspaceRepository {
  list(): Promise<WorkspaceConfig[]>;
  get(id: Slug): Promise<WorkspaceConfig>;
  put(workspace: WorkspaceConfig): Promise<void>;
  /** Deletes the Workspace folder recursively. */
  delete(id: Slug): Promise<void>;
}

export interface BoardRepository {
  list(ws: Slug): Promise<BoardConfig[]>;
  get(ref: BoardRef): Promise<BoardConfig>;
  put(board: BoardConfig): Promise<void>;
  /** Deletes the Board folder recursively. */
  delete(ref: BoardRef): Promise<void>;
  findByPrefix(prefix: KeyPrefix): Promise<BoardConfig | null>;
}

export interface StoryRepository {
  allInBoard(ref: BoardRef): Promise<Story[]>;
  /** Case-insensitive key, resolved through the prefix index. */
  findByKey(key: string): Promise<Story>;
  put(story: Story): Promise<void>;
  delete(ref: BoardRef, key: StoryKey): Promise<void>;
  /** Highest Story Key number on the Board, or 0. */
  maxNumber(ref: BoardRef): Promise<number>;
}

export interface EpicRepository {
  list(ws: Slug): Promise<Epic[]>;
  get(ws: Slug, id: Slug): Promise<Epic>;
  put(epic: Epic): Promise<void>;
  delete(ws: Slug, id: Slug): Promise<void>;
}

export interface Repositories {
  rootConfig: RootConfigRepository;
  localState: LocalStateRepository;
  workspaces: WorkspaceRepository;
  boards: BoardRepository;
  stories: StoryRepository;
  epics: EpicRepository;
}

/** Repositories over one Data Root. Caches (such as the prefix index) live as long as the returned object. */
export function createRepositories(root: DataRoot): Repositories {
  const p = paths(root);
  // Board key prefix → Board, built from every board.config.json on first use.
  let prefixIndex: Promise<Map<KeyPrefix, BoardRef>> | null = null;

  const workspaces: WorkspaceRepository = {
    async list() {
      const ids = (await listEntries(p.workspacesDir, 'directory')).filter(isSlug);
      const found = await Promise.all(ids.map((id) => orNull(workspaces.get(id))));
      return found.filter((ws) => ws !== null);
    },
    async get(id) {
      if (!isSlug(id)) throw workspaceNotFound(id);
      const path = p.workspaceConfig(id);
      const ws = await rethrowNotFound(readJson(path, WorkspaceConfigSchema), () => workspaceNotFound(id));
      expectMatch(path, 'id', ws.id, id);
      return ws;
    },
    async put(ws) {
      await writeJson(p.workspaceConfig(ws.id), WorkspaceConfigSchema, ws);
    },
    async delete(id) {
      if (!isSlug(id)) throw workspaceNotFound(id);
      await rethrowNotFound(remove(p.workspace(id)), () => workspaceNotFound(id));
      prefixIndex = null;
    },
  };

  const boards: BoardRepository = {
    async list(ws) {
      if (!isSlug(ws)) return [];
      const ids = (await listEntries(p.boardsDir(ws), 'directory')).filter(isSlug);
      const found = await Promise.all(ids.map((boardId) => orNull(boards.get({ workspaceId: ws, boardId }))));
      return found.filter((board) => board !== null);
    },
    async get(ref) {
      if (!isSlug(ref.workspaceId) || !isSlug(ref.boardId)) throw boardNotFound(ref);
      const path = p.boardConfig(ref.workspaceId, ref.boardId);
      const board = await rethrowNotFound(readJson(path, BoardConfigSchema), () => boardNotFound(ref));
      expectMatch(path, 'id', board.id, ref.boardId);
      expectMatch(path, 'workspaceId', board.workspaceId, ref.workspaceId);
      return board;
    },
    async put(board) {
      await writeJson(p.boardConfig(board.workspaceId, board.id), BoardConfigSchema, board);
      prefixIndex = null;
    },
    async delete(ref) {
      if (!isSlug(ref.workspaceId) || !isSlug(ref.boardId)) throw boardNotFound(ref);
      await rethrowNotFound(remove(p.board(ref.workspaceId, ref.boardId)), () => boardNotFound(ref));
      prefixIndex = null;
    },
    async findByPrefix(prefix) {
      const ref = (await getPrefixIndex()).get(prefix.toUpperCase());
      return ref ? boards.get(ref) : null;
    },
  };

  function getPrefixIndex(): Promise<Map<KeyPrefix, BoardRef>> {
    prefixIndex ??= buildPrefixIndex().catch((err) => {
      prefixIndex = null;
      throw err;
    });
    return prefixIndex;
  }

  async function buildPrefixIndex(): Promise<Map<KeyPrefix, BoardRef>> {
    const index = new Map<KeyPrefix, BoardRef>();
    for (const ws of await workspaces.list()) {
      for (const board of await boards.list(ws.id)) {
        // A duplicate prefix is a `doctor` finding; the first Board (by id order) wins here.
        if (!index.has(board.keyPrefix)) index.set(board.keyPrefix, { workspaceId: ws.id, boardId: board.id });
      }
    }
    return index;
  }

  async function readStory(ref: BoardRef, key: StoryKey): Promise<Story> {
    const path = p.story(ref.workspaceId, ref.boardId, key);
    const story = await rethrowNotFound(readJson(path, StorySchema), () => storyNotFound(key));
    expectMatch(path, 'key', story.key, key);
    expectMatch(path, 'workspaceId', story.workspaceId, ref.workspaceId);
    expectMatch(path, 'boardId', story.boardId, ref.boardId);
    return story;
  }

  async function storyKeysInBoard(ref: BoardRef): Promise<StoryKey[]> {
    const files = await listEntries(p.storiesDir(ref.workspaceId, ref.boardId), 'file');
    return files
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((key) => STORY_KEY_RE.test(key));
  }

  const stories: StoryRepository = {
    async allInBoard(ref) {
      const keys = await storyKeysInBoard(ref);
      const all = await Promise.all(keys.map((key) => readStory(ref, key)));
      return all.sort((a, b) => storyNumber(a.key) - storyNumber(b.key) || a.key.localeCompare(b.key));
    },
    async findByKey(input) {
      const { key, prefix } = parseStoryKey(input);
      const ref = (await getPrefixIndex()).get(prefix);
      if (!ref) throw storyNotFound(key, `no Board has key prefix "${prefix}"`);
      return readStory(ref, key);
    },
    async put(story) {
      await writeJson(p.story(story.workspaceId, story.boardId, story.key), StorySchema, story);
    },
    async delete(ref, key) {
      if (!STORY_KEY_RE.test(key)) throw storyNotFound(key);
      await rethrowNotFound(remove(p.story(ref.workspaceId, ref.boardId, key)), () => storyNotFound(key));
    },
    async maxNumber(ref) {
      const { keyPrefix } = await boards.get(ref);
      const numbers = (await storyKeysInBoard(ref))
        .map((key) => parseStoryKey(key))
        .filter((parts) => parts.prefix === keyPrefix)
        .map((parts) => parts.n);
      return Math.max(0, ...numbers);
    },
  };

  const epics: EpicRepository = {
    async list(ws) {
      if (!isSlug(ws)) return [];
      const files = await listEntries(p.epicsDir(ws), 'file');
      const ids = files
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .filter(isSlug);
      return Promise.all(ids.map((id) => epics.get(ws, id)));
    },
    async get(ws, id) {
      if (!isSlug(ws) || !isSlug(id)) throw epicNotFound(ws, id);
      const path = p.epic(ws, id);
      const epic = await rethrowNotFound(readJson(path, EpicSchema), () => epicNotFound(ws, id));
      expectMatch(path, 'id', epic.id, id);
      expectMatch(path, 'workspaceId', epic.workspaceId, ws);
      return epic;
    },
    async put(epic) {
      await writeJson(p.epic(epic.workspaceId, epic.id), EpicSchema, epic);
    },
    async delete(ws, id) {
      if (!isSlug(ws) || !isSlug(id)) throw epicNotFound(ws, id);
      await rethrowNotFound(remove(p.epic(ws, id)), () => epicNotFound(ws, id));
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
    workspaces,
    boards,
    stories,
    epics,
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

function workspaceNotFound(id: string): NotFoundError {
  return new NotFoundError(`Workspace "${id}" not found`);
}

function boardNotFound(ref: BoardRef): NotFoundError {
  return new NotFoundError(`Board "${ref.workspaceId}/${ref.boardId}" not found`);
}

function storyNotFound(key: string, hint?: string): NotFoundError {
  return new NotFoundError(`Story "${key}" not found`, { hint });
}

function epicNotFound(ws: string, id: string): NotFoundError {
  return new NotFoundError(`Epic "${id}" not found in Workspace "${ws}"`);
}
