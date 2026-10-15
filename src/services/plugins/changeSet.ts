import { join } from 'node:path';
import type { ZodType } from 'zod';
import { ConflictError, NotFoundError, PluginError, parseStoryKey, ValidationError } from '../../core';
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
  pathExists,
  prepareTransaction,
  type Repositories,
  resolvePluginFile,
  serializeJson,
  readPluginFile as storedPluginFile,
  listPluginFiles as storedPluginFiles,
  type TransactionChange,
} from '../../storage';
import { assertMayWrite, currentScope, type ExecutionScope } from './executionScope';
import type {
  BoardChange,
  Change,
  ChangeSet,
  ChangeSetView,
  DeepReadonly,
  FileChange,
  FileScope,
  LocalStateChange,
  PluginChangeSet,
  PluginChangeSetView,
  RootConfigChange,
  StoryChange,
} from './types';

/** A file name inside a Plugin folder: `/`-separated segments, none of them `.` or `..`. */
const FILE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;

/**
 * The plan's private entry for a Story it changes or holds files of (ADR-0019 §7). It keeps the
 * Story's original storage identity, so what is deleted or moved never comes from a snapshot.
 */
interface StoryEntry {
  /** Names the entry in the key of a pending file. */
  readonly n: number;
  /**
   * The folder the Story is stored in, relative to the Data Root (`boards/web/stories/WEB-1`), as read
   * when it entered the plan; `null` for a Story the plan creates.
   */
  readonly source: string | null;
  /** The Story's key and Board when it entered the plan. */
  readonly key: string;
  readonly boardId: string;
  /** Its change, once the plan changes the record itself. A Story may hold files without one. */
  change?: StoryChange;
  /** Renumbered by `doctor --fix` through `recordStory`: the only way a Story Key changes. */
  renumbered: boolean;
}

/** Which `plugins/<id>/` folder a pending file lives in: an owner, never a path (ADR-0019 §4). */
type ScopeRef = { kind: 'dataRoot' } | { kind: 'board'; id: string } | { kind: 'story'; entry: StoryEntry };

interface FileEntry {
  readonly change: FileChange;
  readonly scope: ScopeRef;
  readonly name: string;
}

/**
 * Collects what an operation creates, changes and deletes (the plan), then commits it all in `save()`.
 * Core operations use it directly. Plugins never see the plan's records: `forPlugin(id, lease)` gives
 * a writer bound to one stage, `pluginView(id)` a guard's view, and `view()` a snapshot (ADR-0020 §1).
 * Every record a method receives or returns is a copy, so no reference outside reaches the plan.
 *
 * The changes stay in the order they were first made (the save and reaction order). Indexes find a
 * Story by its keys, a Board by its id and a file by its owner and name, without scanning that list.
 */
export class CoreChangeSet implements ChangeSet {
  private readonly pendingChanges: Change[] = [];
  /** Each Story change under its key before and after the change, in the order the changes were made. */
  private readonly storiesByKey = new Map<string, StoryChange[]>();
  private readonly storyEntries = new Map<StoryChange, StoryEntry>();
  /** Stored Stories the plan knows, by their `source` folder. */
  private readonly storiesBySource = new Map<string, StoryEntry>();
  private readonly boardChanges = new Map<string, BoardChange>();
  private rootConfigChange: RootConfigChange | undefined;
  private localStateChange: LocalStateChange | undefined;
  /** Pending files by Plugin, owner and name (`fileKey`). */
  private readonly files = new Map<string, FileEntry>();
  private storyEntryCount = 0;
  /** Counts changes to the plan, so a snapshot is copied again only after a change. */
  private revision = 0;
  private snapshot: { revision: number; view: IndexedChanges } | undefined;
  private sealed = false;

  constructor(
    private readonly root: DataRoot,
    private readonly repos: Repositories,
  ) {}

  get changes(): readonly Change[] {
    this.placeFiles();
    return this.pendingChanges;
  }

  /** The change of a Story, found by its key before or after the change. */
  story(key: string): StoryChange | undefined {
    const upper = key.toUpperCase();
    return this.storiesByKey.get(upper)?.find((c) => c.after?.key === upper || c.before?.key === upper);
  }

