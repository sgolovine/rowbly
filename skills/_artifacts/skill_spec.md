# rowbly skill spec

Rowbly is a developer-focused, file-backed Kanban tracker for the terminal. It keeps Boards, Stories and, with the Tasks Plugin, Tasks as JSON files in a `.rowbly/` Data Root, which is committed with the code, and offers a full-screen TUI plus a command mode for scripts. These skills teach coding agents to operate Rowbly through command mode.

## Domains

| Domain | Description | Skills |
| --- | --- | --- |
| cli-usage | Shared rules for calling `rowbly` from an agent | rowbly-cli |
| data-root-setup | Data Root, Boards, Assignees, Stages, Custom Fields | rowbly-setup |
| work-tracking | Stories and Tasks day to day | rowbly-stories |
| plugins | Turning Built-in Plugins on/off; Epics, Specs, Comments | rowbly-plugins |
| data-integrity | doctor, merges, exit 6 | rowbly-doctor |

## Skill Inventory

| Skill | Type | Domain | What it covers | Failure modes |
| --- | --- | --- | --- | --- |
| rowbly-cli | core | cli-usage | Data Root/Board resolution, `--json`/`--no-prompt`/`--yes`, JSON errors, exit codes, glossary, no hand edits | 4 |
| rowbly-setup | lifecycle | data-root-setup | `init`, `boards`, `assignees`, `whoami`, `use`, `stages`, `fields`, Configuration Cascade levels | 3 |
| rowbly-stories | sub-skill | work-tracking | `stories` and `tasks` verbs, filters, valid values, choosing Stages by Stage Category, the pick-up/finish workflow | 4 |
| rowbly-plugins | sub-skill | plugins | `plugins` verbs, settings, `epics`, `specs`, `comments`, Story options | 3 |
| rowbly-doctor | sub-skill | data-integrity | `doctor`, `--fix`, Story Key conflicts after merges, manual repairs; reference: finding codes | 3 |

`rowbly-setup`, `rowbly-stories`, `rowbly-plugins` and `rowbly-doctor` require `rowbly-cli`, which is the single home of the shared rules (non-interactive flags, exit-code table, resolution, "change data only through commands").

## Failure Mode Inventory

See `domain_map.yaml` for mechanisms and patterns.

| Skill | Mistake | Priority | Source |
| --- | --- | --- | --- |
| rowbly-cli | Omitting `--no-prompt` in a pseudo-terminal | HIGH | README.md#global-flags |
| rowbly-cli | Retrying a deterministic failure unchanged | HIGH | README.md#exit-codes |
| rowbly-cli | Opening the TUI or `$EDITOR` | HIGH | README.md#global-flags |
| rowbly-cli | `--root` at the project folder | MEDIUM | observed; test/skills |
| rowbly-setup | Wrong Configuration Cascade level | HIGH | README.md#configuration-cascade |
| rowbly-setup | `init` under an existing Data Root | HIGH | README.md#data-root-and-git-workflow |
| rowbly-setup | Removing a used Custom Field/option | MEDIUM | README.md#custom-fields |
| rowbly-stories | `--label`/`--assignee` replace the list | HIGH | README.md#stories; test/skills |
| rowbly-stories | Hard-coded Stage keys | HIGH | test/skills |
| rowbly-stories | Non-kebab-case Labels | HIGH | docs/agents/CONTEXT.md |
| rowbly-stories | Predicting the next key | MEDIUM | README.md#stories |
| rowbly-plugins | Story Spec named by slug | HIGH | docs/plugins/built-in.md#specs |
| rowbly-plugins | `--spec` replaces links | HIGH | docs/plugins/built-in.md#specs |
| rowbly-plugins | Disabling a Plugin to silence an error | MEDIUM | docs/plugins/README.md |
| rowbly-doctor | Deleting a Story folder or `.txn/` | CRITICAL | docs/architecture/storage.md |
| rowbly-doctor | Picking one side of a key conflict | HIGH | README.md#doctor |
| rowbly-doctor | Committing before doctor exits 0 | HIGH | README.md#data-root-and-git-workflow |

