import { join } from 'node:path';
import type { ZodType } from 'zod';
import { NotFoundError, PluginError, parseStoryKey, ValidationError } from '../../core';
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
import { assertMayWrite, type ExecutionScope } from './executionScope';
import type {
  BoardChange,
  Change,
  ChangeSet,
  ChangeSetView,
  DeepReadonly,
  FileChange,
  FileScope,
  PluginChangeSet,
  PluginChangeSetView,
  StoryChange,
} from './types';

/** A file name inside a Plugin folder: `/`-separated segments, none of them `.` or `..`. */
const FILE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;

/**
 * Collects what an operation creates, changes and deletes (the plan), then saves it all in `save()`.
 * Core operations use it directly. Plugins never see the plan's records: `forPlugin(id, lease)` gives
 * a writer bound to one stage, `pluginView(id)` a guard's view, and `view()` a snapshot (ADR-0020 §1).
 * Every record a method receives or returns is a copy, so no reference outside reaches the plan.
 */
export class CoreChangeSet implements ChangeSet {
  private readonly list: Change[] = [];
  /** For each file change, the record folder above its `plugins/` folder: removing a file prunes up to it. */
  private readonly fileStops = new Map<FileChange, string>();
  /** Counts changes to the plan, so a snapshot is copied again only after a change. */
  private revision = 0;
  private snapshot: { revision: number; changes: readonly DeepReadonly<Change>[] } | undefined;
  private sealed = false;

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

  /** Creates or replaces a Story. `check` runs right before the plan changes (see `forPlugin`). */
  async putStory(story: Story, check?: () => void): Promise<Story> {
    const next = valid(StorySchema, 'Story', structuredClone(story));
    const before = this.current(next.key) ? null : await this.storedStory(next.key);
    this.gate(check);
    const pending = this.current(next.key);
    if (pending) pending.after = next;
    else this.list.push({ type: 'story', before, after: next });
    return next;
  }

  async updateStory(key: string, update: (story: Story) => Story, check?: () => void): Promise<Story> {
    const pending = this.current(key);
    const latest = pending ? pending.after : await this.repos.stories.findByKey(key);
    if (!latest) throw new NotFoundError(`Story "${key.toUpperCase()}" not found`);
    return this.putStory(update(structuredClone(latest)), check);
  }

  async deleteStory(key: string, check?: () => void): Promise<void> {
    const before = this.current(key) ? null : await this.repos.stories.findByKey(key);
    this.gate(check);
    const pending = this.current(key);
    if (pending) pending.after = null;
    else this.list.push({ type: 'story', before, after: null });
  }

  /** Records a Story change with a known `before`, for `doctor --fix`, which reads files itself. */
  recordStory(before: Story | null, after: Story, beforeFolder?: string): void {
    const next = valid(StorySchema, 'Story', structuredClone(after));
    this.gate();
    this.list.push({ type: 'story', before, after: next, ...(beforeFolder ? { beforeFolder } : {}) });
  }

  async putBoard(board: BoardConfig, check?: () => void): Promise<BoardConfig> {
    const next = valid(BoardConfigSchema, 'Board', structuredClone(board));
    const before = this.board(next.id) ? null : await orNull(this.repos.boards.get(next.id));
    this.gate(check);
    const pending = this.board(next.id);
    if (pending) pending.after = next;
    else this.list.push({ type: 'board', before, after: next });
    return next;
  }

  async updateBoard(id: string, update: (board: BoardConfig) => BoardConfig, check?: () => void): Promise<BoardConfig> {
    const pending = this.board(id);
    const latest = pending ? pending.after : await this.repos.boards.get(id);
    if (!latest) throw new NotFoundError(`Board "${id}" not found`);
    return this.putBoard(update(structuredClone(latest)), check);
  }

  /** Deletes a Board with its folder, and each of its Stories (listed so Plugins see them go). */
  async deleteBoard(id: string): Promise<void> {
    const before = await this.repos.boards.get(id);
    const stories = await this.repos.stories.allInBoard(id);
    this.gate();
    for (const story of stories) this.list.push({ type: 'story', before: story, after: null });
    this.list.push({ type: 'board', before, after: null });
  }

  async updateRootConfig(update: (config: RowblyConfig) => RowblyConfig, check?: () => void): Promise<RowblyConfig> {
    const pending = this.list.find((c) => c.type === 'rootConfig');
    const latest = pending ? pending.after : await this.repos.rootConfig.get();
    const next = valid(RowblyConfigSchema, 'rowbly.config.json', structuredClone(update(structuredClone(latest))));
    this.gate(check);
    if (pending) pending.after = next;
    else this.list.push({ type: 'rootConfig', before: latest, after: next });
    return next;
  }