  board(id: string): BoardChange | undefined {
    return this.boardChanges.get(id);
  }

  /** Creates or replaces a Story. `check` runs right before the plan changes (see `forPlugin`). */
  async putStory(story: Story, check?: () => void): Promise<Story> {
    const next = valid(StorySchema, 'Story', structuredClone(story));
    const before = this.storyAtCurrentKey(next.key) ? null : await this.storedStory(next.key);
    this.gate(check);
    const pending = this.storyAtCurrentKey(next.key);
    if (pending) this.replaceStory(pending, next);
    else this.addStory({ type: 'story', before, after: next });
    return next;
  }

  async updateStory(key: string, update: (story: Story) => Story, check?: () => void): Promise<Story> {
    const pending = this.storyAtCurrentKey(key);
    // `null` means the Story was deleted earlier in this Change Set; a Story missing on disk throws here.
    const latest = pending ? pending.after : await this.repos.stories.findByKey(key);
    if (!latest) throw new NotFoundError(`Story "${key.toUpperCase()}" not found`);
    const next = valid(StorySchema, 'Story', structuredClone(update(structuredClone(latest))));
    if (next.key !== latest.key || next.boardId !== latest.boardId) {
      throw new ValidationError(`Story ${latest.key} cannot change its Story Key or Board in an update`, {
        details: { key: latest.key },
        hint: 'a Story stays on its Board; `rowbly doctor --fix` renumbers Stories',
      });
    }
    this.gate(check);
    // The stored record read above is `before`: the first update reads it once (PERF-04).
    const current = this.storyAtCurrentKey(next.key);
    if (current) this.replaceStory(current, next);
    else this.addStory({ type: 'story', before: latest, after: next });
    return next;
  }

  async deleteStory(key: string, check?: () => void): Promise<void> {
    const before = this.storyAtCurrentKey(key) ? null : await this.repos.stories.findByKey(key);
    this.gate(check);
    const pending = this.storyAtCurrentKey(key);
    if (pending) pending.after = null;
    else this.addStory({ type: 'story', before, after: null });
  }

  /**
   * Core only (`doctor --fix`, which reads files itself): records a Story change with a known `before`,
   * read from `beforeFolder` when that is not its key's folder. Its key may change: the Story's whole
   * folder, with every Plugin file, moves to the new key's folder, and so do files queued for it.
   */
  recordStory(before: Story | null, after: Story, beforeFolder?: string): void {
    const next = valid(StorySchema, 'Story', structuredClone(after));
    this.gate();
    const change: StoryChange = {
      type: 'story',
      before: structuredClone(before),
      after: next,
      ...(beforeFolder ? { beforeFolder } : {}),
    };
    this.addStory(change).renumbered = true;
  }

  async putBoard(board: BoardConfig, check?: () => void): Promise<BoardConfig> {
    const next = valid(BoardConfigSchema, 'Board', structuredClone(board));
    const before = this.boardChanges.has(next.id) ? null : await orNull(this.repos.boards.get(next.id));
    this.gate(check);
    const pending = this.boardChanges.get(next.id);
    if (pending) this.replaceBoard(pending, next);
    else this.addBoard({ type: 'board', before, after: next });
    return next;
  }

  async updateBoard(id: string, update: (board: BoardConfig) => BoardConfig, check?: () => void): Promise<BoardConfig> {
    const pending = this.boardChanges.get(id);
    // `null` means the Board was deleted earlier in this Change Set; a Board missing on disk throws here.
    const latest = pending ? pending.after : await this.repos.boards.get(id);
    if (!latest) throw new NotFoundError(`Board "${id}" not found`);
    const next = valid(BoardConfigSchema, 'Board', structuredClone(update(structuredClone(latest))));
    if (next.id !== latest.id) {
      throw new ValidationError(`Board ${latest.id} cannot change its id in an update`, { details: { id: latest.id } });
    }
    this.gate(check);
    const current = this.boardChanges.get(id);
    if (current) this.replaceBoard(current, next);
    else this.addBoard({ type: 'board', before: latest, after: next });
    return next;
  }