## Tensions

| Tension | Skills | Agent implication |
| --- | --- | --- |
| Shared configuration vs the request at hand | rowbly-plugins ↔ rowbly-setup | Turning Plugins on or changing Stages/Fields affects the whole team; do it on user intent and report it |
| Local State vs explicit flags | rowbly-cli ↔ rowbly-stories | Pass `--board`; do not change the developer's `local.json` context in scripts |

## Cross-References

| From | To | Reason |
| --- | --- | --- |
| rowbly-stories | rowbly-plugins | `--epic`, `--spec`, Comments extend Story work |
| rowbly-setup | rowbly-doctor | Config changes surface as findings |
| rowbly-cli | rowbly-doctor | Exit 6 routes to doctor |

## Remaining Gaps

| Skill | Question | Status |
| --- | --- | --- |
| rowbly-plugin-authoring (planned, not registered) | Cover writing a Built-in Plugin? | open |
| rowbly-cli | Should agents ever drive the TUI (Plugin Actions are TUI-only)? | open |

## Coverage and batch history

- Registered `rowbly-cli` in `.` (domain `cli-usage`). Developer tasks: Run rowbly commands from an agent or script without hanging on prompts; Interpret rowbly exit codes and JSON errors and recover; Resolve which Data Root and Board a command acts on.

- Registered `rowbly-setup` in `.` (domain `data-root-setup`). Developer tasks: Create a Data Root and first Board in a project; Add Assignees and claim Me; Add, reorder or remove Stages and Custom Fields at the right Configuration Cascade level.

- Registered `rowbly-stories` in `.` (domain `work-tracking`). Developer tasks: Find the Stories to work on and read one in full; Create a Story or Task with valid Assignees, Priority, Labels and Custom Field values; Move a Story or Task through Stages and rank it as work progresses.

- Registered `rowbly-plugins` in `.` (domain `plugins`). Developer tasks: Turn a Built-in Plugin on or off and change its settings; Group Stories into Epics and check Epic Progress; Write Specs and link Stories to Board Specs; Comment on Stories.

- Registered `rowbly-doctor` in `.` (domain `data-integrity`). Developer tasks: Check and repair the Data Root after merging branches; Resolve a Story Key conflict from two branches; Recover when a command exits 6 or a commit was interrupted.

### Batch 1 — operating Rowbly as an agent (2026-10-18, rowbly 0.1.0, base commit 2e488a8)

- **Scope.** The maintainer asked for skills that tell agents how to operate Rowbly, grounded in `docs/`. Assessed: command-mode usage of every core command, the four Built-in Plugins, and doctor. Not assessed: TUI operation, Plugin authoring, development of Rowbly itself (covered by `docs/development/README.md` and `AGENTS.md`).
- **Evidence.** README.md (the user guide and command reference), the reorganized docs (`docs/agents/CONTEXT.md`, `docs/architecture/data-model.md`, `storage.md`, `docs/plugins/README.md`, `built-in.md`), the command sources, and the CLI built from the working tree (`pnpm build`), run in scratch Data Roots. The docs reorganization ran in parallel in another agent thread; skill sources were aligned with its final paths.
- **Decisions.**
  - Agents use command mode only, always with `--no-prompt`, `--json` for read output, and `--yes` only on user-requested deletions (agent shells may be pseudo-terminals, where Rowbly would prompt).
  - Shared rules live only in `rowbly-cli`; the four task skills require it.
  - Skill bodies are self-contained and do not link to repository docs, because the skills are published in the npm package (`files` now lists each skill directory, written by `intent maintainer sync`), where `docs/` does not ship. Docs are tracked through `sources` for staleness review.
  - Choose Stages by Stage Category, never by key; changes to shared configuration (Plugins, Stages, Fields, `--force`) need user intent.
  - The doctor finding-code table is a reference file (`rowbly-doctor/references/finding-codes.md`), mirroring README.md#doctor.
