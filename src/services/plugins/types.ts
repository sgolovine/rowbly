// The types of the Plugin API (ADR-0009). Plugins import them through `src/plugin-api`, never from here.
import type { Command } from 'commander';
import type { ComponentType } from 'react';
import type { ZodType, z } from 'zod';
import type {
  Assignee,
  BoardConfig,
  CustomFieldDef,
  CustomFieldInput,
  LocalState,
  PluginBags,
  RowblyConfig,
  Slug,
  Stage,
  Story,
  StoryKey,
  Task,
} from '../../schemas';
import type {
  AssigneeInput,
  AssigneePatch,
  AssigneesService,
  BoardCreateInput,
  BoardPatch,
  BoardsService,
  ConfigService,
  ConfigTarget,
  ContextService,
  CustomFieldPatch,
  DoctorFinding,
  DoctorFix,
  DoctorService,
  DoctorSeverity,
  FieldsService,
  OperationOptions,
  Position,
  RankPosition,
  Services,
  StageInput,
  StagePatch,
  StagesService,
  StoriesService,
  StoryCreateInput,
  StoryPatch,
  TaskCreateInput,
  TaskPatch,
  TasksService,
} from '../types';

// ── Change Sets (ADR-0012) ──────────────────────────────────────────────────

/**
 * One stored record that an operation creates (`before: null`), changes, or deletes (`after: null`).
 * Tasks live in their Story's record and Assignees in the root config, so changes to
 * them are Story or root config changes. A renumbered Story is one Story change whose `before` and
 * `after` have different keys; saving it moves the whole Story folder, Plugin files included.
 */
export type Change = RootConfigChange | LocalStateChange | BoardChange | StoryChange | FileChange;

export interface RootConfigChange {
  type: 'rootConfig';
  before: RowblyConfig;
  after: RowblyConfig;
}

export interface LocalStateChange {
  type: 'localState';
  before: LocalState;
  after: LocalState;
}

/** Deleting a Board deletes its folder, with its Stories and Plugin files. */
export interface BoardChange {
  type: 'board';
  before: BoardConfig | null;
  after: BoardConfig | null;
}

/**
 * Deleting a Story deletes its folder, with its Plugin files. `before` is also `null` when the stored
 * file could not be read, such as a Story that `doctor --fix` splits out of a merge conflict.
 */
export interface StoryChange {
  type: 'story';
  before: Story | null;
  after: Story | null;
  /** The folder the Story is read from, relative to the Data Root, when it is not its key's folder. */
  beforeFolder?: string;
}

/** A Plugin file, as text. `path` is relative to the Data Root, e.g. `plugins/epics/auth.json`. */
export interface FileChange {
  type: 'file';
  plugin: string;
  path: string;
  before: string | null;
  after: string | null;
}

/**
 * A deeply readonly copy of `T`: what Plugins read from a Change Set. Functions are kept as they are.
 * The type stops accidental writes at compile time; at run time the values are frozen copies.
 */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/**
 * What hooks read: snapshots of the Change Set, never the records it will save (CQ-27). Every record,
 * change and list is a detached, deeply frozen copy, so changing one throws (in strict code) and never
 * reaches the Change Set or another hook. A transform's or replacement's accessors return the snapshot
 * as it is when called, so its own later writes show. Guards share one snapshot, taken when the
 * Change Set is sealed after the transforms. Reactions share one snapshot of the saved Change Set.
 * `before` is always the stored record; changing a copy of it cannot change what is deleted or moved.
 * This guards against accidental changes; it is not a sandbox (ADR-0020 §6).
 */
export interface ChangeSetView {
  /** Every change, in the order it was first made. */
  readonly changes: readonly DeepReadonly<Change>[];
  /** The change of a Story, found by its key before or after the change. */
  story(key: string): DeepReadonly<StoryChange> | undefined;
  board(id: string): DeepReadonly<BoardChange> | undefined;
}

/**
 * The records an operation will save, once, at its end, as core operation bodies fill them. Every
 * method validates the record it is given, and reads the stored record as `before` the first time a
 * record changes. Plugins get `PluginChangeSet` instead.
 */