  async updateLocalState(update: (state: LocalState) => LocalState, check?: () => void): Promise<LocalState> {
    const pending = this.list.find((c) => c.type === 'localState');
    const latest = pending ? pending.after : await this.repos.localState.get();
    const next = valid(LocalStateSchema, 'local.json', structuredClone(update(structuredClone(latest))));
    this.gate(check);
    if (pending) pending.after = next;
    else this.list.push({ type: 'localState', before: latest, after: next });
    return next;
  }
  /**
   * The writer Plugin `id` gets for one stage (`lease`): snapshots for reading, writer methods that
   * return frozen copies. Every writer throws once the stage has ended or the plan is sealed, without
   * changing the plan (ADR-0020 §1).
   */
  forPlugin(id: string, lease: ExecutionScope): PluginChangeSet {
    const check = () => {
      assertMayWrite(id, lease);
      this.assertOpen(id);
    };
    // Checked on the call, and again right before the plan changes, after any read the write awaits.
    const write = async <T>(fn: () => Promise<T>): Promise<T> => {
      check();
      return fn();
    };
    return {
      ...this.pluginView(id),
      putStory: (story) => write(async () => frozenCopy(await this.putStory(story, check))),
      updateStory: (key, update) => write(async () => frozenCopy(await this.updateStory(key, update, check))),
      deleteStory: (key) => write(() => this.deleteStory(key, check)),
      putBoard: (board) => write(async () => frozenCopy(await this.putBoard(board, check))),
      updateBoard: (boardId, update) => write(async () => frozenCopy(await this.updateBoard(boardId, update, check))),
      updateRootConfig: (update) => write(async () => frozenCopy(await this.updateRootConfig(update, check))),
      updateLocalState: (update) => write(async () => frozenCopy(await this.updateLocalState(update, check))),
      writeFile: (scope, name, text) => write(() => this.setFile(id, scope, name, text, check)),
      deleteFile: (scope, name) => write(() => this.setFile(id, scope, name, null, check)),
    };
  }

  /** What a guard of Plugin `id` gets: the snapshot and its own pending files, no writers. */
  pluginView(id: string): PluginChangeSetView {
    return {
      ...this.view(),
      readFile: async (scope, name) => {
        const path = await this.filePath(id, scope, name);
        const pending = this.file(path);
        return pending ? pending.after : readTextIfExists(join(this.root.path, path));
      },
    };
  }

  /**
   * A snapshot view: each accessor returns a detached, deeply frozen copy of the plan as it is when
   * called, so a writer's later changes show, and nothing done to a copy reaches the plan.
   */
  view(): ChangeSetView {
    const current = () => this.snapshotChanges();
    return {
      get changes() {
        return current();
      },
      story: (key) => findStory(current(), key),
      board: (id) => findBoard(current(), id),
    };
  }

  /** A view of the plan as it is now, fixed: what every reaction shares after the save. */
  frozenView(): ChangeSetView {
    const changes = this.snapshotChanges();
    return Object.freeze({
      changes,
      story: (key: string) => findStory(changes, key),
      board: (id: string) => findBoard(changes, id),
    });
  }

  /** Stops every change: guards and the save see the plan as it is now. */
  seal(): void {
    this.sealed = true;
  }

  private snapshotChanges(): readonly DeepReadonly<Change>[] {
    if (this.snapshot?.revision !== this.revision) {
      this.snapshot = { revision: this.revision, changes: frozenCopy(this.list) };
    }
    return this.snapshot.changes;
  }

  /** Runs right before every change to the plan: rejects a sealed plan, and counts the change. */
  private gate(check?: () => void): void {
    check?.();
    this.assertOpen();
    this.revision++;
  }

  private assertOpen(plugin?: string): void {
    if (!this.sealed) return;
    throw new PluginError(
      `${plugin ? `Plugin "${plugin}"` : 'Rowbly'} tried to change a Change Set after it was sealed for guards and the save`,
      { details: plugin ? { plugin } : {}, hint: 'change data in a transform' },
    );
  }

  /** Writes every change: Story folders move first, then each record is written or deleted in order. */
  async save(): Promise<void> {
    this.seal();
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

  private async setFile(
    id: string,
    scope: FileScope,
    name: string,
    text: string | null,
    check: () => void,
  ): Promise<void> {
    const path = await this.filePath(id, scope, name);
    const before = this.file(path) ? null : await readTextIfExists(join(this.root.path, path));
    this.gate(check);
    const pending = this.file(path);
    if (pending) {
      pending.after = text;
      return;
    }
    const change: FileChange = { type: 'file', plugin: id, path, before, after: text };
    this.list.push(change);
    this.fileStops.set(change, join(this.root.path, path.slice(0, path.indexOf(`plugins/${id}/`))));
  }

  /** The path of Plugin `id`'s file, relative to the Data Root. */
  private async filePath(id: string, scope: FileScope, name: string): Promise<string> {
    return `${await scopeFolder(this.repos, scope, (key) => this.story(key)?.after ?? null)}plugins/${id}/${checkName(name)}`;
  }
}

function findStory(list: readonly DeepReadonly<Change>[], key: string): DeepReadonly<StoryChange> | undefined {
  const upper = key.toUpperCase();
  return list.find(
    (c): c is DeepReadonly<StoryChange> => c.type === 'story' && (c.after?.key === upper || c.before?.key === upper),
  );
}

function findBoard(list: readonly DeepReadonly<Change>[], id: string): DeepReadonly<BoardChange> | undefined {
  return list.find((c): c is DeepReadonly<BoardChange> => c.type === 'board' && (c.after ?? c.before)?.id === id);
}

/**
 * A detached, deeply frozen copy of `value`: what Plugins read. A value that cannot be copied (one
 * holding functions) is returned as it is.
 */
export function frozenCopy<T>(value: T): DeepReadonly<T> {
  let copy: T;
  try {
    copy = structuredClone(value);
  } catch {
    return value as DeepReadonly<T>;
  }
  return deepFreeze(copy) as DeepReadonly<T>;
}

function deepFreeze(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const member of Object.values(value)) deepFreeze(member);
  }
  return value;
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
