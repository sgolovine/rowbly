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
| rowbly-plugins | sub-skill | plugins | `plugins` verbs, settings, `epics`, `specs`, `comments`, `git show/configure`, Story options | 3 |
| rowbly-doctor | sub-skill | data-integrity | `doctor`, `--fix`, Story Key conflicts after merges, manual repairs; reference: finding codes | 3 |

`rowbly-setup`, `rowbly-stories`, `rowbly-plugins` and `rowbly-doctor` require `rowbly-cli`, which is the single home of the shared rules (non-interactive flags, exit-code table, resolution, "change data only through commands").

## Failure Mode Inventory

See `domain_map.yaml` for mechanisms and patterns.

| Skill | Mistake | Priority | Source |
| --- | --- | --- | --- |
| rowbly-cli | Omitting `--no-prompt` in a pseudo-terminal | HIGH | README.md#global-flags |
| rowbly-cli | Retrying a deterministic failure unchanged | HIGH | README.md#exit-codes |
| rowbly-cli | Opening the TUI or `$EDITOR` | HIGH | README.md#global-flags |
| rowbly-cli | `--root` at the project folder | MEDIUM | observed |
| rowbly-setup | Wrong Configuration Cascade level | HIGH | README.md#configuration-cascade |
| rowbly-setup | `init` under an existing Data Root | HIGH | README.md#data-root-and-git-workflow |
| rowbly-setup | Removing a used Custom Field/option | MEDIUM | README.md#custom-fields |
| rowbly-stories | `--label`/`--assignee` replace the list | HIGH | README.md#stories; test/skills |
| rowbly-stories | Hard-coded Stage keys | HIGH | test/skills |
| rowbly-stories | Non-kebab-case Labels | HIGH | docs/agents/CONTEXT.md |
| rowbly-stories | Predicting the next key | MEDIUM | README.md#stories |
| rowbly-plugins | Story Spec named by slug | HIGH | docs/plugins/built-in.md#specs |
| rowbly-plugins | `--spec` replaces links | HIGH | docs/plugins/built-in.md#specs |
| rowbly-plugins | Second Story Spec without a slug | MEDIUM | docs/plugins/built-in.md#specs |
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

### Behavior change — Git Automatic Commits (2026-10-19, ADR-0026)

- Source baseline: origin/main `0dacc4133030a1bb86b32751e2e2b21c304ca0f0`, package 0.1.0; implementation checkpoint `c76e5ec`. Added Git to rowbly-plugins task coverage and activation text, preserving its original purpose. No new skill is needed: enabling/configuring Built-in Plugins remains one developer task. Added a conditional pause/restore step to rowbly-doctor so saved repair passes do not bypass its inspect-before-commit workflow. CLI, setup and Stories guidance otherwise remains accurate; warnings leave saved changes intact and the existing PLUGIN_FAILED guidance covers load failure.
- Maintainer decisions: no background daemon; TUI timers and next-run resumption for CLI changes. Author/frequency preferences are personal Local State, while enabling Git remains shared. Commit affected Rowbly-managed paths, preserve unrelated staging, refuse affected staged paths, and suppress hooks/signing. Branching and hook installation remain planned in ADR-0016.
- Updated domain_map.yaml task/coverage and skill_tree.yaml source/activation metadata; prior tasks and open gaps are retained. Git behavior and validation are covered by test/plugins/git.test.ts, gitCli.test.ts and gitTui.test.tsx; the CLI workflow is the representative executable skill task.
- Discovery probes: should load for “Have Rowbly commit my board edits every ten minutes with my bot email”; should not load for “Configure git's signing key for this code repository”. Consumer/discovery outcomes and final checks are recorded in the revision-bound Intent review; structural validation alone is not consumer evidence.