export interface ChangeSet {
  /** Every change, in the order it was first made. */
  readonly changes: readonly Change[];
  /** The change of a Story, found by its key before or after the change. */
  story(key: string): StoryChange | undefined;
  board(id: string): BoardChange | undefined;
  /** Creates or replaces a Story. */
  putStory(story: Story): Promise<Story>;
  /** Applies `update` to the latest version of a Story: the one in this Change Set, else the stored one. */
  updateStory(key: string, update: (story: Story) => Story): Promise<Story>;
  deleteStory(key: string): Promise<void>;
  putBoard(board: BoardConfig): Promise<BoardConfig>;
  updateBoard(id: string, update: (board: BoardConfig) => BoardConfig): Promise<BoardConfig>;
  updateRootConfig(update: (config: RowblyConfig) => RowblyConfig): Promise<RowblyConfig>;
  updateLocalState(update: (state: LocalState) => LocalState): Promise<LocalState>;
}

/** Where a Plugin's files live (ADR-0013): `plugins/<id>/` in the Data Root, a Board, or a Story folder. */
export type FileScope = 'dataRoot' | { board: Slug } | { story: StoryKey };

/**
 * A guard's view of the Change Set (stage `guard`): the snapshot, plus the pending text of the
 * Plugin's own files. It has no writer methods, at compile time or at run time.
 */
export interface PluginChangeSetView extends ChangeSetView {
  /** The text of one of the Plugin's files: its pending version, else the stored one; `null` when none. */
  readFile(scope: FileScope, name: string): Promise<string | null>;
}

/**
 * The Change Set a Plugin writes to (stages `body`, `replacement`, `transform`, `doctor-fix`). A file
 * name is a path inside the Plugin's folder, such as `auth.json` or `notes/a.md`. Update callbacks
 * get a copy of the record: a callback that changes its copy and then throws changes nothing. Writers
 * return frozen copies.
 *
 * A writer lives as long as the stage it was given to. Used after that stage ended (from a guard, a
 * reaction, a timer or a promise left running), after the Change Set was sealed for guards, or from
 * code running in a stage without writers, every method throws a `PluginError` and changes nothing.
 * Await every write before the hook returns.
 */
export interface PluginChangeSet extends PluginChangeSetView {
  /** Creates or replaces a Story. */
  putStory(story: Story): Promise<DeepReadonly<Story>>;
  /** Applies `update` to the latest version of a Story: the one in this Change Set, else the stored one. */
  updateStory(key: string, update: (story: Story) => Story): Promise<DeepReadonly<Story>>;
  deleteStory(key: string): Promise<void>;
  putBoard(board: BoardConfig): Promise<DeepReadonly<BoardConfig>>;
  updateBoard(id: string, update: (board: BoardConfig) => BoardConfig): Promise<DeepReadonly<BoardConfig>>;
  /**
   * Root settings change only through an explicit merge that keeps `enabled` and other Plugins'
   * entries (never `writeBag`):
   *
   * ```ts
   * await changes.updateRootConfig((config) => ({
   *   ...config,
   *   plugins: { ...config.plugins, [id]: { ...newSettings, enabled: config.plugins?.[id]?.enabled } },
   * }));
   * ```
   */
  updateRootConfig(update: (config: RowblyConfig) => RowblyConfig): Promise<DeepReadonly<RowblyConfig>>;
  updateLocalState(update: (state: LocalState) => LocalState): Promise<DeepReadonly<LocalState>>;
  writeFile(scope: FileScope, name: string, text: string): Promise<void>;
  deleteFile(scope: FileScope, name: string): Promise<void>;
}

// ── Operations (ADR-0012) ───────────────────────────────────────────────────

/** Every operation input may carry Plugin input as `plugins: { <id>: … }`. */
export type OperationInput = OperationOptions;

/** The name of every core operation, in Service order. `CoreOperationName` is derived from it. */
export const CORE_OPERATION_NAMES = [
  'context.use',
  'context.clearUse',
  'context.setMe',
  'assignees.add',
  'assignees.update',
  'assignees.remove',
  'boards.create',
  'boards.update',
  'boards.remove',
  'stages.add',
  'stages.update',
  'stages.move',
  'stages.remove',
  'fields.add',
  'fields.update',
  'fields.remove',
  'stories.create',
  'stories.update',
  'stories.move',
  'stories.rank',
  'stories.remove',
  'tasks.create',
  'tasks.update',
  'tasks.move',
  'tasks.remove',
  'plugins.enable',
  'plugins.disable',
  'doctor.fix',
] as const;

export type CoreOperationName = (typeof CORE_OPERATION_NAMES)[number];

