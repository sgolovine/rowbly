import { join } from 'node:path';
import type { ZodType } from 'zod';
import { NotFoundError, parseStoryKey, ValidationError } from '../../core';
import {
  type BoardConfig,
  BoardConfigSchema,
  type DataRoot,
  type LocalState,
  LocalStateSchema,
  type RowblyConfig,
  RowblyConfigSchema,
  type Story,
  StorySchema,
} from '../../schemas';
import {
  listFilesUnder,
  moveFolders,
  paths,
  type Repositories,
  readTextIfExists,
  removeFile,
  writeTextFile,
} from '../../storage';
import type {
  BoardChange,
  Change,
  ChangeSet,
  ChangeSetView,
  FileChange,
  FileScope,
  PluginChangeSet,
  StoryChange,
} from './types';

/** A file name inside a Plugin folder: `/`-separated segments, none of them `.` or `..`. */
const FILE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;

/**
 * Collects what an operation creates, changes and deletes, then saves it all in `save()`. Core
 * operations use it directly; Plugins get `forPlugin(id)`, which can also write their files.
 */
export class CoreChangeSet implements ChangeSet {
  private readonly list: Change[] = [];
  /** For each file change, the record folder above its `plugins/` folder: removing a file prunes up to it. */
  private readonly fileStops = new Map<FileChange, string>();

  constructor(
    private readonly root: DataRoot,
    private readonly repos: Repositories,
  ) {}

  get changes(): readonly Change[] {
    return this.list;
  }

  story(key: string): StoryChange | undefined {
    const upper = key.toUpperCase();
    return this.stories().find((c) => c.after?.key === upper || c.before?.key === upper);
  }

  board(id: string): BoardChange | undefined {
    return this.list.find((c): c is BoardChange => c.type === 'board' && (c.after ?? c.before)?.id === id);
  }

  async putStory(story: Story): Promise<Story> {
    const next = valid(StorySchema, 'Story', story);
    const pending = this.current(next.key);
    if (pending) pending.after = next;
    else this.list.push({ type: 'story', before: await this.storedStory(next.key), after: next });
    return next;
  }

  async updateStory(key: string, update: (story: Story) => Story): Promise<Story> {
    const pending = this.current(key);
    const latest = pending ? pending.after : await this.repos.stories.findByKey(key);
    if (!latest) throw new NotFoundError(`Story "${key.toUpperCase()}" not found`);
    return this.putStory(update(latest));
  }

  async deleteStory(key: string): Promise<void> {
    const pending = this.current(key);
    if (pending) pending.after = null;
    else this.list.push({ type: 'story', before: await this.repos.stories.findByKey(key), after: null });
  }

  /** Records a Story change with a known `before`, for `doctor --fix`, which reads files itself. */
  recordStory(before: Story | null, after: Story, beforeFolder?: string): void {
    const next = valid(StorySchema, 'Story', after);
    this.list.push({ type: 'story', before, after: next, ...(beforeFolder ? { beforeFolder } : {}) });
  }

  async putBoard(board: BoardConfig): Promise<BoardConfig> {
    const next = valid(BoardConfigSchema, 'Board', board);
    const pending = this.board(next.id);
    if (pending) pending.after = next;
    else this.list.push({ type: 'board', before: await orNull(this.repos.boards.get(next.id)), after: next });
    return next;
  }

  async updateBoard(id: string, update: (board: BoardConfig) => BoardConfig): Promise<BoardConfig> {
    const pending = this.board(id);
    const latest = pending ? pending.after : await this.repos.boards.get(id);
    if (!latest) throw new NotFoundError(`Board "${id}" not found`);
    return this.putBoard(update(latest));
  }

  /** Deletes a Board with its folder, and each of its Stories (listed so Plugins see them go). */
  async deleteBoard(id: string): Promise<void> {
    const before = await this.repos.boards.get(id);
    for (const story of await this.repos.stories.allInBoard(id)) {
      this.list.push({ type: 'story', before: story, after: null });
    }
    this.list.push({ type: 'board', before, after: null });
  }

  async updateRootConfig(update: (config: RowblyConfig) => RowblyConfig): Promise<RowblyConfig> {
    const pending = this.list.find((c) => c.type === 'rootConfig');
    const latest = pending ? pending.after : await this.repos.rootConfig.get();
    const next = valid(RowblyConfigSchema, 'rowbly.config.json', update(latest));
    if (pending) pending.after = next;
    else this.list.push({ type: 'rootConfig', before: latest, after: next });
    return next;
  }

  async updateLocalState(update: (state: LocalState) => LocalState): Promise<LocalState> {
    const pending = this.list.find((c) => c.type === 'localState');
    const latest = pending ? pending.after : await this.repos.localState.get();
    const next = valid(LocalStateSchema, 'local.json', update(latest));
    if (pending) pending.after = next;
    else this.list.push({ type: 'localState', before: latest, after: next });
    return next;
  }

  /** The Change Set as Plugin `id`'s handlers see it. */
  forPlugin(id: string): PluginChangeSet {
    return {
      ...this.view(),
      putStory: (story) => this.putStory(story),
      updateStory: (key, update) => this.updateStory(key, update),
      deleteStory: (key) => this.deleteStory(key),
      putBoard: (board) => this.putBoard(board),
      updateBoard: (boardId, update) => this.updateBoard(boardId, update),
      updateRootConfig: (update) => this.updateRootConfig(update),
      updateLocalState: (update) => this.updateLocalState(update),
      readFile: async (scope, name) => {
        const path = await this.filePath(id, scope, name);
        const pending = this.file(path);
        return pending ? pending.after : readTextIfExists(join(this.root.path, path));
      },
      writeFile: (scope, name, text) => this.setFile(id, scope, name, text),
      deleteFile: (scope, name) => this.setFile(id, scope, name, null),
    };
  }

