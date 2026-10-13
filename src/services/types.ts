// Service Layer contract (contracts §8). Frozen: changes need an approved CCR.
import type {
  Assignee,
  BoardConfig,
  BoardRef,
  Comment,
  ConfigLevel,
  CustomFieldDef,
  CustomFieldInput,
  CustomFieldValue,
  DataRoot,
  EffectiveBoardConfig,
  Epic,
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
  WorkspaceConfig,
} from '../schemas';

export type { BoardRef, ConfigLevel, DataRoot, EffectiveBoardConfig };

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
}

export interface EpicView extends Epic {
  stories: Story[];
  progress: { done: number; total: number };
}

export type ConfigTarget =
  | { level: 'global' }
  | { level: 'workspace'; workspaceId: Slug }
  | { level: 'board'; ref: BoardRef };
export type Position = { before: Slug } | { after: Slug } | 'first' | 'last';
export type RankPosition = { before: StoryKey } | { after: StoryKey } | 'top' | 'bottom';

// ── Setup ───────────────────────────────────────────────────────────────────

export interface InitOptions {
  /** Where to create the Data Root: `<cwd>/.rowbly` (local) or `~/.rowbly` (`--global`). */
  root: DataRoot;
  /** Optional first Workspace (`--workspace`, `--workspace-name`). */
  workspace?: WorkspaceCreateInput;
  /** Optional first Board in that Workspace (`--board`, `--board-name`, `--prefix`). Requires `workspace`. */
  board?: BoardCreateInput;
}

export interface InitResult {
  root: DataRoot;
  workspace: WorkspaceConfig | null;
  board: BoardConfig | null;
}

// ── Workspaces & Assignees ──────────────────────────────────────────────────

export interface WorkspaceCreateInput {
  id: Slug;
  name: string;
  description?: string;
}

export interface WorkspacePatch {
  name?: string;
  description?: string;
}

export interface AssigneeInput {
  handle: Slug;
  name: string;
  email?: string;
}

export interface AssigneePatch {
  name?: string;
  /** `null` removes the email. */
  email?: string | null;
}

// ── Boards, Stages & Custom Fields ──────────────────────────────────────────

export interface BoardCreateInput {
  id: Slug;
  name: string;
  keyPrefix: KeyPrefix;
  description?: string;
}

export interface BoardPatch {
  name?: string;
  description?: string;
}

export interface StageInput {
  key: Slug;
  name: string;
  category: StageCategory;
}

export interface StagePatch {
  name?: string;
  category?: StageCategory;
}

/** Editable Custom Field properties. `type` and `key` are immutable; `null` clears an optional property. */
export interface CustomFieldPatch {
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
  /** `--epic <id>` (a Slug) or `--no-epic` (`null`). */
  epicId?: Slug | null;
  /** `--label`: any of these Labels. */
  labels?: Label[];
  /** `--priority`: any of these Priorities. */
  priorities?: Priority[];
  /** `--search`: case-insensitive substring of name or description. */
  search?: string;
  /** `--sort`; the default is Stage order, then Rank. */
  sort?: StorySort;
}

/**
 * Custom Field values keyed by field key. String values are coerced by the service according to
 * the field type (as typed on the command line, e.g. `"3"`, `"true"`, `"a,b"`).
 */
export type CustomFieldValuesInput = Record<Slug, CustomFieldValue>;

export interface StoryCreateInput {
  name: string;
  description?: string;
  /** Defaults to the first effective Stage. */
  stage?: Slug;
  /** Handles; the literal `'me'` resolves to Me. */
  assignees?: string[];
  epicId?: Slug | null;
  priority?: Priority | null;
  labels?: Label[];
  dueDate?: IsoDate | null;
  customFields?: CustomFieldValuesInput;
}

/** Mirrors `stories edit` flags. `null` clears (`--no-epic`, `--no-priority`, `--no-due`). */
export interface StoryPatch {
  name?: string;
  description?: string;
  /** `--assignee`: replaces the whole list. */
  assignees?: string[];
  /** `--add-assignee`. */
  addAssignees?: string[];
  /** `--remove-assignee`. */
  removeAssignees?: string[];
  epicId?: Slug | null;
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

export interface TaskCreateInput {
  name: string;
  description?: string;
  /** Defaults to the first effective Stage. */
  stage?: Slug;
}

export interface TaskPatch {
  name?: string;
  description?: string;
}

// ── Epics ───────────────────────────────────────────────────────────────────

export interface EpicCreateInput {
  id: Slug;
  name: string;
  description?: string;
}

export interface EpicPatch {
  name?: string;
  description?: string;
}

// ── Doctor ──────────────────────────────────────────────────────────────────

export type DoctorSeverity = 'error' | 'warning' | 'info';

export type DoctorCode =
  | 'SCHEMA_INVALID'
  | 'ID_PATH_MISMATCH'
  | 'STORY_KEY_CONFLICT'
  | 'DUPLICATE_KEY'
  | 'CONFLICT_MARKERS'
  | 'DUPLICATE_PREFIX'
  | 'UNKNOWN_STAGE'
  | 'UNKNOWN_ASSIGNEE'
  | 'MISSING_EPIC'
  | 'UNKNOWN_FIELD'
  | 'INVALID_FIELD_VALUE'
  | 'MISSING_REQUIRED_FIELD'
  | 'TASK_COUNTER_BEHIND'
  | 'DUPLICATE_RANK'
  | 'STALE_LOCAL_STATE'
  | 'UNKNOWN_FILE';

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
  resolveWorkspace(flag?: string): Promise<Slug>;
  /** `workspaceFlag` (`--workspace` → `ROWBLY_WORKSPACE`) scopes the fallbacks when `flag` is not `ws/board`. */
  resolveBoard(flag?: string, workspaceFlag?: string): Promise<BoardRef>;
  use(ws?: Slug, board?: Slug): Promise<LocalState>;
  clearUse(): Promise<void>;
  setMe(handle: Slug | null): Promise<LocalState>;
}