- **Checks.** `intent validate skills`: passed. Executable task checks: `test/skills/agentWorkflows.test.ts` (10 tests, cli project) run each skill's workflow through the built CLI and assert the warned-about mistakes fail (`--label` replacing, Title Case Labels, missing `--yes`, slug vs `--story`, unknown Stage, `--root` at the project folder, merge conflict blocking with exit 6 until `doctor --fix`). Fresh consumer session (general-purpose Claude subagent, no authoring context, only the five skills copied to a scratch folder and `rowbly` on PATH): task "start the password reset story, comment, add a tests Task, add a needs-docs tag, finish both" on a fixture whose Stages are backlog/todo/doing/shipped. It loaded rowbly-cli, rowbly-stories and rowbly-plugins; the grader (stage shipped, labels kept plus needs-docs, Task shipped, one Comment, other Story untouched, doctor exit 0) passed. One recovered failure: Comments was off. A plausible wrong solution (`--label`, `done`) fails the same grader. Its feedback led to: `boards list` in rowbly-stories, a Comments note in the pick-up workflow, and `--json` on Plugin commands. Single run; not a reliability claim. Consumer exposure was a copied skills folder, not an installed package.
- **Remaining work.** The gaps above; a discovery evaluation with held-out should/should-not-load prompts was not run.

### Integration — Tasks and Assignees Plugins (2026-10-19)

- Combined PRs #51 and #52: both Tasks and Assignees are optional Plugins. Core retains Me; Comments belong only to Stories. Task screens and commands show their Story, Stage and text; use the Story for its Assignees. The retired core Task row extension is not retained.
- Both Plugins keep their own storage and doctor findings. Assignees uses ADR-0023; Tasks keeps ADR-0022. CLI skills retain their existing task ownership, with both Plugins enabled explicitly where needed. Board cards combine story badges and card badges.
- Existing executable workflow checks in test/skills/agentWorkflows.test.ts cover the combined CLI. Fresh consumer validation of this combined revision has not been run.

### Behavior change — fixed Backlog and Done Stages (2026-10-19, ADR-0024)

- Stage Categories are now `backlog`, `board` and `done`. Every Board starts with the fixed Stage `backlog` and ends with the fixed Stage `done`; a configured `stages` list holds only `{ key, name }` Stages between them, all in `board`. `stages add`/`edit` lost `--category`; `edit`, `move` and `remove` refuse `backlog` and `done` (exit 2). There is no migration: Rowbly is unreleased, and an old-shape list fails validation.
- Updated guidance: rowbly-setup (default Stages, `stages add` examples, the fixed Stages and their placement flags), rowbly-stories (choosing the start Stage by category `board`, `--category backlog|board|done`, finishing in `done`, the hard-coded-key mistake), rowbly-cli (Stage glossary row), rowbly-plugins (Epic Progress counts the `done` Stage). rowbly-doctor needed no change: `SCHEMA_INVALID` and `UNKNOWN_STAGE` still describe old-shape lists and Stories in removed Stages.
- Superseded decision: "Choose Stages by Stage Category, never by key" from Batch 1 now applies to the configured Stages only. `backlog` and `done` exist on every Board, so moving a Story to `done` by key is correct; the start Stage is still chosen by category (`board`).
- Checks: `test/skills/agentWorkflows.test.ts` updated (the pick-up workflow adds `doing --after backlog` and expects it as the first `board` Stage). The TUI list view added in the same change is outside the assessed scope (TUI operation is not assessed). Fresh consumer validation of this revision has not been run.

### Decision — development skills stay outside Intent (2026-10-19)

- Skills for developing Rowbly, such as `rowbly-screenshots` and the vendored upstream `agentic-tui` skill, live in `.agents/skills/<name>/` with pointers in `.claude/skills/<name>/`. They are not published, not registered with Intent, and not part of this spec's skill tree; their source reviews are recorded as `out-of-scope`. This keeps Batch 1's scope: development of Rowbly itself is covered by `AGENTS.md` and `docs/development/README.md`, not by the Intent skills.
- No guidance in `skills/` changed: the agentic-tui integration adds no command, flag, output, exit code, doctor finding or Data Root behavior.
