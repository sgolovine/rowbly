// Service Layer contract (contracts §8). Frozen: changes need an approved CCR.

import type {
  Assignee,
  BoardConfig,
  Comment,
  ConfigLevel,
  CustomFieldDef,
  CustomFieldInput,
  CustomFieldValue,
  DataRoot,
  EffectiveBoardConfig,
  IsoDate,
  KeyPrefix,
  Label,
  LocalState,
  Priority,
  Slug,
  Stage,
  StageCategory,
  Story,
  StoryKey,
  Task,
  TaskId,
} from '../schemas';
import type { PluginHost, PluginStatus } from './plugins/host';
import type { PluginContext } from './plugins/types';

export type { ConfigLevel, DataRoot, EffectiveBoardConfig };

export interface RowblyContext {
  /** Resolved path + kind ('local' | 'global'). */
  root: DataRoot;
  local: LocalState;
  me: Slug | null;
  /** Injectable clock. */
  now(): Date;
  /** Injectable nanoid(8). */
  newId(): string;
  /** Collected by the caller for output. */
  warn(message: string): void;
  /** The Plugins loaded for this Data Root; none when omitted. */
  plugins?: PluginHost;
  /** Run reactions after the save without waiting for them (the TUI); command mode waits. */
  backgroundReactions?: boolean;
}

/** Plugin input, keyed by Plugin id: `{ epics: { epic: 'auth' } }` (ADR-0012). */
export type PluginInput = Record<string, unknown>;

/**
 * Plugin input reaches an operation as `plugins` in the operation's last argument: its input or
 * patch, or else a trailing `opts`.
 */
export interface OperationOptions {
  plugins?: PluginInput;
}

export type ConfigTarget = { level: 'global' } | { level: 'board'; boardId: Slug };
export type Position = { before: Slug } | { after: Slug } | 'first' | 'last';
export type RankPosition = { before: StoryKey } | { after: StoryKey } | 'top' | 'bottom';

// ── Setup ───────────────────────────────────────────────────────────────────

export interface InitOptions {
  /** Where to create the Data Root: `<cwd>/.rowbly` (local) or `~/.rowbly` (`--global`). */
  root: DataRoot;
  /** Optional first Board (`--board`, `--board-name`, `--prefix`). */
  board?: BoardCreateInput;
}

export interface InitResult {
  root: DataRoot;
  board: BoardConfig | null;
}

// ── Assignees ───────────────────────────────────────────────────────────────

export interface AssigneeInput extends OperationOptions {
  handle: Slug;
  name: string;
  email?: string;
}

export interface AssigneePatch extends OperationOptions {
  name?: string;
  /** `null` removes the email. */
  email?: string | null;
}

// ── Boards, Stages & Custom Fields ──────────────────────────────────────────

export interface BoardCreateInput extends OperationOptions {
  id: Slug;
  name: string;
  keyPrefix: KeyPrefix;
  description?: string;
}

export interface BoardPatch extends OperationOptions {
  name?: string;
  description?: string;
}

export interface StageInput {
  key: Slug;
  name: string;
  category: StageCategory;
}

export interface StagePatch extends OperationOptions {
  name?: string;
  category?: StageCategory;
}

/** Editable Custom Field properties. `type` and `key` are immutable; `null` clears an optional property. */
export interface CustomFieldPatch extends OperationOptions {
  name?: string;
  description?: string | null;
  required?: boolean;
  options?: string[];
  min?: number | null;
  max?: number | null;
  integer?: boolean;
}

// ── Stories ─────────────────────────────────────────────────────────────────

export type StorySort = 'rank' | 'priority' | 'created' | 'updated' | 'due';

/** Story list filters; every given filter must match. Mirrors `stories list` flags. */
export interface StoryFilter {
  /** `--stage`: any of these Stage keys. */
  stages?: Slug[];
  /** `--category`. */
  category?: StageCategory;
  /** `--open`: Stage Category is not `done`. */
  open?: boolean;
  /** `--assignee`: any of these handles; the literal `'me'` resolves to Me (`UsageError` if Me is unset). */
  assignees?: string[];
  /** `--label`: any of these Labels. */
  labels?: Label[];
  /** `--priority`: any of these Priorities. */
  priorities?: Priority[];
  /** `--search`: case-insensitive substring of name or description. */
  search?: string;
  /** `--sort`; the default is Stage order, then Rank. */
  sort?: StorySort;
  /** Plugin filters, keyed by Plugin id; each Plugin's `filterStories` decides what matches. */
  plugins?: PluginInput;
}