  /**
   * Core only (`boards.remove`): deletes a Board with its folder, and each of its Stories (listed so
   * Plugins see them go). The folder goes as a whole, with the files of every Plugin, on or off.
   */
  async deleteBoard(id: string): Promise<void> {
    const pending = this.boardChanges.get(id);
    const before = pending ? pending.before : await this.repos.boards.get(id);
    const stored = before ? await this.repos.stories.allInBoard(id) : [];
    this.gate();
    for (const story of stored) {
      const change = this.storyAtCurrentKey(story.key);
      if (change) change.after = null;
      else this.addStory({ type: 'story', before: story, after: null });
    }
    // Stories this plan created on the Board go with it.
    for (const change of this.storyEntries.keys()) if (change.after?.boardId === id) change.after = null;
    if (pending) pending.after = null;
    else this.addBoard({ type: 'board', before, after: null });
  }

  async updateRootConfig(update: (config: RowblyConfig) => RowblyConfig, check?: () => void): Promise<RowblyConfig> {
    const pending = this.rootConfigChange;
    const latest = pending ? pending.after : await this.repos.rootConfig.get();
    const next = valid(RowblyConfigSchema, 'rowbly.config.json', structuredClone(update(structuredClone(latest))));
    this.gate(check);
    if (this.rootConfigChange) this.rootConfigChange.after = next;
    else {
      this.rootConfigChange = { type: 'rootConfig', before: latest, after: next };
      this.add(this.rootConfigChange);
    }
    return next;
  }