/**
 * The input and public result of each core operation. An operation's input holds the service
 * method's arguments by name, with any Plugin input as `plugins`. The result is what the service
 * caller gets; hooks see the same shape (ARCH-14). A Plugin's own operations are named
 * `<plugin id>.<name>`.
 */
export interface CoreOperations {
  'context.use': { input: { board: Slug } & OperationOptions; result: LocalState };
  'context.clearUse': { input: OperationOptions; result: undefined };
  'context.setMe': { input: { handle: Slug | null } & OperationOptions; result: LocalState };
  'assignees.add': { input: AssigneeInput; result: Assignee };
  'assignees.update': { input: { handle: Slug } & AssigneePatch; result: Assignee };
  'assignees.remove': { input: { handle: Slug } & OperationOptions; result: { storiesUpdated: number } };
  'boards.create': { input: BoardCreateInput; result: BoardConfig };
  'boards.update': { input: { id: Slug } & BoardPatch; result: BoardConfig };
  'boards.remove': { input: { id: Slug; force: boolean } & OperationOptions; result: undefined };
  'stages.add': {
    input: { target: ConfigTarget; stage: StageInput; position: Position } & OperationOptions;
    result: Stage[];
  };
  'stages.update': { input: { target: ConfigTarget; key: Slug } & StagePatch; result: Stage[] };
  'stages.move': { input: { target: ConfigTarget; key: Slug; position: Position } & OperationOptions; result: Stage[] };
  'stages.remove': {
    input: { target: ConfigTarget; key: Slug; moveTo?: Slug } & OperationOptions;
    result: { storiesMoved: number; tasksMoved: number };
  };
  'fields.add': {
    input: { target: ConfigTarget; field: CustomFieldInput } & OperationOptions;
    result: CustomFieldDef[];
  };
  'fields.update': { input: { target: ConfigTarget; key: Slug } & CustomFieldPatch; result: CustomFieldDef[] };
  'fields.remove': {
    input: { target: ConfigTarget; key: Slug } & OperationOptions;
    result: { valuesStripped: number };
  };
  'stories.create': { input: { boardId: Slug } & StoryCreateInput; result: Story };
  'stories.update': { input: { key: string } & StoryPatch; result: Story };
  'stories.move': { input: { key: string; stage: Slug; top: boolean } & OperationOptions; result: Story };
  'stories.rank': { input: { key: string; position: RankPosition } & OperationOptions; result: Story };
  'stories.remove': { input: { key: string } & OperationOptions; result: undefined };
  'tasks.create': { input: { storyKey: string } & TaskCreateInput; result: Task };
  'tasks.update': { input: { taskId: string } & TaskPatch; result: Task };
  'tasks.move': { input: { taskId: string; stage: Slug } & OperationOptions; result: Task };
  'tasks.remove': { input: { taskId: string } & OperationOptions; result: undefined };
  'plugins.enable': { input: { id: string } & OperationOptions; result: { id: string; enabled: boolean } };
  'plugins.disable': { input: { id: string } & OperationOptions; result: { id: string; enabled: boolean } };
  /** One pass of `doctor --fix`: the findings it fixes. */
  'doctor.fix': { input: { findings: DoctorFinding[] } & OperationOptions; result: DoctorFix[] };
}

type InputOf<K> = K extends CoreOperationName ? CoreOperations[K]['input'] : OperationInput;
type ResultOf<K> = K extends CoreOperationName ? CoreOperations[K]['result'] : unknown;

/** What every event of an operation carries. */
interface EventBase<I, S> {
  /** The operation's name, such as `stories.create`. */
  name: string;
  /** A frozen copy that every hook of the operation shares. */
  input: DeepReadonly<I>;
  /** This Plugin's part of `input.plugins`. */
  pluginInput: unknown;
  /** The context of the Plugin whose hook runs. */
  plugin: PluginHookContext<S>;
}

/**
 * Stage `replacement`: runs instead of the core body and fills the Change Set. There is no `result`
 * yet; `core()` runs the core body against the same Change Set, at most once (W6): a second call
 * fails the operation, and nothing is saved. Errors from `core()` pass through with their core code.
 * Not calling `core()` is allowed; the replacement's result is then the operation's result.
 */
export interface ReplacementEvent<I, R, S> extends EventBase<I, S> {
  changes: PluginChangeSet;
  core(): Promise<R>;
}

/**
 * Stage `transform`: changes the Change Set before the save, through its writer methods only.
 * `result` is the body or replacement result, before any transform (ARCH-03): for `stories.create`,
 * `result.key` is the created Story. `changes` stops working when the transform returns.
 */
