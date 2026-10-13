# Rowbly v1 — Contracts

These contracts are **frozen at Checkpoint A** (after WP00–WP02 merge). WP00 turns §2, §6 and §8 into code; from then on, changing them requires a contract change request (supervisor.md §5). Terms follow `/CONTEXT.md`.

## 1. Data Root layout

```text
.rowbly/                                   # Data Root (or ~/.rowbly)
  rowbly.config.json                       # required — global config
  local.json                               # Local State — gitignored, never committed
  .gitignore                               # contains: local.json
  workspaces/
    <workspace-id>/
      workspace.config.json                # required — workspace metadata + roster + optional overrides
      boards/
        <board-id>/
          board.config.json                # required — board metadata + key prefix + optional overrides
          stories/
            <STORY-KEY>.json               # one Story, with its Tasks and Comments embedded
      epics/
        <epic-id>.json
```

- `docs/ARCHITECTURE.md` called the root `rowbly/`; it is `.rowbly/` (ADR-0002).
- `workspace.config.json` and `board.config.json` are **required** (they hold identity metadata); their `stages`/`customFields` keys are optional overrides.
- The id stored inside a file must equal its folder/file name. A mismatch is a `DataIntegrityError` (and a `doctor` finding).
- Any file or folder not matching this layout is ignored by repositories and reported by `doctor` as a warning.

### Identifier rules

| Identifier | Format | Mutable? | Uniqueness |
| --- | --- | --- | --- |
| Workspace id, Board id, Epic id, Stage key, Custom Field key, Assignee handle | slug: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1–40 chars | **No** (v1 has no rename; `name` is editable) | Workspace: Data Root · Board, Epic, Assignee: Workspace · Stage, Field: one config list |
| Board key prefix | `^[A-Z][A-Z0-9]{1,9}$` | **No** | Entire Data Root (so a bare Story Key always resolves) |
| Story Key | `<PREFIX>-<n>`, n ≥ 1, allocated as max existing n on that Board + 1 (ADR-0003). Deleted keys may be reused. | No | Board (hence Data Root) |
| Task id | `<STORY-KEY>.<n>`, n from the Story's `nextTaskNumber`, never reused | No | Story |
| Comment id | `nanoid(8)` | No | Story (including its Tasks) |
| Label | lower-kebab-case, same regex as slug, 1–40 chars | — | — |

Story Key input is case-insensitive (`web-42` → `WEB-42`).

## 2. Schemas (zod, `src/schemas/`)

Shown as TypeScript for readability; WP00 writes the zod schemas and exports `z.infer` types with these exact names. `Timestamp` is an ISO-8601 UTC string with milliseconds (`2026-10-12T17:21:07.000Z`). `IsoDate` is `YYYY-MM-DD`. Every persisted root object has `version: 1`.