/**
 * Custom Field values keyed by field key. String values are coerced by the service according to
 * the field type (as typed on the command line, e.g. `"3"`, `"true"`, `"a,b"`).
 */
export type CustomFieldValuesInput = Record<Slug, CustomFieldValue>;

export interface StoryCreateInput extends OperationOptions {
  name: string;
  description?: string;
  /** Defaults to the first effective Stage. */
  stage?: Slug;
  /** Handles; the literal `'me'` resolves to Me. */
  assignees?: string[];
  priority?: Priority | null;
  labels?: Label[];
  dueDate?: IsoDate | null;
  customFields?: CustomFieldValuesInput;
}

/** Mirrors `stories edit` flags. `null` clears (`--no-priority`, `--no-due`). */
export interface StoryPatch extends OperationOptions {
  name?: string;
  description?: string;
  /** `--assignee`: replaces the whole list. */
  assignees?: string[];
  /** `--add-assignee`. */
  addAssignees?: string[];
  /** `--remove-assignee`. */
  removeAssignees?: string[];
  priority?: Priority | null;
  /** `--label`: replaces the whole list. */
  labels?: Label[];
  /** `--add-label`. */
  addLabels?: Label[];
  /** `--remove-label`. */
  removeLabels?: Label[];
  dueDate?: IsoDate | null;
  /** `--field k=v`: sets these values, keeping the others. */
  customFields?: CustomFieldValuesInput;
  /** `--unset-field`. */
  unsetFields?: Slug[];
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export interface TaskCreateInput extends OperationOptions {
  name: string;
  description?: string;
  /** Defaults to the first effective Stage. */
  stage?: Slug;
}

export interface TaskPatch extends OperationOptions {
  name?: string;
  description?: string;
}

// ── Doctor ──────────────────────────────────────────────────────────────────

export type DoctorSeverity = 'error' | 'warning' | 'info';

export type CoreDoctorCode =
  | 'SCHEMA_INVALID'
  | 'ID_PATH_MISMATCH'
  | 'STORY_KEY_CONFLICT'
  | 'DUPLICATE_KEY'
  | 'CONFLICT_MARKERS'
  | 'DUPLICATE_PREFIX'
  | 'UNKNOWN_STAGE'
  | 'UNKNOWN_ASSIGNEE'
  | 'UNKNOWN_FIELD'
  | 'INVALID_FIELD_VALUE'
  | 'MISSING_REQUIRED_FIELD'
  | 'TASK_COUNTER_BEHIND'
  | 'DUPLICATE_RANK'
  | 'STALE_LOCAL_STATE'
  | 'UNKNOWN_FILE'
  | 'PLUGIN_FAILED'
  | 'PLUGIN_DATA_INVALID'
  | 'PLUGIN_DATA_UNCHECKED';

/** A core code, or a Plugin's code prefixed with its id, such as `EPICS_MISSING_EPIC`. */
export type DoctorCode = CoreDoctorCode | (string & {});

export interface DoctorFinding {
  code: DoctorCode;
  severity: DoctorSeverity;
  /** File or folder the finding is about, relative to the Data Root. */
  path: string;
  message: string;
  fixable: boolean;
  /** Extra data such as zod issues. */
  details?: Record<string, unknown>;
}

export interface DoctorFix {
  code: DoctorCode;
  path: string;
  /** What `--fix` did, e.g. "renumbered WEB-4 to WEB-5". */
  message: string;
}

export interface DoctorReport {
  /** Findings that remain (after fixes, when fixing). */
  findings: DoctorFinding[];
  /** Fixes applied; always empty for `check()`. */
  fixed: DoctorFix[];
  summary: { errors: number; warnings: number; info: number };
}

// ── Services ────────────────────────────────────────────────────────────────

export interface ContextService {
  resolveBoard(flag?: string): Promise<Slug>;
  use(board: Slug, opts?: OperationOptions): Promise<LocalState>;
  clearUse(opts?: OperationOptions): Promise<void>;
  setMe(handle: Slug | null, opts?: OperationOptions): Promise<LocalState>;
}

export interface SetupService {
  init(opts: InitOptions): Promise<InitResult>;
}

export interface ConfigService {
  effective(boardId: Slug): Promise<EffectiveBoardConfig>;
}

export interface AssigneesService {
  list(): Promise<Assignee[]>;
  add(input: AssigneeInput): Promise<Assignee>;
  update(handle: Slug, patch: AssigneePatch): Promise<Assignee>;
  remove(handle: Slug, opts?: OperationOptions): Promise<{ storiesUpdated: number }>;
}

export interface BoardsService {
  list(): Promise<BoardConfig[]>;
  get(id: Slug): Promise<BoardConfig>;
  create(input: BoardCreateInput): Promise<BoardConfig>;
  update(id: Slug, patch: BoardPatch): Promise<BoardConfig>;
  remove(id: Slug, opts: { force: boolean } & OperationOptions): Promise<void>;
}

export interface StagesService {
  list(boardId: Slug): Promise<{ stages: Stage[]; source: ConfigLevel }>;
  add(target: ConfigTarget, input: StageInput, position?: Position, opts?: OperationOptions): Promise<Stage[]>;
  update(target: ConfigTarget, key: Slug, patch: StagePatch): Promise<Stage[]>;
  move(target: ConfigTarget, key: Slug, position: Position, opts?: OperationOptions): Promise<Stage[]>;
  remove(
    target: ConfigTarget,
    key: Slug,
    opts: { moveTo?: Slug } & OperationOptions,
  ): Promise<{ storiesMoved: number; tasksMoved: number }>;
}

export interface FieldsService {
  list(boardId: Slug): Promise<{ fields: CustomFieldDef[]; source: ConfigLevel }>;
  add(target: ConfigTarget, def: CustomFieldInput, opts?: OperationOptions): Promise<CustomFieldDef[]>;
  update(target: ConfigTarget, key: Slug, patch: CustomFieldPatch): Promise<CustomFieldDef[]>;
  remove(target: ConfigTarget, key: Slug, opts?: OperationOptions): Promise<{ valuesStripped: number }>;
}

export interface StoriesService {
  /** `boardId: null` lists Stories across every Board. */
  list(boardId: Slug | null, filter: StoryFilter): Promise<Story[]>;
  /** Case-insensitive Story Key. */
  get(key: string): Promise<Story>;
  create(boardId: Slug, input: StoryCreateInput): Promise<Story>;
  update(key: string, patch: StoryPatch): Promise<Story>;
  move(key: string, stage: Slug, opts?: { top?: boolean } & OperationOptions): Promise<Story>;
  rank(key: string, position: RankPosition, opts?: OperationOptions): Promise<Story>;
  remove(key: string, opts?: OperationOptions): Promise<void>;
  labelsInUse(boardId: Slug): Promise<string[]>;
}

export interface TasksService {
  list(storyKey: string): Promise<Task[]>;
  get(taskId: string): Promise<{ story: Story; task: Task }>;
  create(storyKey: string, input: TaskCreateInput): Promise<Task>;
  update(taskId: string, patch: TaskPatch): Promise<Task>;
  move(taskId: string, stage: Slug, opts?: OperationOptions): Promise<Task>;
  remove(taskId: string, opts?: OperationOptions): Promise<void>;
}

/** `target` is a Story Key or a Task id (case-insensitive). */
export interface CommentsService {
  list(target: StoryKey | TaskId): Promise<Comment[]>;
  add(target: StoryKey | TaskId, body: string, opts?: OperationOptions): Promise<Comment>;
  update(target: StoryKey | TaskId, id: string, body: string, opts?: OperationOptions): Promise<Comment>;
  remove(target: StoryKey | TaskId, id: string, opts?: OperationOptions): Promise<void>;
}

export interface DoctorService {
  check(): Promise<DoctorReport>;
  fix(): Promise<DoctorReport>;
}

/** `rowbly plugins …` (ADR-0010). Turning a Plugin on or off takes effect on the next run. */
export interface PluginsService {
  /** Every Built-in Plugin, and any other Plugin `rowbly.config.json` names, with its state this run. */
  list(): Promise<PluginStatus[]>;
  get(id: string): Promise<PluginStatus>;
  /** Sets `enabled: true`; the Plugin's settings must be valid. */
  enable(id: string, opts?: OperationOptions): Promise<{ id: string; enabled: boolean }>;
  /** Sets `enabled: false`; keeps the Plugin's settings and data. */
  disable(id: string, opts?: OperationOptions): Promise<{ id: string; enabled: boolean }>;
  /** The context a Plugin that is on gets in its commands, screens and Actions. */
  context(id: string): PluginContext;
}

export interface Services {
  context: ContextService;
  setup: SetupService;
  config: ConfigService;
  assignees: AssigneesService;
  boards: BoardsService;
  stages: StagesService;
  fields: FieldsService;
  stories: StoriesService;
  tasks: TasksService;
  comments: CommentsService;
  doctor: DoctorService;
  plugins: PluginsService;
}