export interface TransformEvent<I, R, S> extends EventBase<I, S> {
  result: DeepReadonly<R>;
  changes: PluginChangeSet;
}

/**
 * Stage `guard`: sees the Change Set after every transform and may reject the operation. `result` is
 * as in `TransformEvent`. The view has no writers; a writer kept from a transform throws here.
 */
export interface GuardEvent<I, R, S> extends EventBase<I, S> {
  result: DeepReadonly<R>;
  changes: PluginChangeSetView;
}

/**
 * Stage `reaction`: runs after the save, with the operation's final result and the saved Change Set,
 * one frozen snapshot that every reaction shares. It acts only outside Rowbly's data: starting an
 * operation throws, even from a timer it leaves running. A failure only warns.
 */
export interface ReactionEvent<I, R, S> extends EventBase<I, S> {
  result: DeepReadonly<R>;
  changes: ChangeSetView;
}

/**
 * A guard returns a rejection to stop the operation: nothing is saved, exit 4 (`CONFLICT`).
 * `canForce` says that `--force` would get past this rejection, so the TUI can offer it (UI-01); the
 * error carries it as `details.canForce`. A guard may also throw an expected Rowbly error, such as
 * `NotFoundError`, which keeps its own code (ADR-0020 §5).
 */
export type GuardResult = { reject: string; hint?: string; canForce?: boolean } | undefined;

export interface OperationHooks<I, R, S> {
  /** Sees the final Change Set before the save and may reject the operation. `guard() {}` is fine. */
  guard?(event: GuardEvent<I, R, S>): GuardResult | Promise<GuardResult>;
  /** Changes the Change Set before the save. */
  transform?(event: TransformEvent<I, R, S>): void | Promise<void>;
  /**
   * Runs after the save. It acts only outside Rowbly's data; a failure only warns. It has 5 s: then
   * Rowbly warns and goes on, though work it left running is not stopped. Return or await all work.
   */
  react?(event: ReactionEvent<I, R, S>): void | Promise<void>;
}

/** Hooks by operation name: core names are typed, other Plugins' operations (`<id>.<name>`) are not. */
export type OperationHookMap<S> = {
  [K in CoreOperationName | (string & {})]?: OperationHooks<InputOf<K>, ResultOf<K>, S>;
};

/** Runs instead of the core operation and fills the Change Set; `core()` runs the core operation. */
export type Replacement<I, R, S> = (event: ReplacementEvent<I, R, S>) => Promise<R>;

export type ReplacementMap<S> = {
  [K in CoreOperationName]?: Replacement<InputOf<K>, ResultOf<K>, S>;
};

// ── The Plugin's context and capabilities (ADR-0009, ADR-0020) ───────────────

/** A record that can carry bags. */
export interface Bagged {
  plugins?: PluginBags;
}

/**
 * What a Plugin's bag on a record is. `invalid` keeps the raw value and why it does not parse; it is
 * never the same as `absent` (ADR-0020 §3).
 */
export type BagInspection<T> =
  | { kind: 'absent' }
  | { kind: 'valid'; value: T }
  | { kind: 'invalid'; raw: unknown; issues: readonly z.core.$ZodIssue[] };

/** Read access to the Plugin's own `plugins/<id>/` folders; writes go through a Change Set. */
export interface PluginFiles {
  /** The file's text, or `null` when it does not exist. */
  read(scope: FileScope, name: string): Promise<string | null>;
  /** File names in the folder, recursively, as `/`-separated paths, sorted. */
  list(scope: FileScope): Promise<string[]>;
}

/**
 * The read-only core services (stages `body`, `replacement`, `transform`, `guard`, `reaction`,
 * `doctor-check`, `doctor-fix`). Reads see stored records; `changes` sees pending ones. Built at run
 * time with only these methods.
 */
export interface PluginReadServices {
  context: Pick<ContextService, 'resolveBoard'>;
  config: Pick<ConfigService, 'effective'>;
  assignees: Pick<AssigneesService, 'list'>;
  boards: Pick<BoardsService, 'list' | 'get'>;
  stages: Pick<StagesService, 'list'>;
  fields: Pick<FieldsService, 'list'>;
  stories: Pick<StoriesService, 'list' | 'get' | 'labelsInUse'>;
  tasks: Pick<TasksService, 'list' | 'get'>;
}