- Completed checks: typecheck and lint passed; unit 102 files / 986 tests and CLI 22 files / 158 tests passed. Intent validated all five skills. A fresh gpt-6.1-sol consumer completed the task in test/skills/cases/git-automation.md using a copied built CLI and skills; checkGitConsumer.mjs passed and rejected an after-each-change negative control. The consumer reported loading rowbly-cli, rowbly-plugins and rowbly-stories. Normal Intent-installed discovery and the negative activation probe remain unverified; exposure was a supplied catalog, not an installed package. This is one successful task run, not a reliability claim.

- Doctor guidance uses the same disable/resume path exercised by the Git interval regression and existing doctor pass tests; a fresh consumer run of the doctor-specific repair workflow was not performed.
- Intent 0.5.5 review/check for this batch uses the actual PR base `0dacc4133030a1bb86b32751e2e2b21c304ca0f0`. Recording an explicit-base report retains the pre-existing default baseline `2e488a8f01b2cc5f4a77c72d33337d067f2c9445` in this installed version; combining `--record` and `--base` is refused. The default check still reports 34 historical ADR relocation items outside this task. Do not mark those unrelated changes reviewed solely to clear the default check; use the actual PR base for this batch's completion gate.

### Behavior change — many Story Specs and the full-screen editor (2026-10-19, ADR-0025)