```ts
type StageCategory = 'todo' | 'in_progress' | 'done';
interface Stage { key: Slug; name: string /*1–60*/; category: StageCategory }

type CustomFieldDef = {
  key: Slug; name: string /*1–60*/; description?: string; required: boolean /*default false*/;
} & (
  | { type: 'text' }
  | { type: 'number'; min?: number; max?: number; integer?: boolean }
  | { type: 'boolean' }
  | { type: 'date' }                                   // value: IsoDate
  | { type: 'url' }                                    // value: absolute http(s) URL
  | { type: 'select'; options: string[] /*≥1, unique*/ }       // value: one option
  | { type: 'multiselect'; options: string[] /*≥1, unique*/ }  // value: unique subset
);
type CustomFieldValue = string | number | boolean | string[];

interface RowblyConfig {           // rowbly.config.json
  version: 1;
  stages?: Stage[];                // ≥1, unique keys
  customFields?: CustomFieldDef[]; // unique keys
}

interface Assignee { handle: Slug; name: string; email?: string }

interface WorkspaceConfig {        // workspace.config.json
  version: 1; id: Slug; name: string; description: string /*default ''*/;
  assignees: Assignee[];
  stages?: Stage[]; customFields?: CustomFieldDef[];
  createdAt: Timestamp; updatedAt: Timestamp;
}

interface BoardConfig {            // board.config.json
  version: 1; id: Slug; workspaceId: Slug; name: string; description: string;
  keyPrefix: KeyPrefix;
  stages?: Stage[]; customFields?: CustomFieldDef[];
  createdAt: Timestamp; updatedAt: Timestamp;
}

type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';

interface Comment { id: string; author: Slug | null; body: string /*≥1*/; createdAt: Timestamp; updatedAt: Timestamp }

interface Task {
  id: TaskId; name: string /*1–200*/; description: string; stage: Slug;
  comments: Comment[]; createdAt: Timestamp; updatedAt: Timestamp;
}

interface Story {                  // stories/<KEY>.json
  version: 1; key: StoryKey; workspaceId: Slug; boardId: Slug;
  name: string /*1–200*/; description: string /*markdown, default ''*/;
  stage: Slug; rank: string /*fractional-indexing key*/;
  assignees: Slug[]; epicId: Slug | null; priority: Priority | null;
  labels: Label[]; dueDate: IsoDate | null;
  customFields: Record<Slug, CustomFieldValue>;
  createdBy: Slug | null; createdAt: Timestamp; updatedAt: Timestamp;
  nextTaskNumber: number /*int ≥1*/;
  tasks: Task[]; comments: Comment[];
}

interface Epic {                   // epics/<id>.json
  version: 1; id: Slug; workspaceId: Slug; name: string; description: string;
  closed: boolean; createdAt: Timestamp; updatedAt: Timestamp;
}

interface LocalState {             // local.json
  version: 1; workspace?: Slug; board?: Slug; me?: Slug;
}
```

**Two validation levels.**

1. *Shape* (zod) is enforced by the storage layer on every read and write.
2. *Referential* rules are enforced by services on writes. A Story's `stage` and each Task's `stage` must be in the Board's effective stages. `assignees` must be in the Workspace roster. `epicId` must be an existing Epic in the same Workspace. `customFields` keys must be effective fields, values must match the field type and options, and required fields must be present. `createdBy`/`author` is set to Me when Me is in the Workspace roster, else `null`.

Referential drift that can only arise from hand edits or merges (for example a missing stage) is reported by `doctor`. Reads stay tolerant: they do not throw on referential drift.

**Built-in default stages** (used when no cascade level defines `stages`, and written by `init`):
`backlog` "Backlog" todo · `todo` "Todo" todo · `in-progress` "In Progress" in_progress · `done` "Done" done.

## 3. Configuration Cascade

```ts
effectiveStages(ws, board)       = board.stages       ?? ws.stages       ?? root.stages       ?? DEFAULT_STAGES
effectiveCustomFields(ws, board) = board.customFields ?? ws.customFields ?? root.customFields ?? []
```

`resolveBoardConfig()` returns both lists **plus the level each came from** (`'board' | 'workspace' | 'global' | 'default'`).

Stage and Custom Field CRUD take `--level board|workspace|global`. The default is `board` when a board is in context, otherwise `workspace`. Writing at a level that has no list first **copies the currently effective list** to that level (copy-on-write), then applies the change. An edit at workspace or global level affects every Board that inherits from that level. Services compute the set of affected Boards and apply the deletion rules (§7) across all of them.

Stage keys and field keys are immutable. Stage `name`/`category`/position and field `name`/`description`/`required`/`options`/`min`/`max`/`integer` are editable; field `type` is not.

## 4. Context resolution

| Need | Resolution order |
| --- | --- |
| Data Root | `--root` → `ROWBLY_ROOT` → nearest `.rowbly/` walking up from cwd → `~/.rowbly` if it exists → `DataRootNotFoundError` (exit 5, hint: `rowbly init`) |
| Workspace | `--workspace` → `ROWBLY_WORKSPACE` → `local.json.workspace` → the only Workspace → `UsageError` "workspace required" |
| Board | `--board` (accepts `ws/board`) → `ROWBLY_BOARD` → `local.json.board` (only if Workspace matches) → the only Board in the Workspace → `UsageError` |
| Story / Task | The Story Key prefix resolves its Workspace and Board through a prefix index built from all `board.config.json` files. No flags are needed. |
| Me | `local.json.me` → a roster entry whose `email` equals `git config user.email` → none |

