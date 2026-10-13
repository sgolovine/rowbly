// The types of the Plugin API (ADR-0009). Plugins import them through `src/plugin-api`, never from here.
import type { Command } from 'commander';
import type { ComponentType } from 'react';
import type { ZodType } from 'zod';
import type {
  Assignee,
  BoardConfig,
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
  BoardCreateInput,
  BoardPatch,
  ConfigTarget,
  CustomFieldPatch,
  DoctorFinding,
  DoctorFix,
  DoctorSeverity,
  OperationOptions,
  Position,
  RankPosition,
  Services,
  StageInput,
  StagePatch,
  StoryCreateInput,
  StoryPatch,
  TaskCreateInput,
  TaskPatch,
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

/** What guards and reactions read. */
export interface ChangeSetView {
  /** Every change, in the order it was first made. */
  readonly changes: readonly Change[];
  /** The change of a Story, found by its key before or after the change. */
  story(key: string): StoryChange | undefined;
  board(id: string): BoardChange | undefined;
}

/**
 * The records an operation will save, once, at its end. Every method validates the record it is
 * given, and reads the stored record as `before` the first time a record changes.
 */
export interface ChangeSet extends ChangeSetView {
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
 * The Change Set as a Plugin's handler gets it: it can also write the Plugin's own files. A file name
 * is a path inside the Plugin's folder, such as `auth.json` or `notes/a.md`.
 */
export interface PluginChangeSet extends ChangeSet {
  /** The text of one of the Plugin's files: its pending version, else the stored one; `null` when none. */
  readFile(scope: FileScope, name: string): Promise<string | null>;
  writeFile(scope: FileScope, name: string, text: string): Promise<void>;
  deleteFile(scope: FileScope, name: string): Promise<void>;
}

// ── Operations (ADR-0012) ───────────────────────────────────────────────────

/** Every operation input may carry Plugin input as `plugins: { <id>: … }`. */
export type OperationInput = OperationOptions;

/**
 * The input and result of each core operation. An operation's input holds the service method's
 * arguments by name, with any Plugin input as `plugins`. A Plugin's own operations are named
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
  'fields.add': { input: { target: ConfigTarget; field: unknown } & OperationOptions; result: unknown[] };
  'fields.update': { input: { target: ConfigTarget; key: Slug } & CustomFieldPatch; result: unknown[] };
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
  'plugins.enable': { input: { id: string } & OperationOptions; result: unknown };
  'plugins.disable': { input: { id: string } & OperationOptions; result: unknown };
  /** One pass of `doctor --fix`: the findings it fixes. */
  'doctor.fix': { input: { findings: DoctorFinding[] } & OperationOptions; result: DoctorFix[] };
}

export type CoreOperationName = keyof CoreOperations;
type InputOf<K> = K extends CoreOperationName ? CoreOperations[K]['input'] : OperationInput;
type ResultOf<K> = K extends CoreOperationName ? CoreOperations[K]['result'] : unknown;

/** What a guard, transform or replacement of an operation receives. */
export interface OperationEvent<I, S> {
  /** The operation's name, such as `stories.create`. */
  name: string;
  input: I;
  /** This Plugin's part of `input.plugins`. */
  pluginInput: unknown;
  changes: PluginChangeSet;
  /** The context of the Plugin whose handler runs. */
  plugin: PluginContext<S>;
}

/** What a reaction receives: the saved Change Set and the operation's result. */
export interface ReactEvent<I, R, S> extends Omit<OperationEvent<I, S>, 'changes'> {
  changes: ChangeSetView;
  result: R;
}

/** A guard returns a rejection to stop the operation: nothing is saved, exit 4 (`CONFLICT`). */
export type GuardResult = { reject: string; hint?: string } | undefined;

export interface OperationHooks<I, R, S> {
  /** Sees the final Change Set before the save and may reject the operation. */
  guard?(event: OperationEvent<I, S>): GuardResult | undefined | Promise<GuardResult | undefined>;
  /** Changes the Change Set before the save. */
  transform?(event: OperationEvent<I, S>): void | Promise<void>;
  /** Runs after the save. It acts only outside Rowbly's data; a failure only warns. */
  react?(event: ReactEvent<I, R, S>): void | Promise<void>;
}

/** Hooks by operation name: core names are typed, other Plugins' operations (`<id>.<name>`) are not. */
export type OperationHookMap<S> = {
  [K in CoreOperationName | (string & {})]?: OperationHooks<InputOf<K>, ResultOf<K>, S>;
};

/** Runs instead of the core operation and fills the Change Set; `core()` runs the core operation. */
export type Replacement<I, R, S> = (event: OperationEvent<I, S> & { core(): Promise<R> }) => Promise<R>;

export type ReplacementMap<S> = {
  [K in CoreOperationName]?: Replacement<InputOf<K>, ResultOf<K>, S>;
};

// ── The Plugin's context and capabilities (ADR-0009) ─────────────────────────

/** A record that can carry bags. */
export interface Bagged {
  plugins?: PluginBags;
}

/** Read access to the Plugin's own `plugins/<id>/` folders; writes go through a Change Set. */
export interface PluginFiles {
  /** The file's text, or `null` when it does not exist. */
  read(scope: FileScope, name: string): Promise<string | null>;
  /** File names in the folder, recursively, as `/`-separated paths, sorted. */
  list(scope: FileScope): Promise<string[]>;
}

/** What a Plugin gets in every handler, command, screen and Action. */
export interface PluginContext<S = unknown> {
  readonly id: string;
  /** The Data Root's settings, checked by the Plugin's `settings` schema when it loaded. */
  readonly settings: S;
  /** A Board's settings: its bag deep-merged over the Data Root's; a list replaces (ADR-0005). */
  boardSettings(boardId: Slug): Promise<S>;
  /** This Plugin's bag on `record` parsed with `schema`, or `undefined` when it is missing or invalid. */
  readBag<T>(record: Bagged, schema: ZodType<T>): T | undefined;
  /** A copy of `record` with this Plugin's bag set to `bag`, or removed when `bag` is `undefined`. */
  writeBag<R extends Bagged>(record: R, bag: object | undefined): R;
  files: PluginFiles;
  /** Core services. Reads are free; each core operation called here saves on its own. */
  services: Services;
  /** Runs one of this Plugin's own operations, named `<id>.<name>`, through the whole pipeline. */
  operation<I extends object, R>(
    name: string,
    input: I & OperationInput,
    body: (changes: PluginChangeSet) => Promise<R>,
  ): Promise<R>;
  /** Opens `$VISUAL`/`$EDITOR` on `initial` and returns the saved text. Command mode only. */
  editText(initial: string): Promise<string>;
  /** Shown after the command, or as a toast in the TUI. */
  warn(message: string): void;
  /** Me, or `null`. */
  readonly me: Slug | null;
  now(): Date;
  /** A new random 8-character id, for records the Plugin keeps in its bags. */
  newId(): string;
}

// ── Command mode ────────────────────────────────────────────────────────────

/** What a Plugin command's action works with. */
export interface PluginCommandEnv<S> {
  plugin: PluginContext<S>;
  services: Services;
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

/** The core commands that take Plugin options (each passes them to its operation or filter). */
export type PluginOptionCommand =
  | 'assignees add'
  | 'assignees edit'
  | 'assignees remove'
  | 'boards create'
  | 'boards edit'
  | 'boards delete'
  | 'stories list'
  | 'stories create'
  | 'stories edit'
  | 'stories move'
  | 'stories rank'
  | 'stories delete'
  | 'tasks create'
  | 'tasks edit'
  | 'tasks move'
  | 'tasks delete';

/** A Plugin's options on one core command. */
export interface PluginCommandOptions {
  /** Long flags only, such as `--epic <id>` or `--no-epic`. */
  options: { flags: string; description: string; repeatable?: boolean }[];
  /**
   * Turns the parsed values of these options (by commander attribute name, e.g. `epic`) into this
   * Plugin's input (`plugins.<id>`), or the filter for `stories list`; `undefined` when none was given.
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
}

export interface PluginFinding {
  /** Without the Plugin's prefix: `MISSING_EPIC` is reported as `EPICS_MISSING_EPIC`. */
  code: string;
  severity: DoctorSeverity;
  /** Relative to the Data Root. */
  path: string;
  message: string;
  /** Repairs the finding in the Change Set of `doctor --fix`; returns what it did. */
  fix?(changes: PluginChangeSet): Promise<string> | string;
}

export interface PluginDoctor<S> {
  check(args: { data: DoctorData; plugin: PluginContext<S> }): Promise<PluginFinding[]> | PluginFinding[];
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
  /** Opens one of this Plugin's screens on top of the current one. */
  open(screen: string, params?: Record<string, unknown>): void;
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
  options?: readonly string[];
  /** The starting value. */
  value?: PluginFormValue;
}

export interface PluginStoryForm<S> {
  fields(args: { boardId: Slug; story: Story | null; plugin: PluginContext<S> }): Promise<PluginFormField[]>;
  /** This Plugin's input for `stories.create` / `stories.update`, or `undefined` for none. */
  input(values: Record<string, PluginFormValue>, story: Story | null): unknown;
}

export interface PluginStoryFilter<S> {
  fields(args: { boardId: Slug; plugin: PluginContext<S> }): Promise<PluginFormField[]>;
  /** This Plugin's filter (`StoryFilter.plugins.<id>`), or `undefined` for none. */
  filter(values: Record<string, PluginFormValue>): unknown;
  /** A short summary of the chosen values for the filter line; `''` for none. */
  describe(values: Record<string, PluginFormValue>): string;
}

export interface PluginScreenProps<S> {
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