export interface SetupService {
  init(opts: InitOptions): Promise<InitResult>;
}

export interface ConfigService {
  effective(ref: BoardRef): Promise<EffectiveBoardConfig>;
}

export interface WorkspacesService {
  list(): Promise<WorkspaceConfig[]>;
  get(id: Slug): Promise<WorkspaceConfig>;
  create(input: WorkspaceCreateInput): Promise<WorkspaceConfig>;
  update(id: Slug, patch: WorkspacePatch): Promise<WorkspaceConfig>;
  remove(id: Slug, opts: { force: boolean }): Promise<void>;
}

export interface AssigneesService {
  list(ws: Slug): Promise<Assignee[]>;
  add(ws: Slug, input: AssigneeInput): Promise<Assignee>;
  update(ws: Slug, handle: Slug, patch: AssigneePatch): Promise<Assignee>;
  remove(ws: Slug, handle: Slug): Promise<{ storiesUpdated: number }>;
}

export interface BoardsService {
  list(ws: Slug): Promise<BoardConfig[]>;
  get(ref: BoardRef): Promise<BoardConfig>;
  create(ws: Slug, input: BoardCreateInput): Promise<BoardConfig>;
  update(ref: BoardRef, patch: BoardPatch): Promise<BoardConfig>;
  remove(ref: BoardRef, opts: { force: boolean }): Promise<void>;
}

export interface StagesService {
  list(ref: BoardRef): Promise<{ stages: Stage[]; source: ConfigLevel }>;
  add(target: ConfigTarget, input: StageInput, position?: Position): Promise<Stage[]>;
  update(target: ConfigTarget, key: Slug, patch: StagePatch): Promise<Stage[]>;
  move(target: ConfigTarget, key: Slug, position: Position): Promise<Stage[]>;
  remove(
    target: ConfigTarget,
    key: Slug,
    opts: { moveTo?: Slug },
  ): Promise<{ storiesMoved: number; tasksMoved: number }>;
}

export interface FieldsService {
  list(ref: BoardRef): Promise<{ fields: CustomFieldDef[]; source: ConfigLevel }>;
  add(target: ConfigTarget, def: CustomFieldInput): Promise<CustomFieldDef[]>;
  update(target: ConfigTarget, key: Slug, patch: CustomFieldPatch): Promise<CustomFieldDef[]>;
  remove(target: ConfigTarget, key: Slug): Promise<{ valuesStripped: number }>;
}

export interface StoriesService {
  list(scope: BoardRef | { workspaceId: Slug }, filter: StoryFilter): Promise<Story[]>;
  /** Case-insensitive Story Key. */
  get(key: string): Promise<Story>;
  create(ref: BoardRef, input: StoryCreateInput): Promise<Story>;
  update(key: string, patch: StoryPatch): Promise<Story>;
  move(key: string, stage: Slug, opts?: { top?: boolean }): Promise<Story>;
  rank(key: string, position: RankPosition): Promise<Story>;
  remove(key: string): Promise<void>;
  labelsInUse(ref: BoardRef): Promise<string[]>;
}

export interface TasksService {
  list(storyKey: string): Promise<Task[]>;
  get(taskId: string): Promise<{ story: Story; task: Task }>;
  create(storyKey: string, input: TaskCreateInput): Promise<Task>;
  update(taskId: string, patch: TaskPatch): Promise<Task>;
  move(taskId: string, stage: Slug): Promise<Task>;
  remove(taskId: string): Promise<void>;
}

/** `target` is a Story Key or a Task id (case-insensitive). */
export interface CommentsService {
  list(target: StoryKey | TaskId): Promise<Comment[]>;
  add(target: StoryKey | TaskId, body: string): Promise<Comment>;
  update(target: StoryKey | TaskId, id: string, body: string): Promise<Comment>;
  remove(target: StoryKey | TaskId, id: string): Promise<void>;
}

export interface EpicsService {
  /** Default: open Epics only; `closed: true` only closed; `'all'` both. */
  list(ws: Slug, opts?: { closed?: boolean | 'all' }): Promise<EpicView[]>;
  get(ws: Slug, id: Slug): Promise<EpicView>;
  create(ws: Slug, input: EpicCreateInput): Promise<Epic>;
  update(ws: Slug, id: Slug, patch: EpicPatch): Promise<Epic>;
  setClosed(ws: Slug, id: Slug, closed: boolean): Promise<Epic>;
  remove(ws: Slug, id: Slug): Promise<{ storiesUnlinked: number }>;
}

export interface DoctorService {
  check(): Promise<DoctorReport>;
  fix(): Promise<DoctorReport>;
}

export interface Services {
  context: ContextService;
  setup: SetupService;
  config: ConfigService;
  workspaces: WorkspacesService;
  assignees: AssigneesService;
  boards: BoardsService;
  stages: StagesService;
  fields: FieldsService;
  stories: StoriesService;
  tasks: TasksService;
  comments: CommentsService;
  epics: EpicsService;
  doctor: DoctorService;
}