`--assignee me` resolves to Me; it is a `UsageError` if Me is unset.

## 5. CLI surface

Global flags on every command: `--root <path>`, `--json`, `--yes` (skip confirmations), `--no-prompt` (never prompt), `-h/--help`, `-V/--version`. Colour follows `NO_COLOR` / `FORCE_COLOR` (picocolors).

**Prompting.** Clack prompts for a missing required argument are allowed only when stdin and stdout are both TTYs and neither `--json` nor `--no-prompt` is set. Otherwise the command fails with a `UsageError`. Destructive commands confirm through Clack under the same conditions; when not interactive they require `--yes`.

**Long text.** `--description <text>`, `--description-file <path|->`, or `--edit` opens `$VISUAL`/`$EDITOR` (fallback `vi`). Comments use `--body`, `--body-file` and `--edit` in the same way.

**Repeated values.** Flags such as `--assignee`, `--label` and `--field key=value` may be repeated, or given comma-separated.

```text
rowbly                                         # TUI (requires TTY; otherwise prints help, exit 2)
rowbly init [--global] [--workspace <id> --workspace-name <n> --board <id> --board-name <n> --prefix <P>]
rowbly use [<ws>[/<board>]] [--clear]          # no arg: show current context
rowbly whoami [<handle>] [--clear]             # no arg: show Me
rowbly config show [--workspace <ws>] [--board <b>]   # effective stages + fields with source level

rowbly workspaces list | create <id> --name <n> [--description] | show [<id>] | edit <id> [--name] [--description] | delete <id> [--force]
rowbly assignees  list | add <handle> --name <n> [--email] | edit <handle> [--name] [--email] | remove <handle>        [--workspace]
rowbly boards     list | create <id> --name <n> --prefix <P> [--description] | show [<id>] | edit <id> [--name] [--description] | delete <id> [--force]   [--workspace]

rowbly stages list | add <key> --name <n> --category <c> [--before <key>|--after <key>] | edit <key> [--name] [--category]
             | move <key> (--before <key>|--after <key>|--first|--last) | remove <key> [--move-to <key>]        [--board] [--level]
rowbly fields list | add <key> --name <n> --type <t> [--options a,b] [--required] [--min] [--max] [--integer] [--description]
             | edit <key> [--name] [--description] [--required|--optional] [--options] [--min] [--max] [--integer] | remove <key>   [--board] [--level]

rowbly stories list [--stage <k>…] [--category <c>] [--open] [--assignee <h|me>…] [--epic <id>|--no-epic] [--label <l>…]
                    [--priority <P>…] [--search <text>] [--sort rank|priority|created|updated|due] [--board] [--all-boards]
rowbly stories create --name <n> [desc flags] [--stage <k>] [--assignee …] [--epic <id>] [--priority <P>] [--label …] [--due <date>] [--field k=v …] [--board]
rowbly stories show <KEY>
rowbly stories edit <KEY> [--name] [desc flags] [--assignee … (replace) | --add-assignee … | --remove-assignee …]
                    [--epic <id> | --no-epic] [--priority <P> | --no-priority] [--label … | --add-label … | --remove-label …]
                    [--due <date> | --no-due] [--field k=v …] [--unset-field <k> …]
rowbly stories move <KEY> <stage> [--top]      # default: bottom of target stage
rowbly stories rank <KEY> (--before <KEY>|--after <KEY>|--top|--bottom)
rowbly stories delete <KEY>

rowbly tasks list <KEY> | create <KEY> --name <n> [desc flags] [--stage <k>] | show <TASK-ID>
            | edit <TASK-ID> [--name] [desc flags] | move <TASK-ID> <stage> | delete <TASK-ID>
rowbly comments list <KEY|TASK-ID> | add <KEY|TASK-ID> [body flags] | edit <KEY|TASK-ID> <comment-id> [body flags] | delete <KEY|TASK-ID> <comment-id>

rowbly epics list [--closed|--all] | create <id> --name <n> [--description] | show <id> | edit <id> [--name] [--description]
            | close <id> | reopen <id> | delete <id>        [--workspace]

rowbly doctor [--fix]
```