  async updateLocalState(update: (state: LocalState) => LocalState, check?: () => void): Promise<LocalState> {
    const pending = this.localStateChange;
    const latest = pending ? pending.after : await this.repos.localState.get();
    const next = valid(LocalStateSchema, 'local.json', structuredClone(update(structuredClone(latest))));
    this.gate(check);
    if (this.localStateChange) this.localStateChange.after = next;
    else {
      this.localStateChange = { type: 'localState', before: latest, after: next };
      this.add(this.localStateChange);
    }
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
      updateRootConfig: (update) =>
        write(async () =>
          frozenCopy(await this.updateRootConfig((config) => keepEnabled(id, config, update(config)), check)),
        ),
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
        checkName(name);
        const ref = await this.resolveScope(scope);
        // A Story or Board this plan deletes has no files left.
        if (this.deletedOwner(ref)) return null;
        const pending = this.files.get(fileKey(id, ref, name));
        return pending ? pending.change.after : this.storedFile(id, ref, name);
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
        return current().changes;
      },
      story: (key) => current().story(key),
      board: (id) => current().board(id),
    };
  }

  /** A view of the plan as it is now, fixed: what every reaction shares after the save. */
  frozenView(): ChangeSetView {
    const { changes, story, board } = this.snapshotChanges();
    return Object.freeze({ changes, story, board });
  }

  /** Stops every change: guards and the save see the plan as it is now. */
  seal(): void {
    this.sealed = true;
  }

  /**
   * Validates the whole final plan and commits it as one recoverable transaction (ADR-0019 §2). An
   * invalid plan throws before anything is written. A failure after the commit point is finished by
   * the engine or by the next recovery, and reported with the paths still pending, never as
   * "nothing saved".
   */
  async save(): Promise<void> {
    this.seal();
    const operation = currentScope()?.operation ?? 'save';
    const changes = await this.finalPlan(operation);
    if (changes.length === 0) return;
    const transaction = await prepareTransaction(this.root.path, { operation, changes });
    await transaction.commit();
  }

  private snapshotChanges(): IndexedChanges {
    if (this.snapshot?.revision !== this.revision) {
      this.placeFiles();
      this.snapshot = { revision: this.revision, view: indexed(frozenCopy(this.pendingChanges)) };
    }
    return this.snapshot.view;
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

  // ── The plan and its indexes: every change goes in through `add` ─────────────────────────────

  private add(change: Change): void {
    this.pendingChanges.push(change);
  }

  private addStory(change: StoryChange): StoryEntry {
    this.add(change);
    for (const key of new Set([change.before?.key, change.after?.key])) {
      if (key === undefined) continue;
      const list = this.storiesByKey.get(key);
      if (list) list.push(change);
      else this.storiesByKey.set(key, [change]);
    }
    const entry = this.entryFor(change);
    entry.change = change;
    this.storyEntries.set(change, entry);
    return entry;
  }

  /** The entry a new Story change belongs to: the one of its stored folder, if the plan holds its files. */
  private entryFor(change: StoryChange): StoryEntry {
    const { before, after, beforeFolder } = change;
    if (!before) return this.newEntry(null, (after as Story).key, (after as Story).boardId);
    const source = beforeFolder ?? storyFolder(before);
    const known = this.storiesBySource.get(source);
    if (known && !known.change) return known;
    const entry = this.newEntry(source, before.key, before.boardId);
    if (!known) this.storiesBySource.set(source, entry);
    return entry;
  }

  private newEntry(source: string | null, key: string, boardId: string): StoryEntry {
    return { n: ++this.storyEntryCount, source, key, boardId, renumbered: false };
  }

  /** The entry of a stored Story the plan does not change yet, so its files can follow it. */
  private storedEntry(story: Story): StoryEntry {
    const source = storyFolder(story);
    let entry = this.storiesBySource.get(source);
    if (!entry) {
      entry = this.newEntry(source, story.key, story.boardId);
      this.storiesBySource.set(source, entry);
    }
    return entry;
  }

  private replaceStory(pending: StoryChange, next: Story): void {
    if (pending.after === null) {
      throw new ConflictError(`Story ${next.key} is deleted in this operation and cannot be put again`, {
        details: { key: next.key },
      });
    }
    pending.after = next;
  }

  private addBoard(change: BoardChange): void {
    this.add(change);
    this.boardChanges.set((change.after ?? change.before)?.id as string, change);
  }

  private replaceBoard(pending: BoardChange, next: BoardConfig): void {
    if (pending.after === null) {
      throw new ConflictError(`Board ${next.id} is deleted in this operation and cannot be put again`, {
        details: { board: next.id },
      });
    }
    pending.after = next;
  }

  /**
   * The pending change of the Story whose key is `key` now: a renumbered Story only by its new key, a
   * deleted one by the key it had. `story()` also finds a renumbered Story by its old key; the writers
   * use this one, so that writing an old key never reaches the Story that now has another.
   */
  private storyAtCurrentKey(key: string): StoryChange | undefined {
    const upper = key.toUpperCase();
    return this.storiesByKey.get(upper)?.find((c) => (c.after ?? c.before)?.key === upper);
  }

  private async storedStory(key: string): Promise<Story | null> {
    return orNull(this.repos.stories.findByKey(key));
  }

  // ── Plugin files ────────────────────────────────────────────────────────────────────────────

  private async setFile(
    id: string,
    scope: FileScope,
    name: string,
    text: string | null,
    check: () => void,
  ): Promise<void> {
    checkName(name);
    const ref = await this.resolveScope(scope);
    const deleted = this.deletedOwner(ref);
    if (deleted) {
      // The owner's folder goes as a whole, so a deletion has nothing left to do.
      if (text === null) return check();
      throw deletedScopeError(id, name, deleted);
    }
    const key = fileKey(id, ref, name);
    const before = this.files.has(key) ? null : await this.storedFile(id, ref, name);
    this.gate(check);
    const pending = this.files.get(key);
    if (pending) {
      pending.change.after = text;
      return;
    }
    const change: FileChange = {
      type: 'file',
      plugin: id,
      path: filePath(this.folderOf(ref), id, name),
      before,
      after: text,
    };
    this.add(change);
    this.files.set(key, { change, scope: ref, name });
  }

  /**
   * The owner of a scope: a Board or Story in the plan (present or deleted), else the stored one.
   * A Board or Story missing from both throws `NotFoundError`.
   */
  private async resolveScope(scope: FileScope): Promise<ScopeRef> {
    if (scope === 'dataRoot') return { kind: 'dataRoot' };
    if ('board' in scope) {
      if (!this.boardChanges.has(scope.board)) await this.repos.boards.get(scope.board);
      return { kind: 'board', id: scope.board };
    }
    const { key } = parseStoryKey(scope.story);
    const pending = () => this.storyAtCurrentKey(key) ?? this.story(key);
    const found = pending();
    if (found) return { kind: 'story', entry: this.storyEntries.get(found) as StoryEntry };
    const stored = await this.repos.stories.findByKey(key);
    // The plan may have changed while the Story was read.
    const now = pending();
    return { kind: 'story', entry: now ? (this.storyEntries.get(now) as StoryEntry) : this.storedEntry(stored) };
  }

  /** `Story WEB-1` or `Board web` when the plan deletes the owner of `ref` (or a Story's Board). */
  private deletedOwner(ref: ScopeRef): string | undefined {
    if (ref.kind === 'dataRoot') return undefined;
    if (ref.kind === 'board') return this.boardChanges.get(ref.id)?.after === null ? `Board ${ref.id}` : undefined;
    const { change, key, boardId } = ref.entry;
    if (change?.after === null) return `Story ${change.before?.key ?? key}`;
    const board = change?.after?.boardId ?? boardId;
    return this.boardChanges.get(board)?.after === null ? `Story ${change?.after?.key ?? key}` : undefined;
  }

  /**
   * The record folder of `ref` as the plan leaves it, relative to the Data Root, with a trailing `/`
   * (`''` for the Data Root): a renumbered Story's new folder.
   */
  private folderOf(ref: ScopeRef): string {
    if (ref.kind === 'dataRoot') return '';
    if (ref.kind === 'board') return `boards/${ref.id}/`;
    const { change, source, key, boardId } = ref.entry;
    if (change?.after) return `${storyFolder(change.after)}/`;
    return `${source ?? storyFolder({ key, boardId })}/`;
  }

  /** The stored text of a file: read from where its owner is stored now; `null` for a new owner. */
  private async storedFile(id: string, ref: ScopeRef, name: string): Promise<string | null> {
    const folder = this.storedFolder(ref);
    return folder === null ? null : storedPluginFile(join(this.root.path, folder), id, name);
  }

  /** Where `ref`'s owner is stored now, relative to the Data Root; `null` when the plan creates it. */
  private storedFolder(ref: ScopeRef): string | null {
    if (ref.kind === 'dataRoot') return '';
    if (ref.kind === 'board') return this.boardChanges.get(ref.id)?.before === null ? null : `boards/${ref.id}`;
    return ref.entry.source;
  }

  /** Points each pending file's public `path` at its owner's folder as the plan leaves it. */
  private placeFiles(): void {
    for (const { change, scope, name } of this.files.values()) {
      change.path = filePath(this.folderOf(scope), change.plugin, name);
    }
  }

  // ── Final-plan validation and the commit (ADR-0019 §6, §2) ──────────────────────────────────

  /** Checks the whole sealed plan against the disk and turns it into transaction changes. */
  private async finalPlan(operation: string): Promise<TransactionChange[]> {
    const out: TransactionChange[] = [];
    const exists = (path: string) => pathExists(join(this.root.path, path));
    const storedBoards = new Map<string, Promise<boolean>>();
    const boardStored = (id: string) => {
      let found = storedBoards.get(id);
      if (!found) {
        found = exists(`boards/${id}/board.config.json`);
        storedBoards.set(id, found);
      }
      return found;
    };
    const boardLive = async (id: string) => {
      const change = this.boardChanges.get(id);
      return change ? change.after !== null : boardStored(id);
    };

    if (this.rootConfigChange) {
      out.push(record('rowbly.config.json', RowblyConfigSchema, this.rootConfigChange.after));
    }
    if (this.localStateChange) out.push(record('local.json', LocalStateSchema, this.localStateChange.after));

    let allBoards: Promise<BoardConfig[]> | undefined;
    for (const [id, { before, after }] of this.boardChanges) {
      if (before && !(await boardStored(id))) throw changedOnDisk(`Board ${id}`, `boards/${id}`, operation);
      if (!before && after && (await boardStored(id))) {
        throw new ConflictError(`Board "${id}" already exists`, { details: { board: id } });
      }
      if (!after) {
        if (before) out.push({ kind: 'delete', path: `boards/${id}` });
        continue;
      }
      if (!before || before.keyPrefix !== after.keyPrefix) {
        allBoards ??= this.repos.boards.list();
        const holder = [...(await allBoards).filter((b) => !this.boardChanges.has(b.id)), ...this.finalBoards()].find(
          (b) => b.id !== id && b.keyPrefix === after.keyPrefix,
        );
        if (holder) {
          throw new ConflictError(`key prefix "${after.keyPrefix}" is already used by Board "${holder.id}"`, {
            details: { board: id, holder: holder.id },
          });
        }
      }
      out.push(record(`boards/${id}/board.config.json`, BoardConfigSchema, after));
    }

    // Folders that the plan moves away or deletes: free for a Story created in the same plan.
    const vacated = new Set<string>();
    for (const [change, entry] of this.storyEntries) {
      if (entry.source && (!change.after || storyFolder(change.after) !== entry.source)) vacated.add(entry.source);
    }
    const finalFolders = new Map<string, string>();
    const sources = new Set<string>();
    for (const [change, entry] of this.storyEntries) {
      const { before, after } = change;
      const name = `Story ${(after ?? before)?.key ?? entry.key}`;
      if (entry.source) {
        if (sources.has(entry.source)) {
          throw new ConflictError(`${entry.source} is changed twice in one ${operation}`, {
            details: { path: entry.source },
          });
        }
        sources.add(entry.source);
        if (before && !(await exists(`${entry.source}/story.json`))) throw changedOnDisk(name, entry.source, operation);
      }
      if (!after) {
        if (entry.source) out.push({ kind: 'delete', path: entry.source });
        continue;
      }
      if (before && !entry.renumbered && (after.key !== before.key || after.boardId !== before.boardId)) {
        throw new ValidationError(`Story ${before.key} cannot change its Story Key or Board in ${operation}`, {
          details: { key: before.key },
          hint: 'a Story stays on its Board; `rowbly doctor --fix` renumbers Stories',
        });
      }
      if (!(await boardLive(after.boardId))) {
        const why = this.boardChanges.get(after.boardId) ? 'is being deleted' : 'does not exist';
        throw new ConflictError(`Story ${after.key} belongs to Board ${after.boardId}, which ${why}`, {
          details: { key: after.key, board: after.boardId },
        });
      }
      const folder = storyFolder(after);
      const other = finalFolders.get(folder);
      if (other) {
        throw new ConflictError(`${name} and ${other} would both be saved in ${folder}`, { details: { path: folder } });
      }
      finalFolders.set(folder, name);
      // A new Story needs a free folder; doctor names the file it splits (`beforeFolder`).
      if (!entry.source && !change.beforeFolder && !vacated.has(folder) && (await exists(`${folder}/story.json`))) {
        throw new ConflictError(`${name} already exists in ${folder}`, { details: { path: folder } });
      }
      if (entry.source && entry.source !== folder) out.push({ kind: 'move', from: entry.source, to: folder });
      out.push(record(`${folder}/story.json`, StorySchema, after));
    }

    for (const { change, scope, name } of this.files.values()) {
      const deleted = this.deletedOwner(scope);
      if (deleted) {
        // A deletion is done by the cascade; a write would revive the deleted owner.
        if (change.after === null) continue;
        throw deletedScopeError(change.plugin, name, deleted);
      }
      if (scope.kind === 'board' && !(await boardLive(scope.id))) {
        throw new ConflictError(`Board ${scope.id} does not exist`, { details: { board: scope.id } });
      }
      const folder = this.folderOf(scope);
      // The symlink policy (ADR-0019 §10), checked where the owner's folder is now.
      await resolvePluginFile(join(this.root.path, this.storedFolder(scope) ?? folder), change.plugin, name);
      const path = filePath(folder, change.plugin, name);
      out.push(
        change.after === null
          ? { kind: 'delete', path, pruneTo: folder.replace(/\/$/, '') }
          : { kind: 'write', path, text: change.after },
      );
    }
    return out;
  }

  private finalBoards(): BoardConfig[] {
    return [...this.boardChanges.values()].flatMap((c) => (c.after ? [c.after] : []));
  }
}