/**
 * The core services of commands and screens: every service but `plugins` (no other Plugin's context,
 * no enable or disable), `setup` and doctor fixes (ARCH-05). Built at run time with only these
 * methods. Each core operation called here saves on its own.
 */
export type PluginServices = Omit<Services, 'plugins' | 'setup' | 'doctor'> & {
  doctor: Pick<DoctorService, 'check'>;
};

/** What a Plugin gets in every stage. */
export interface PluginReadContext<S = unknown> {
  readonly id: string;
  /** The Data Root's settings, checked by the Plugin's `settings` schema when it loaded. */
  readonly settings: S;
  /** A Board's settings: its bag deep-merged over the Data Root's; a list replaces (ADR-0005). */
  boardSettings(boardId: Slug): Promise<S>;
  /** Whether this Plugin's bag on `record` is absent, valid or invalid. */
  inspectBag<T>(record: Bagged, schema: ZodType<T>): BagInspection<T>;
  /**
   * This Plugin's bag on `record` parsed with `schema`, or `undefined` when it is absent **or
   * invalid**. Tolerant: for display only. Changes to existing data use `requireBag`.
   */
  readBag<T>(record: Bagged, schema: ZodType<T>): T | undefined;
  /**
   * This Plugin's bag on `record` parsed with `schema`, or `undefined` only when it is absent. An
   * invalid bag throws `DataIntegrityError` (exit 6) with `details: { plugin, path, issues }`, so a
   * change never overwrites data it could not read.
   */
  requireBag<T>(record: Bagged, schema: ZodType<T>): T | undefined;
  /**
   * A copy of `record` with this Plugin's bag set to `bag`, or removed when `bag` is `undefined`;
   * the other Plugins' bags are kept, and `plugins` goes when it is left empty. The result's
   * `plugins` is only `Bagged`: a narrower type is not kept (CQ-165). Throws `PluginError` for the
   * root config (`rowbly.config.json`), whose entries are settings with `enabled`: change those with
   * the merge shown on `PluginChangeSet.updateRootConfig`.
   */
  writeBag<R extends Bagged>(record: R, bag: Record<string, unknown> | undefined): Omit<R, 'plugins'> & Bagged;
  files: PluginFiles;
  /** Me, or `null`. */
  readonly me: Slug | null;
  now(): Date;
  /** A new random 8-character id, for records the Plugin keeps in its bags. */
  newId(): string;
}

/**
 * The context of a hook (stages `body`, `replacement`, `transform`, `guard`, `reaction`,
 * `doctor-check`, `doctor-fix`). It has read services only, and no `operation` or `editText`: change
 * data through the Change Set the hook receives. Starting an operation from a hook, by any route (a
 * kept command context or services object included), throws a `PluginError` before anything is read
 * or saved; reads stay allowed. So does starting one from a Plugin operation's body.
 */
export interface PluginHookContext<S = unknown> extends PluginReadContext<S> {
  services: PluginReadServices;
  /** Shown after the command, or as a toast in the TUI. */
  warn(message: string): void;
}

/** Options of `PluginContext.operation`. */
export interface PluginOperationOptions<R> {
  /**
   * The operation's final result, read from the Change Set after every transform and guard (ARCH-42):
   * for example the Plugin's own record as other Plugins' transforms left it. `bodyResult` is what
   * the body returned. It only reads; the Change Set is sealed, so it cannot write.
   */
  result?(changes: PluginChangeSetView, bodyResult: R): R | Promise<R>;
}

/** The context of commands, screens, fields, filters, rows, option input and Actions. */
export interface PluginContext<S = unknown> extends PluginReadContext<S> {
  services: PluginServices;
  /**
   * Runs one of this Plugin's own operations, named `<id>.<name>`, through the whole pipeline. It
   * returns `options.result` when given, else what `body` returned; reactions get the same value.
   */
  operation<I extends object, R>(
    name: string,
    input: I & OperationInput,
    body: (changes: PluginChangeSet) => Promise<R>,
    options?: PluginOperationOptions<R>,
  ): Promise<R>;
  /** Shown after the command, or as a toast in the TUI. */
  warn(message: string): void;
}

// ── Command mode ────────────────────────────────────────────────────────────