Defaults: a new Story goes into the **first** effective stage, at the bottom. A new Task goes into the first effective stage. `stories list` sorts by stage order, then rank, unless `--sort` is given. `--open` means stage category ≠ `done`. `--search` is a case-insensitive substring match on name and description.

## 6. Errors and exit codes (`src/core/errors.ts`)

| Class | `code` | Exit | Used for |
| --- | --- | --- | --- |
| (uncaught) | `INTERNAL` | 1 | bugs |
| `UsageError` | `USAGE` | 2 | bad flags, missing args, context not resolvable, non-interactive without `--yes` |
| `ValidationError` | `VALIDATION` | 2 | schema or referential rule violated on input; `details.issues` |
| `NotFoundError` | `NOT_FOUND` | 3 | unknown workspace/board/story/task/comment/epic/stage/field/assignee |
| `ConflictError` | `CONFLICT` | 4 | id/prefix already exists; deletion refused (§7); key collision |
| `DataRootNotFoundError` | `NO_DATA_ROOT` | 5 | no Data Root found |
| `DataIntegrityError` | `DATA_INTEGRITY` | 6 | file on disk fails schema or id/path mismatch; `details.path` |

Human mode writes `error: <message>` (red) plus an optional hint to stderr. `--json` mode writes `{"error":{"code","message","details"}}` to stderr. Warnings go to stderr in both modes; in `--json` mode they are written as `{"warning":…}` lines.

## 7. Deletion and reference rules

| Action | Rule |
| --- | --- |
| Remove a Stage | Refuse (`ConflictError`) if any Story or Task on an affected Board uses it, unless `--move-to <key>` is given. That moves them all, and moved Stories go to the bottom. Refuse to remove the last stage. |
| Remove a Custom Field | Strip its values from all Stories on affected Boards; warn with a count. |
| Edit field options | Strip values that are no longer valid; warn with a count. |
| Remove an Assignee | Remove the handle from all Stories in the Workspace; warn with a count. |
| Delete an Epic | Set `epicId: null` on its Stories; warn with a count. |
| Delete a Board / Workspace | Refuse if non-empty unless `--force`, which deletes recursively. Always confirm (or `--yes`). |
| Delete a Story / Task / Comment | Confirm (or `--yes`). |

## 8. Service interfaces (`src/services/types.ts`)

All services are plain async functions grouped in objects created by `createServices(ctx: RowblyContext)`. They return schema types (or the view types below), never print, and throw §6 errors.