  /** What reactions get: the changes, read-only. */
  view(): ChangeSetView {
    return {
      changes: this.list,
      story: (key) => this.story(key),
      board: (id) => this.board(id),
    };
  }

  /** Writes every change: Story folders move first, then each record is written or deleted in order. */
  async save(): Promise<void> {
    const p = paths(this.root);
    const moves: { from: string; to: string }[] = [];
    for (const change of this.stories()) {
      const { before, after, beforeFolder } = change;
      if (!before || !after) continue;
      const from = beforeFolder ? join(this.root.path, beforeFolder) : p.storyDir(before.boardId, before.key);
      const to = p.storyDir(after.boardId, after.key);
      if (from !== to) moves.push({ from, to });
    }
    await moveFolders(moves);

    for (const change of this.list) {
      switch (change.type) {
        case 'rootConfig':
          await this.repos.rootConfig.put(change.after);
          break;
        case 'localState':
          await this.repos.localState.put(change.after);
          break;
        case 'board':
          if (change.after) await this.repos.boards.put(change.after);
          else if (change.before) await ignoreMissing(this.repos.boards.delete(change.before.id));
          break;
        case 'story':
          if (change.after) await this.repos.stories.put(change.after);
          else if (change.before) {
            await ignoreMissing(this.repos.stories.delete(change.before.boardId, change.before.key));
          }
          break;
        case 'file': {
          const path = join(this.root.path, change.path);
          if (change.after === null) await removeFile(path, this.fileStops.get(change) ?? this.root.path);
          else await writeTextFile(path, change.after);
          break;
        }
      }
    }
  }

  private stories(): StoryChange[] {
    return this.list.filter((c): c is StoryChange => c.type === 'story');
  }

  /** The pending change of the Story that has `key` now. */
  private current(key: string): StoryChange | undefined {
    const upper = key.toUpperCase();
    return this.stories().find((c) => (c.after ?? c.before)?.key === upper);
  }

  private file(path: string): FileChange | undefined {
    return this.list.find((c): c is FileChange => c.type === 'file' && c.path === path);
  }

  private async storedStory(key: string): Promise<Story | null> {
    return orNull(this.repos.stories.findByKey(key));
  }

  private async setFile(id: string, scope: FileScope, name: string, text: string | null): Promise<void> {
    const path = await this.filePath(id, scope, name);
    const pending = this.file(path);
    if (pending) {
      pending.after = text;
      return;
    }
    const change: FileChange = {
      type: 'file',
      plugin: id,
      path,
      before: await readTextIfExists(join(this.root.path, path)),
      after: text,
    };
    this.list.push(change);
    this.fileStops.set(change, join(this.root.path, path.slice(0, path.indexOf(`plugins/${id}/`))));
  }

  /** The path of Plugin `id`'s file, relative to the Data Root. */
  private async filePath(id: string, scope: FileScope, name: string): Promise<string> {
    return `${await scopeFolder(this.repos, scope, (key) => this.story(key)?.after ?? null)}plugins/${id}/${checkName(name)}`;
  }
}

/** The record folder of a scope, relative to the Data Root, with a trailing `/` (or `''` for the Data Root). */
export async function scopeFolder(
  repos: Repositories,
  scope: FileScope,
  pending: (key: string) => Story | null = () => null,
): Promise<string> {
  if (scope === 'dataRoot') return '';
  if ('board' in scope) return `boards/${(await repos.boards.get(scope.board)).id}/`;
  const { key } = parseStoryKey(scope.story);
  const story = pending(key) ?? (await repos.stories.findByKey(key));
  return `boards/${story.boardId}/stories/${story.key}/`;
}

/** The files of Plugin `id` in a scope, as names relative to its folder. */
export async function listPluginFiles(
  root: DataRoot,
  repos: Repositories,
  id: string,
  scope: FileScope,
): Promise<string[]> {
  return listFilesUnder(join(root.path, `${await scopeFolder(repos, scope)}plugins/${id}`));
}

/** The stored text of one of Plugin `id`'s files, or `null`. */
export async function readPluginFile(
  root: DataRoot,
  repos: Repositories,
  id: string,
  scope: FileScope,
  name: string,
): Promise<string | null> {
  return readTextIfExists(join(root.path, `${await scopeFolder(repos, scope)}plugins/${id}/${checkName(name)}`));
}

function checkName(name: string): string {
  if (FILE_NAME_RE.test(name)) return name;
  throw new ValidationError(`invalid Plugin file name "${name}"`, {
    hint: 'use a relative path of letters, digits, ".", "_" and "-", without "." or ".." segments',
  });
}

function valid<T>(schema: ZodType<T>, what: string, value: T): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const summary = result.error.issues.map((i) => `${i.path.join('.') || what}: ${i.message}`).join('; ');
  throw new ValidationError(`invalid ${what}: ${summary}`, { details: { issues: result.error.issues } });
}

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

async function ignoreMissing(promise: Promise<void>): Promise<void> {
  try {
    await promise;
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }
}
