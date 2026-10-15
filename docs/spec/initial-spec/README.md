# Rowbly v1 — Build Spec

This folder is the single source of truth for building Rowbly v1 with a **supervisor + fleet of worker agents** running in T3 Code. It supersedes `docs/ARCHITECTURE.md`, `docs/CORE_CONCEPTS.md` and `docs/TECHNICAL_DETAILS.md` wherever they disagree.

| File | Audience | Purpose |
| --- | --- | --- |
| [README.md](README.md) | everyone | Product summary, architecture, work-package graph |
| [contracts.md](contracts.md) | everyone | Frozen data layout, schemas, CLI surface, service interfaces, exit codes |
| [supervisor.md](supervisor.md) | supervisor | Runbook: dispatch, review, merge, checkpoints |
| [worker.md](worker.md) | workers | Rules of engagement and Definition of Done |
| [packages/](packages/) | one worker each | Work packages WP00–WP11 (WP12 was briefed by the supervisor directly) |

Also binding: [`/CONTEXT.md`](../../CONTEXT.md) (glossary — use its terms exactly, never the `_Avoid_` words) and [`docs/adr/`](../adr/) (decisions — do not reverse without the user).

## 1. Product summary

Rowbly is a developer-focused, file-backed Kanban tracker.

- **Two entrypoints, full parity.** `rowbly` with no arguments opens a full-screen Ink TUI. `rowbly <noun> <verb> …` runs one command and exits. Every CRUD capability exists in both.
- **Files are the database.** All data is pretty-printed JSON under a `.rowbly/` Data Root, validated with zod (ADR-0001). Small pods share it by committing it to git, so writes touch as few files as possible.
- **Data Root discovery** walks up from cwd for `.rowbly/`, falling back to `~/.rowbly`; `--root` / `ROWBLY_ROOT` override (ADR-0002).
- **Hierarchy:** Workspace → Boards → Stories → Tasks. Epics live in a Workspace and group Stories across its Boards (link held on the Story, ADR-0004). Assignees are a per-Workspace roster.
- **Stories** are keyed `WEB-42` (board prefix + max+1, ADR-0003), never move between Boards, sit in one Stage with a manual Rank, and carry: name, description (markdown), assignees, epic, Priority (`P0`–`P4`), Labels, due date, Custom Field values, createdBy, timestamps, embedded Tasks and Comments.
- **Tasks** (`WEB-42.1`) are mini-stories embedded in the Story file: name, description, Stage, Comments. No assignees of their own — they belong to the Story's Assignees.
- **Stages and Custom Fields** are configuration, resolved through the Configuration Cascade `rowbly.config.json` → `workspace.config.json` → `board.config.json`; most specific defined list replaces (ADR-0005). Every Stage has a Stage Category (`todo | in_progress | done`).
- **Out of scope for v1:** authentication/authorization, any server, SQLite, npm publishing (install via `pnpm add -g "$PWD"` / `npm i -g .`), creating the GitHub remote (the user manages it), moving Stories between Boards.

## 2. Tech stack (fixed)

Node 22 LTS · pnpm · TypeScript (strict, ESM) · tsup (single ESM bin `dist/cli.js`) · vitest · Biome (lint + format) · zod · `fs/promises` · commander · `@clack/prompts` (command-mode prompting only, ADR-0006) · ink + react · `ink-testing-library` · picocolors · cli-table3 · `fractional-indexing` (Rank) · `nanoid` (Comment ids).

Adding any other runtime dependency requires supervisor approval recorded in the PR description.

## 3. Architecture

Strict downward-only layering. A layer may import only from layers below it.

```text
src/
  cli.ts                 # bin entry: no args + TTY → TUI, else commander
  core/                  # shared, dependency-free: errors, exit codes, keys, rank, slug, time, ids
  schemas/               # zod schemas + inferred types (the data contract)
  storage/               # Storage & Configuration Layer: Data Root, paths, json store, repositories, cascade, local state
  services/              # Service Layer: business rules; consumes storage only; returns plain data, never prints
  commands/              # Command Layer (commander): parse → service → output/render
  output/                # table/json/plain renderers, color helpers
  tui/                   # Ink app: shell, router, primitives, screens/<area>/
test/
  helpers/               # temp Data Root fixture, runCli(), fixture builders
```