```ts
interface RowblyContext {
  root: DataRoot;                       // resolved path + kind ('local' | 'global')
  local: LocalState;
  me: Slug | null;
  now(): Date;                          // injectable clock
  newId(): string;                      // injectable nanoid(8)
  warn(message: string): void;          // collected by caller for output
}

interface BoardRef { workspaceId: Slug; boardId: Slug }
interface EffectiveBoardConfig {
  board: BoardConfig;
  stages: Stage[];        stagesSource: ConfigLevel;
  customFields: CustomFieldDef[]; customFieldsSource: ConfigLevel;
}
type ConfigLevel = 'board' | 'workspace' | 'global' | 'default';
interface EpicView extends Epic { stories: Story[]; progress: { done: number; total: number } }

interface Services {
  context:    { resolveWorkspace(flag?: string): Promise<Slug>; resolveBoard(flag?: string): Promise<BoardRef>;
                use(ws?: Slug, board?: Slug): Promise<LocalState>; clearUse(): Promise<void>;
                setMe(handle: Slug | null): Promise<LocalState> };
  setup:      { init(opts: InitOptions): Promise<InitResult> };
  config:     { effective(ref: BoardRef): Promise<EffectiveBoardConfig> };
  workspaces: { list(): Promise<WorkspaceConfig[]>; get(id): Promise<WorkspaceConfig>; create(input): Promise<WorkspaceConfig>;
                update(id, patch): Promise<WorkspaceConfig>; remove(id, opts: { force: boolean }): Promise<void> };
  assignees:  { list(ws): Promise<Assignee[]>; add(ws, input): Promise<Assignee>; update(ws, handle, patch): Promise<Assignee>;
                remove(ws, handle): Promise<{ storiesUpdated: number }> };
  boards:     { list(ws): Promise<BoardConfig[]>; get(ref): Promise<BoardConfig>; create(ws, input): Promise<BoardConfig>;
                update(ref, patch): Promise<BoardConfig>; remove(ref, opts: { force: boolean }): Promise<void> };
  stages:     { list(ref): Promise<{ stages: Stage[]; source: ConfigLevel }>;
                add(target: ConfigTarget, input, position?: Position): Promise<Stage[]>;
                update(target, key, patch): Promise<Stage[]>; move(target, key, position: Position): Promise<Stage[]>;
                remove(target, key, opts: { moveTo?: Slug }): Promise<{ storiesMoved: number; tasksMoved: number }> };
  fields:     { list(ref): Promise<{ fields: CustomFieldDef[]; source: ConfigLevel }>; add(target, def): Promise<CustomFieldDef[]>;
                update(target, key, patch): Promise<CustomFieldDef[]>; remove(target, key): Promise<{ valuesStripped: number }> };
  stories:    { list(scope: BoardRef | { workspaceId: Slug }, filter: StoryFilter): Promise<Story[]>; get(key): Promise<Story>;
                create(ref, input): Promise<Story>; update(key, patch: StoryPatch): Promise<Story>;
                move(key, stage, opts?: { top?: boolean }): Promise<Story>; rank(key, position: RankPosition): Promise<Story>;
                remove(key): Promise<void>; labelsInUse(ref): Promise<string[]> };
  tasks:      { list(storyKey): Promise<Task[]>; get(taskId): Promise<{ story: Story; task: Task }>;
                create(storyKey, input): Promise<Task>; update(taskId, patch): Promise<Task>;
                move(taskId, stage): Promise<Task>; remove(taskId): Promise<void> };
  comments:   { list(target: StoryKey | TaskId): Promise<Comment[]>; add(target, body): Promise<Comment>;
                update(target, id, body): Promise<Comment>; remove(target, id): Promise<void> };
  epics:      { list(ws, opts?: { closed?: boolean | 'all' }): Promise<EpicView[]>; get(ws, id): Promise<EpicView>;
                create(ws, input): Promise<Epic>; update(ws, id, patch): Promise<Epic>;
                setClosed(ws, id, closed: boolean): Promise<Epic>; remove(ws, id): Promise<{ storiesUnlinked: number }> };
  doctor:     { check(): Promise<DoctorReport>; fix(): Promise<DoctorReport> };
}
type ConfigTarget = { level: 'global' } | { level: 'workspace'; workspaceId: Slug } | { level: 'board'; ref: BoardRef };
type Position = { before: Slug } | { after: Slug } | 'first' | 'last';
type RankPosition = { before: StoryKey } | { after: StoryKey } | 'top' | 'bottom';
```

Input, patch, filter, `InitOptions`/`InitResult` and `DoctorReport` types are defined by WP00 in `types.ts`. Their fields mirror the CLI flags in §5. Each owning package fills in the implementation; WP00 ships each service as stubs that throw `new Error('not implemented: <WPxx>')`.

## 9. Storage layer (`src/storage/`)

```ts
findDataRoot(opts: { cwd: string; flag?: string; env: NodeJS.ProcessEnv; home: string }): Promise<DataRoot>;
paths(root): { rootConfig; localState; workspace(ws); workspaceConfig(ws); board(ws,b); boardConfig(ws,b);
               storiesDir(ws,b); story(ws,b,key); epicsDir(ws); epic(ws,id) };
readJson<T>(path, schema: ZodType<T>): Promise<T>;        // ENOENT → NotFoundError; bad JSON/schema → DataIntegrityError
writeJson<T>(path, schema, value: T): Promise<void>;     // validate → mkdir -p → write tmp → rename; 2-space, trailing \n,
                                                         // keys in schema order (serialize the zod-parsed value)
repositories: workspaces, boards, stories, epics, rootConfig, localState — list/get/put/delete over the paths above;
              stories.allInBoard(ref), stories.findByKey(key) via prefix index.
resolveCascade(root, ref): Promise<EffectiveBoardConfig>;
```

Only `src/storage/` may import `node:fs`. Story rank keys use `fractional-indexing` (`generateKeyBetween`). Rank is scoped to the Story's current stage.