/** A frozen snapshot of the changes, with lookups that need no scan. */
interface IndexedChanges {
  readonly changes: readonly DeepReadonly<Change>[];
  story(key: string): DeepReadonly<StoryChange> | undefined;
  board(id: string): DeepReadonly<BoardChange> | undefined;
}

/** Indexes a snapshot once: the first change that has a key (before or after) or Board id wins. */
function indexed(changes: readonly DeepReadonly<Change>[]): IndexedChanges {
  const stories = new Map<string, DeepReadonly<StoryChange>>();
  const boards = new Map<string, DeepReadonly<BoardChange>>();
  for (const change of changes) {
    if (change.type === 'story') {
      for (const key of [change.after?.key, change.before?.key]) {
        if (key !== undefined && !stories.has(key)) stories.set(key, change);
      }
    } else if (change.type === 'board') {
      const id = (change.after ?? change.before)?.id;
      if (id !== undefined && !boards.has(id)) boards.set(id, change);
    }
  }
  return {
    changes,
    story: (key) => stories.get(key.toUpperCase()),
    board: (id) => boards.get(id),
  };
}

/** The folder of a Story, relative to the Data Root, without a trailing `/`. */
function storyFolder(story: Pick<Story, 'key' | 'boardId'>): string {
  return `boards/${story.boardId}/stories/${story.key}`;
}

