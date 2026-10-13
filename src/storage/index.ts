// Storage & Configuration Layer (contracts §9). The only layer allowed to touch `node:fs`.
// WP00 ships these signatures as stubs; WP01 implements them.
import type { ZodType } from 'zod';
import type {
  BoardConfig,
  BoardRef,
  DataRoot,
  EffectiveBoardConfig,
  Epic,
  KeyPrefix,
  LocalState,
  RowblyConfig,
  Slug,
  Story,
  StoryKey,
  WorkspaceConfig,
} from '../schemas';

export { editTextInEditor, gitUserEmail, readTextFile } from './system';

function notImplemented(): never {
  throw new Error('not implemented: WP01');
}

export interface FindDataRootOptions {
  cwd: string;
  /** `--root`. */
  flag?: string;
  env: NodeJS.ProcessEnv;
  home: string;
}

/** `--root` → `ROWBLY_ROOT` → nearest `.rowbly/` walking up from cwd → `~/.rowbly` if it exists → `DataRootNotFoundError`. */
export async function findDataRoot(_opts: FindDataRootOptions): Promise<DataRoot> {
  notImplemented();
}

export interface DataRootPaths {
  rootConfig: string;
  localState: string;
  workspace(ws: Slug): string;
  workspaceConfig(ws: Slug): string;
  board(ws: Slug, board: Slug): string;
  boardConfig(ws: Slug, board: Slug): string;
  storiesDir(ws: Slug, board: Slug): string;
  story(ws: Slug, board: Slug, key: StoryKey): string;
  epicsDir(ws: Slug): string;
  epic(ws: Slug, id: Slug): string;
}

/** Absolute paths for every file and folder in the Data Root layout (contracts §1). */
export function paths(_root: DataRoot): DataRootPaths {
  notImplemented();
}

/** ENOENT → `NotFoundError`; bad JSON or schema failure → `DataIntegrityError`. */
export async function readJson<T>(_path: string, _schema: ZodType<T>): Promise<T> {
  notImplemented();
}

/** Validate → mkdir -p → write temp → rename. 2-space indent, trailing newline, keys in schema order. */
export async function writeJson<T>(_path: string, _schema: ZodType<T>, _value: T): Promise<void> {
  notImplemented();
}

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
export function createRepositories(_root: DataRoot): Repositories {
  notImplemented();
}

/** Effective Stages and Custom Fields for a Board, with the level each came from (contracts §3). */
export async function resolveCascade(_root: DataRoot, _ref: BoardRef): Promise<EffectiveBoardConfig> {
  notImplemented();
}
