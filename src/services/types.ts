// Service Layer contract (contracts §8). Frozen: changes need an approved CCR.

import type {
  BoardConfig,
  ConfigLevel,
  CustomFieldDef,
  CustomFieldInput,
  CustomFieldValue,
  DataRoot,
  EffectiveBoardConfig,
  EffectiveGlobalConfig,
  IsoDate,
  KeyPrefix,
  Label,
  LocalState,
  Priority,
  RowblyConfig,
  Slug,
  Stage,
  StageCategory,
  Story,
  StoryKey,
} from '../schemas';
import type { PluginHost, PluginStatus } from './plugins/host';
import type { PluginContext } from './plugins/types';

export type { ConfigLevel, DataRoot, EffectiveBoardConfig, EffectiveGlobalConfig };

export interface RowblyContext {
  /** Resolved path + kind ('local' | 'global'). */
  root: DataRoot;
  local: LocalState;
  /** Me: Local State's `me`, else `globalMe`, else `null` (ADR-0032). */
  me: Slug | null;
  /** Global Me from the Home Config, the fallback when Local State has no `me`; none when omitted. */
  globalMe?: Slug | null;
  /** The home folder whose Home Config holds global Me; `os.homedir()` when omitted. */
  home?: string;
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
  /** How long each reaction may run before Rowbly warns and goes on (W7); 5 s when omitted. */
  reactionTimeoutMs?: number;
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

/** A configured Stage; it is in the `board` Stage Category (ADR-0024). */
export interface StageInput {
  key: Slug;
  name: string;
}

export interface StagePatch extends OperationOptions {
  name?: string;
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
  /** `--label`: any of these Labels. */
  labels?: Label[];
  /** `--priority`: any of these Priorities. */
  priorities?: Priority[];
  /** `--search`: case-insensitive substring of name or description. */
  search?: string;
  /** `--sort`; the default is Stage order, then Rank. */
  sort?: StorySort;
  /**
   * Plugin filters, keyed by Plugin id; each Plugin's `filterStories` decides what matches. A filter
   * that is not `undefined` for a Plugin that is off, unknown or has no `filterStories` is a
   * `UsageError` (exit 2), not "no match" (CQ-72). A filter its `storyFilterSchema` rejects is a
   * `ValidationError` naming the Plugin.
   */
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
  priority?: Priority | null;
  labels?: Label[];
  dueDate?: IsoDate | null;
  customFields?: CustomFieldValuesInput;
}

/** Mirrors `stories edit` flags. `null` clears (`--no-priority`, `--no-due`). */
export interface StoryPatch extends OperationOptions {
  name?: string;
  description?: string;
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
  /** A new Stage moves the Story to the bottom of it, like `move`; the same Stage keeps the Rank. */
  stage?: Slug;
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
  | 'UNKNOWN_FIELD'
  | 'INVALID_FIELD_VALUE'
  | 'MISSING_REQUIRED_FIELD'
  | 'DUPLICATE_RANK'
  | 'STALE_LOCAL_STATE'
  | 'UNKNOWN_FILE'
  | 'PLUGIN_FAILED'
  | 'PLUGIN_DATA_INVALID'
  | 'PLUGIN_DATA_UNCHECKED'
  | 'TRANSACTION_PENDING'
  | 'TRANSACTION_LEFTOVER'
  | 'TEMP_FILE_LEFTOVER'
  | 'GITIGNORE_INCOMPLETE'
  | 'ORPHAN_FOLDER'
  | 'LEGACY_DATA'
  | 'MULTIPLE_DEFAULT_DATA_ROOTS';

/**
 * A core code, or a Plugin's code prefixed with its id, such as `EPICS_MISSING_EPIC`. `(string & {})`
 * admits any other string while editors still complete the core codes (CQ-17).
 */
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
  updateRootConfig(patch: { onboardingComplete: boolean }, opts?: OperationOptions): Promise<RowblyConfig>;
  effective(boardId: Slug): Promise<EffectiveBoardConfig>;
  /** The global level alone: the stored `rowbly.config.json` and the Stages and Custom Fields a Board without its own gets. */
  global(): Promise<EffectiveGlobalConfig>;
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
  ): Promise<{ storiesMoved: number }>;
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

export interface DoctorService {
  check(): Promise<DoctorReport>;
  fix(): Promise<DoctorReport>;
}

/** `rowbly plugins …` (ADR-0010). Turning a Plugin on or off takes effect on the next run. */
export interface PluginsService {
  /** Every Built-in Plugin, and any other Plugin `rowbly.config.json` names, with its state this run. */
  list(): Promise<PluginStatus[]>;
  /** A Plugin's state and its settings in `rowbly.config.json`. */
  get(id: string): Promise<PluginStatus & { settings: Record<string, unknown> }>;
  /** Sets `enabled: true`; the Plugin's settings must be valid. */
  enable(id: string, opts?: OperationOptions): Promise<{ id: string; enabled: boolean }>;
  /** Sets `enabled: false`; keeps the Plugin's settings and data. */
  disable(id: string, opts?: OperationOptions): Promise<{ id: string; enabled: boolean }>;
  /** The context a Plugin that is on gets in its commands, screens and Actions. */
  context(id: string): PluginContext;
}

export interface FeatureFlagDefinition {
  name: string;
  description: string;
  /** The default when the Data Root has no override. */
  enabled: boolean;
}

export interface FeatureFlag extends FeatureFlagDefinition {
  key: string;
}

export interface FeatureFlagsService {
  list(): Promise<FeatureFlag[]>;
  isEnabled(key: string): Promise<boolean>;
  set(key: string, enabled: boolean, opts?: OperationOptions): Promise<FeatureFlag>;
}

export interface Services {
  featureFlags: FeatureFlagsService;
  context: ContextService;
  setup: SetupService;
  config: ConfigService;
  boards: BoardsService;
  stages: StagesService;
  fields: FieldsService;
  stories: StoriesService;
  doctor: DoctorService;
  plugins: PluginsService;
}