Rules:

1. `services/` never touches `fs` directly and never prints; it throws `RowblyError` subclasses (see contracts §6).
2. `commands/` and `tui/` both call the **same** service functions — parity is achieved by sharing services, never by duplicating rules.
3. Every write goes through `storage/jsonStore` (validate → atomic temp-file + rename → stable key order, 2-space indent, trailing newline).
4. Services receive a `RowblyContext` (resolved Data Root + Local State + clock) instead of reading globals, so tests inject temp roots and fixed clocks.

## 4. Work-package graph

```text
Phase 0   WP00 Scaffold & Contracts
              │
Phase 1   ┌───┴────────────────┐
          WP01 Storage &        WP02 TUI Foundation
          Config Layer
              │                       │
          ══ CHECKPOINT A: user reviews frozen contracts ══
              │
Phase 2   WP03 Workspaces & Assignees ─┐
          WP04 Boards, Stages & Fields ─┼─► WP08 Setup & Context (needs 03, 04)
          WP04 ─► WP05 Stories ─► WP06 Tasks & Comments
          WP07 Epics
              │
Phase 3   WP09 Kanban Board View (needs 05)
          WP10 Doctor (needs 05, 06, 07)
          ══ CHECKPOINT B: user reviews the TUI ══
              │
Phase 4   WP11 Hardening & Docs (needs all)
```

| WP | Title | Depends on | Phase | Status |
| --- | --- | --- | --- | --- |
| [WP00](packages/WP00-scaffold-and-contracts.md) | Scaffold & Contracts | — | 0 | merged (#1) |
| [WP01](packages/WP01-storage-and-config.md) | Storage & Config Layer | WP00 | 1 | merged (#2) |
| [WP02](packages/WP02-tui-foundation.md) | TUI Foundation | WP00 | 1 | merged (#3) |
| [WP03](packages/WP03-workspaces-and-assignees.md) | Workspaces & Assignees | WP01, WP02 | 2 | merged (#6) |
| [WP04](packages/WP04-boards-stages-fields.md) | Boards, Stages & Custom Fields | WP01, WP02 | 2 | merged (#7) |
| [WP05](packages/WP05-stories.md) | Stories | WP04 | 2 | merged (#9) |
| [WP06](packages/WP06-tasks-and-comments.md) | Tasks & Comments | WP05 | 2 | merged (#10) |
| [WP07](packages/WP07-epics.md) | Epics | WP01, WP02 | 2 | merged (#5) |
| [WP08](packages/WP08-setup-and-context.md) | Setup & Context | WP03, WP04 | 2 | merged (#8) |
| [WP09](packages/WP09-kanban-board-view.md) | Kanban Board View | WP05 | 3 | merged (#11) |
| [WP10](packages/WP10-doctor.md) | Doctor | WP05, WP06, WP07 | 3 | merged (#12) |
| [WP11](packages/WP11-hardening-and-docs.md) | Hardening & Docs | all | 4 | merged (#13) |
| WP12 (no package file; supervisor brief) | TUI Parity Gaps: closes G1–G7 from the WP11 parity audit | WP11 | 4 | in review |

Phase numbers are for humans; the supervisor schedules strictly by the **Depends on** column, max 5 workers at once, and pauses at the two checkpoints.

## 5. Global Definition of Done

Every package PR must, before the supervisor merges it:

1. `pnpm typecheck` passes (`tsc --noEmit`, strict).
2. `pnpm lint` passes (Biome, no warnings suppressed without a comment explaining why).
3. `pnpm test` passes: vitest unit tests for storage/services using a temp-dir Data Root; command integration tests running the built CLI (`runCli`) against a temp Data Root; TUI tests with `ink-testing-library` for every screen added.
4. Every package's own acceptance criteria are checked off in the PR description.
5. User-facing docs updated: `README.md` command reference and `--help` text for every command added.
6. No edits to frozen contracts (`src/schemas/`, `src/services/types.ts`, `src/core/errors.ts`, `contracts.md`) unless the supervisor approved a **contract change request** (see supervisor.md §5).