/** What a Plugin command's action works with. */
export interface PluginCommandEnv<S> {
  plugin: PluginContext<S>;
  services: PluginServices;
  /** `--json` was given. */
  json: boolean;
  /** Prints the result: JSON with `--json`, else `human(data)`. */
  print<T>(data: T, human: (data: T) => string): void;
  /** Asks before a destructive change; needs `--yes` when not interactive. */
  confirm(message: string): Promise<void>;
  /** Returns `value`, or asks for it when interactive; otherwise a missing `flag` exits 2. */
  prompt(value: string | undefined, spec: { flag: string; message: string }): Promise<string>;
  /** Long text from exactly one of `--<name>`, `--<name>-file <path|->` and `--edit`; `undefined` when none. */
  readText(
    flags: { text?: string; file?: string; edit?: boolean },
    opts: { name: string; initial?: string },
  ): Promise<string | undefined>;
  /**
   * Opens `$VISUAL`/`$EDITOR` on `initial` and returns the saved text as it is. The only editor in
   * the Plugin API: the TUI and hooks have none (ARCH-11, SEC-03).
   */
  editText(initial: string): Promise<string>;
  /** `--board`, then `ROWBLY_BOARD`, then the context (contracts §4). */
  resolveBoard(flag?: string): Promise<Slug>;
}

export interface PluginCli<S> {
  /** Runs a command's action with the context, prints warnings, and maps errors to exit codes. */
  run(cmd: Command, action: (env: PluginCommandEnv<S>) => Promise<void>): Promise<void>;
  /** Commander parser for a repeatable flag. */
  collect(value: string, previous?: string[]): string[];
  /** `['a,b', 'c']` → `['a', 'b', 'c']`. */
  parseRepeatable(values: string | readonly string[] | undefined): string[];
}

/**
 * The core commands that take Plugin options (each passes them to its operation or filter). The only
 * list: `PluginOptionCommand` is derived from it, and loading checks declared commands against it.
 * Stages, fields, context and doctor are hookable but take no Plugin options (ARCH-16).
 */
export const PLUGIN_OPTION_COMMANDS = [
  'assignees add',
  'assignees edit',
  'assignees remove',
  'boards create',
  'boards edit',
  'boards delete',
  'stories list',
  'stories create',
  'stories edit',
  'stories move',
  'stories rank',
  'stories delete',
  'tasks create',
  'tasks edit',
  'tasks move',
  'tasks delete',
] as const;

export type PluginOptionCommand = (typeof PLUGIN_OPTION_COMMANDS)[number];

/** A Plugin's options on one core command. */
export interface PluginCommandOptions {
  /** Long flags only, such as `--epic <id>` or `--no-epic`. */
  options: { flags: string; description: string; repeatable?: boolean }[];
  /**
   * Turns the parsed values of these options (by commander attribute name, e.g. `epic`) into this
   * Plugin's input (`plugins.<id>`), or the filter for `stories list`; `undefined` when none was given.
   * Only options the user gave have a value: a lone `--no-x` gives `x: false` when used and
   * `undefined` otherwise, never a default `true`. With both `--x` and `--no-x`, the last one wins.
   */
  input(values: Record<string, unknown>): unknown;
}

/** A labelled value shown in `stories show` or `tasks show`, and on the TUI Story or Task screen. */
export interface PluginRow {
  label: string;
  value: string;
}

// ── Doctor ──────────────────────────────────────────────────────────────────

/** The records doctor could read, for a Plugin's checks. */
export interface DoctorData {
  config: RowblyConfig | null;
  boards: BoardConfig[];
  stories: Story[];
  /** This machine's Local State. */
  local: LocalState;
}

export interface PluginFinding {
  /** Without the Plugin's prefix: `MISSING_EPIC` is reported as `EPICS_MISSING_EPIC`. */
  code: string;
  severity: DoctorSeverity;
  /** Relative to the Data Root. */
  path: string;
  message: string;
  /** Extra data for `--json`; Rowbly adds `plugin`. */
  details?: Record<string, unknown>;
  /** Repairs the finding in the Change Set of `doctor --fix`; returns what it did. */
  fix?(changes: PluginChangeSet): Promise<string> | string;
}

export interface PluginDoctor<S> {
  check(args: { data: DoctorData; plugin: PluginHookContext<S> }): Promise<PluginFinding[]> | PluginFinding[];
}

// ── TUI ─────────────────────────────────────────────────────────────────────

/** What an Action names as its target (ADR-0017); `none` shows on every screen. */
export type ActionTarget = 'board' | 'story' | 'task' | 'none';

/** What is in focus on the current screen. */
export interface ActionFocus {
  board?: BoardConfig;
  story?: Story;
  task?: Task;
}