- A Story can have any number of Story Specs, each `stories/<KEY>/plugins/specs/<slug>.md`. `spec.md` is the Story Spec `spec`, so existing data is read unchanged. `specs list --story <KEY>` lists them; `create|show|edit|delete [slug] --story <KEY>` take an optional slug that defaults to `spec`, and `--story` with `--board` exits 2. Spec results are `{ slug, title, text }` for both kinds (they were `{ title, text }` for a Story Spec).
- Updated guidance: rowbly-plugins (Story Spec definition, `specs list --story`, named Story Specs, the result shape, a new MEDIUM mistake: a second Story Spec without a slug exits 4). The HIGH "Story Spec named by slug" mistake keeps its correct pattern and adds the slug-after-verb form.
- No change: rowbly-cli, rowbly-setup, rowbly-stories and rowbly-doctor. Their tracked sources changed only in the TUI section of README.md (the full-screen editor's view and edit modes, list clicks) and the Plugin-folder comment in `docs/architecture/data-model.md`; TUI operation is outside the assessed scope, and they say nothing about Story Specs.
- Checks: `intent validate skills` passed; `test/skills/agentWorkflows.test.ts` now creates a second, named Story Spec, lists both and asserts the slug-less second create exits 4. The fresh consumer result is recorded in the review evidence for this revision.

### Decision — development skills stay outside Intent (2026-10-19)

- Skills for developing Rowbly, such as `rowbly-screenshots` and the vendored upstream `agentic-tui` skill, live in `.agents/skills/<name>/` with pointers in `.claude/skills/<name>/`. They are not published, not registered with Intent, and not part of this spec's skill tree; their source reviews are recorded as `out-of-scope`. This keeps Batch 1's scope: development of Rowbly itself is covered by `AGENTS.md` and `docs/development/README.md`, not by the Intent skills.
- No guidance in `skills/` changed: the agentic-tui integration adds no command, flag, output, exit code, doctor finding or Data Root behavior.

### Merge review — Git decision numbering (2026-10-19)

- The maintainer approved assigning the Git decision ADR-0026 because concurrent PR #58 introduces ADR-0025 for Specs. Updated the Git decision, index, amendment status lines and documentation references together; no decision or section content changed.
- Preserved the development-skill scope decision from PR #59 and Git task coverage in domain_map.yaml and skill_tree.yaml. Added Git to the Built-in Plugins overview table; CLI guidance remains accurate.
### Decision — task checks cover HIGH and CRITICAL failure modes only (2026-10-19, ADR-0027)

- The repository cut its test suite to the tests ADR-0027 requires. `test/skills/agentWorkflows.test.ts` keeps one check per skill workflow that covers a failure mode rated HIGH or CRITICAL above: rowbly-cli (prompts, exit codes and JSON errors), rowbly-setup (Configuration Cascade level; a second Data Root and a clashing prefix), rowbly-stories (picking up by Stage Category; `--add-label` against `--label` and Title Case Labels), rowbly-plugins (Epics, Specs and Comments as documented) and rowbly-doctor (a merge conflict blocks with exit 6 until `doctor --fix`).
- Removed checks, which covered MEDIUM failure modes or claims a kept check already covers: `--root` at the project folder and the Board context (rowbly-cli), `--description-file -` and the valid handles of an unknown Assignee (rowbly-stories), and a Story in a removed Stage (rowbly-doctor). Their guidance is unchanged and still sourced from README.md and the observed CLI.
- No guidance in `skills/` changed: no command, flag, output, exit code, doctor finding or Data Root behavior changed. `test/commands/doctor.test.ts`, cited for the key conflict repair, was removed; the rowbly-doctor task check covers that repair.

- PR #62 conflict resolution: the maintainer approved assigning the test-policy decision ADR-0027 because main already uses ADR-0025 for Story Specs and ADR-0026 for Git. Preserved both branches' planning history and main's Git/Specs guidance. Kept the deterministic refused-upward-move regression from main and its Git terminology exceptions in the language audit. Checks on the merged tree: typecheck and lint passed; unit 21 files / 65 tests and CLI 4 files / 20 tests passed; all five skills validated. No new consumer session was run because operating guidance is unchanged.

### Behavior change — Epic names on board cards (2026-10-19, ADR-0028)

- Source baseline: origin/main `3a64cef617d80a276c3348d20505fe658d37e8db`, package 0.1.0. The Plugin API gains `PluginTui.loadStoryBadges`, and the Epics Plugin uses it to show `◆ <Epic name>` on a Story's board card, its line in the board's list view and its row in the Stories list (the Epic ID when the Epic file is missing or cannot be read).
- No guidance in `skills/` changed: the change is TUI-only and Plugin-authoring-only, both outside the assessed scope (§Scope). No command, flag, output, exit code, doctor finding or Data Root behavior changed. rowbly-plugins and rowbly-doctor track `docs/plugins/built-in.md`, whose only change is the Epics TUI line. domain_map.yaml and skill_tree.yaml are unchanged: no task, source mapping or activation text changed.
- Checks: typecheck and lint passed; unit 21 files / 65 tests and CLI 4 files / 20 tests passed; `intent validate skills` passed for all five skills. The TUI was verified by rendering the board's Stages and list views and the Stories list over a Data Root with Epics on. ADR-0027 §1 requires no new test. No consumer session was run because operating guidance is unchanged.

### Behavior change — Plugin Sidebars and the Epics sidebar (2026-10-19, ADR-0029)

- Source baseline: PR #63 head `0e7b449db5d785e3f6255269060126ea67600e97` (stacked on it), package 0.1.0. The Plugin API gains `PluginTui.sidebar`; the TUI shows a Plugin Sidebar beside the Board sidebar with a header button, `\` and `{`/`}` (new core keys), and a pick filters the board by the Plugin's Story filter. The Epics Plugin lists its open Epics there after All Epics, with a + New Epic button.
- No guidance in `skills/` changed: the change is TUI-only and Plugin-authoring-only, both outside the assessed scope (§Scope). No command, flag, output, exit code, doctor finding or Data Root behavior changed. README changes are the TUI section and its keys table; `docs/agents/CONTEXT.md` gains the Plugin Sidebar term, which no skill uses; `docs/plugins/built-in.md` changes only the Epics TUI line. domain_map.yaml and skill_tree.yaml are unchanged: no task, source mapping or activation text changed.
- Checks: typecheck and lint passed; unit 21 files / 65 tests and CLI 4 files / 20 tests passed; `intent validate skills` passed for all five skills. The TUI was verified with agentic-tui against the demo Data Root with Epics on: toggling, `{`/`}`, clicks on an Epic, All Epics and + New Epic, in both board views. ADR-0027 §1 requires no new test. No consumer session was run because operating guidance is unchanged.