function filePath(folder: string, id: string, name: string): string {
  return `${folder}plugins/${id}/${name}`;
}

/** Identifies a pending file by Plugin, owner and name, whatever the owner's key becomes. */
function fileKey(id: string, ref: ScopeRef, name: string): string {
  const owner = ref.kind === 'dataRoot' ? '' : ref.kind === 'board' ? `board:${ref.id}` : `story:${ref.entry.n}`;
  return `${id}\u0000${owner}\u0000${name}`;
}

function record<T>(path: string, schema: ZodType<T>, value: T): TransactionChange {
  return { kind: 'write', path, text: serializeJson(path, schema, value) };
}

function deletedScopeError(plugin: string, name: string, owner: string): ConflictError {
  return new ConflictError(`Plugin "${plugin}" cannot write ${name}: its ${owner} is being deleted`, {
    details: { plugin, name },
  });
}

function changedOnDisk(what: string, path: string, operation: string): ConflictError {
  return new ConflictError(`${what} is no longer stored in ${path}; it changed on disk during ${operation}`, {
    details: { path },
    hint: 'run the command again',
  });
}

/** A Plugin's root config change keeps every Plugin's `enabled` (ADR-0019 §6, check 9). */
function keepEnabled(id: string, before: RowblyConfig, after: RowblyConfig): RowblyConfig {
  const ids = new Set([...Object.keys(before.plugins ?? {}), ...Object.keys(after.plugins ?? {})]);
  for (const other of ids) {
    if (before.plugins?.[other]?.enabled !== after.plugins?.[other]?.enabled) {
      throw new PluginError(`Plugin "${id}" cannot turn Plugin "${other}" on or off`, {
        details: { plugin: id, target: other },
        hint: 'keep "enabled" when you merge settings; Plugins are turned on and off with `rowbly plugins`',
      });
    }
  }
  return after;
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

/** The stored record folder of a scope, as an absolute path. */
async function scopeFolder(root: DataRoot, repos: Repositories, scope: FileScope): Promise<string> {
  if (scope === 'dataRoot') return root.path;
  if ('board' in scope) return join(root.path, 'boards', (await repos.boards.get(scope.board)).id);
  const story = await repos.stories.findByKey(parseStoryKey(scope.story).key);
  return join(root.path, storyFolder(story));
}

/** The files of Plugin `id` in a scope, as names relative to its folder. */
export async function listPluginFiles(
  root: DataRoot,
  repos: Repositories,
  id: string,
  scope: FileScope,
): Promise<string[]> {
  return storedPluginFiles(await scopeFolder(root, repos, scope), id);
}

/** The stored text of one of Plugin `id`'s files, or `null`. */
export async function readPluginFile(
  root: DataRoot,
  repos: Repositories,
  id: string,
  scope: FileScope,
  name: string,
): Promise<string | null> {
  return storedPluginFile(await scopeFolder(root, repos, scope), id, checkName(name));
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