/** Opens and shows things from a Plugin's screens and Actions. */
export interface PluginUi {
  /**
   * Opens one of this Plugin's screens on top of the current one, with `params` as its
   * `PluginScreenProps.params`. Three params are route metadata (DX-24):
   * - `title` is the breadcrumb, and is passed on too. Without one, the breadcrumb is `screen`
   *   with a capital letter (`form` → `Form`), so pass a title that tells screens apart (CQ-60).
   * - `plugin` and `screen` name the route. Rowbly sets them; a value given here is replaced, and the
   *   screen does not get them. Use other names for your own data.
   */
  open(screen: string, params?: Record<string, unknown>): void;
  /** Opens core Story `key`'s detail on top of the current screen; back returns here (ARCH-07). */
  openStory(key: string): void;
  /** Opens core Task `id`'s detail (`WEB-1.2`) on top of the current screen; back returns here. */
  openTask(id: string): void;
  /** Opens Board `id`'s detail, with its effective configuration, on top of the current screen. */
  openBoard(id: string): void;
  back(): void;
  toast(message: string, kind?: 'info' | 'warning' | 'error'): void;
  /** Shows any error as a toast. */
  error(err: unknown): void;
}

/** A key, with a header button, wherever its target is in focus. It may only open or show something. */
export interface PluginAction<S> {
  /** One character that no core screen uses. */
  key: string;
  label: string;
  target: ActionTarget;
  run(args: { focus: ActionFocus; plugin: PluginContext<S>; ui: PluginUi }): void | Promise<void>;
}

export type PluginFormValue = string | number | boolean | string[] | null;

/** A field a Plugin adds to a core form; `name` is unique within the Plugin. */
export interface PluginFormField {
  name: string;
  label: string;
  kind: 'text' | 'multiline' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect';
  required?: boolean;
  /**
   * Choices for `select` and `multiselect`. A select cycles through these only, so "no value" is an
   * option of the Plugin's own whose label cannot be a real value (Epics uses `No Epic`, which no Epic
   * slug can be); a filter keeps "any" (`All Epics`) apart from "without a value" (`No Epic`).
   */
  options?: readonly string[];
  /** The starting value. */
  value?: PluginFormValue;
  /**
   * Set when the stored value cannot be shown for editing, e.g. `'stored value is invalid; kept
   * unchanged'` for an invalid bag. The form shows this instead of the value and offers only a reset;
   * the stored value is kept unless the person picks the reset.
   */
  unavailable?: string;
}

/**
 * The Story form's fields for one Plugin, and its input of `stories.create` / `stories.update`.
 *
 * The form calls `input` only when at least one of this Plugin's fields changed, comparing normalized
 * values (an empty number is `null`, an unset boolean `false`, an unset multiselect `[]`, and a
 * multiselect's order does not count). An unchanged Plugin, or one whose `fields` failed, contributes
 * no input, so it never changes stored data.
 *
 * | Story | Field | `input` | Result |
 * | --- | --- | --- | --- |
 * | new | left empty, or changed back | not called | no bag |
 * | new | set | called | the Plugin's input |
 * | existing | unchanged | not called | bag kept as stored, invalid or unknown keys included |
 * | existing | changed to a value | called | the Plugin's input |
 * | existing | changed to empty | called | the Plugin's explicit clear, e.g. `{ epic: null }` |
 * | existing, invalid bag (`unavailable`) | kept | not called | bag kept as stored |
 * | existing, invalid bag (`unavailable`) | reset | called with the field `null` | the Plugin's explicit clear |
 * | any | `fields` threw | never called | bag kept as stored |
 */
export interface PluginStoryForm<S> {
  fields(args: { boardId: Slug; story: Story | null; plugin: PluginContext<S> }): Promise<PluginFormField[]>;
  /**
   * This Plugin's input, or `undefined` for no change. `values` and `initialValues` hold the
   * Plugin's own fields by name, normalized; an `unavailable` field is in `values` (as `null`) only
   * when it was reset. Leave the stored data of fields not in `changedFields` as it is. Clearing is
   * an explicit value the Plugin defines; `undefined` never clears.
   */
  input(args: {
    values: Record<string, PluginFormValue>;
    initialValues: Record<string, PluginFormValue>;
    changedFields: readonly string[];
    story: Story | null;
  }): unknown;
}

export interface PluginStoryFilter<S> {
  fields(args: { boardId: Slug; plugin: PluginContext<S> }): Promise<PluginFormField[]>;
  /**
   * This Plugin's filter (`StoryFilter.plugins.<id>`), or `undefined` for none. Not called when the
   * Plugin's filter fields failed to load.
   */
  filter(values: Record<string, PluginFormValue>): unknown;
  /** A short summary of the chosen values for the filter line; `''` for none. */
  describe(values: Record<string, PluginFormValue>): string;
}

export interface PluginScreenProps<S> {
  /**
   * The params `ui.open` gave, with `title` but without the route metadata `plugin` and `screen`.
   * They are not checked: validate what the screen needs, e.g. with a schema, and show an error for
   * a missing or malformed value instead of using it.
   */
  params: Record<string, unknown>;
  plugin: PluginContext<S>;
  ui: PluginUi;
}

export interface PluginStoryTabProps<S> {
  story: Story;
  /** Whether the tab gets keys now. */
  active: boolean;
  plugin: PluginContext<S>;
  ui: PluginUi;
}

export interface PluginTaskTabProps<S> {
  story: Story;
  task: Task;
  /** Whether the tab gets keys now. */
  active: boolean;
  plugin: PluginContext<S>;
  ui: PluginUi;
}

export interface PluginBoardSectionProps<S> {
  board: BoardConfig;
  plugin: PluginContext<S>;
  ui: PluginUi;
}

/** A home menu entry or settings section: one of the Plugin's screens. */
export interface PluginLink {
  label: string;
  screen: string;
  params?: Record<string, unknown>;
}

/** A Plugin's TUI part, loaded only when the TUI starts. */
export interface PluginTui<S> {
  /** Screens by name; `ui.open(name)` opens one. */
  screens?: Record<string, ComponentType<PluginScreenProps<S>>>;
  home?: PluginLink[];
  settings?: PluginLink[];
  storyForm?: PluginStoryForm<S>;
  storyFilter?: PluginStoryFilter<S>;
  storyTabs?: { label: string; component: ComponentType<PluginStoryTabProps<S>> }[];
  taskTabs?: { label: string; component: ComponentType<PluginTaskTabProps<S>> }[];
  boardSections?: ComponentType<PluginBoardSectionProps<S>>[];
}

// ── The definition ──────────────────────────────────────────────────────────

/** Schemas for a Plugin's bags on records other than the Data Root and Boards (whose bags are its settings). */
export interface PluginBagSchemas {
  story?: ZodType;
  task?: ZodType;
  assignee?: ZodType;
  local?: ZodType;
}

/** A Plugin: everything it adds, declared up front. Only `id`, `name` and `description` are required. */
export interface PluginDefinition<S = Record<string, unknown>> {
  /** A slug; also its command (`rowbly <id> …`), its bag key and its folder name. */
  id: string;
  name: string;
  description: string;
  /** Checks the Plugin's entry in `rowbly.config.json` (without `enabled`) and each Board bag merged over it. */
  settings?: ZodType<S>;
  bags?: PluginBagSchemas;
  /** Runs when the Plugin loads; throwing makes it fail to load. */
  start?(args: { settings: S }): void | Promise<void>;
  hooks?: OperationHookMap<S>;
  /** Operations this Plugin runs instead of core. Two Plugins cannot replace the same operation. */
  replaces?: ReplacementMap<S>;
  /** Adds verbs to `rowbly <id>`, which is created for it. */
  commands?(group: Command, cli: PluginCli<S>): void;
  /** Options on core commands. */
  options?: { [K in PluginOptionCommand]?: PluginCommandOptions };
  /** Whether `story` matches this Plugin's filter (`StoryFilter.plugins.<id>`). */
  filterStories?(story: Story, filter: unknown, plugin: PluginContext<S>): boolean;
  /** Rows for `stories show` and the TUI Story screen. */
  storyRows?(story: Story, plugin: PluginContext<S>): Promise<PluginRow[]>;
  /** Rows for `tasks show` and the TUI Task screen. */
  taskRows?(task: Task, story: Story, plugin: PluginContext<S>): Promise<PluginRow[]>;
  doctor?: PluginDoctor<S>;
  actions?: PluginAction<S>[];
  /** Loads the TUI part, e.g. `() => import('./tui').then((m) => m.tui)`. */
  tui?(): Promise<PluginTui<S>>;
}

/** A definition of any settings type, as the registry holds it. */
// biome-ignore lint/suspicious/noExplicitAny: the registry holds Plugins with different settings types.
export type AnyPluginDefinition = PluginDefinition<any>;
