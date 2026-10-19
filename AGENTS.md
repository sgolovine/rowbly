<!-- intent-maintainer:start -->
## Library Skill Maintenance

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before substantial library source, documentation, examples, tests, or skill work, run `pnpm exec intent meta generate-skill` and follow the packaged maintainer procedure.
Use the current request and repository evidence. For initial skills, propose a useful batch and reuse any scope already agreed with the maintainer.
Before handing off a skill batch or library change, run `pnpm exec intent maintainer review --json`. Follow the maintainer procedure to update affected guidance, run task checks, and record completed review outcomes. Report an evidence-backed no-op or missing evidence explicitly.
Create and incrementally maintain domain_map.yaml, skill_spec.md, and skill_tree.yaml in the established artifact location for every skill batch. Preserve prior tasks, maintainer decisions, and remaining work.
Keep maintainer decisions and changes in the repository; do not require the user to repeat the procedure in later sessions.
Use intent maintainer setup to initialize missing records, maintainer add to register skills, maintainer status to identify work, and maintainer sync to update generated metadata. Finish with intent maintainer check.
<!-- intent-maintainer:end -->

# Agent guide

Rowbly is a file-backed Kanban tracker for the terminal: a CLI (`rowbly <noun> <verb>`) and an Ink TUI
(`rowbly`) over JSON and Markdown files in a `.rowbly/` Data Root. `README.md` is the user guide;
`docs/` explains how it is built. Start at `docs/README.md`.

## Documentation map

| Topic | Where |
| --- | --- |
| Domain language | `docs/agents/CONTEXT.md` (core), `docs/agents/CONTEXT-MAP.md` (links each Plugin's `src/plugins/<id>/CONTEXT.md`) |
| Goals, surfaces, technology, source layers | `docs/architecture/overview.md` |
| Data Root layout, records, Configuration Cascade, doctor | `docs/architecture/data-model.md` |
| The operation pipeline and every operation's input and result | `docs/architecture/operations.md` |
| The Data Root lock, commit journal and recovery | `docs/architecture/storage.md` |
| The plugin system; the Built-in Plugins | `docs/plugins/README.md`; `docs/plugins/built-in.md` |
| Writing a Plugin; the Plugin API reference | `docs/plugins/writing-a-plugin.md`; `docs/plugins/api.md` |
| Plugin versions, data formats and migrations; trust model | `docs/plugins/compatibility.md`; `docs/plugins/trust.md` |
| Commands, test projects, helpers, tracing, CI | `docs/development/README.md` |
| Decisions | `docs/agents/adr/README.md` (index) and `docs/agents/adr/NNNN-*.md` |
| Commands, flags, keys, doctor findings, exit codes (user facing) | `README.md` |
| Agent skills for operating Rowbly (CLI, TUI, Data Root, doctor, Plugins) | `skills/<name>/SKILL.md`, with planning records in `skills/_artifacts/` (maintained with Intent; see Library Skill Maintenance above) |

## Domain language and decisions

- Use the glossary terms exactly, in code, messages, help text and docs. Never use an `_Avoid_` word in
  user-facing text: `test/e2e/language.test.ts` checks the source and help pages.
- Core never uses a Plugin's terms; a Plugin uses core terms and its own.
- Do not reverse an accepted ADR without the user. To change a decision, add a new ADR that supersedes or
  amends it and update the old one's **Status** line. Source comments cite ADRs by number and section
  (`ADR-0019 §2`); never renumber an ADR or its sections.
- **ADRs live only in `docs/agents/adr/`.** Any skill or workflow that records an ADR (for example
  `grill-with-docs`) must save it there, never in `docs/adr/`, the repository root or a skill's own
  folder. Name it `NNNN-<kebab-case-title>.md` with the next free number, follow the format in
  `docs/agents/adr/README.md`, and add a row to that index in the same change.
- Older source comments cite IDs such as `RES-02`, `CQ-155` or `WP09`. They refer to a review that has been
  removed from `docs/` (it is in git history). Do not add new ones; cite an ADR or a docs page instead.

## Keeping the docs current

Update the page that describes a behavior in the same change as the behavior:

- A new or changed operation, or a change to its input or result: `docs/architecture/operations.md`.
  `test/plugins/operationInventory.test.ts` parses its tables, so keep their headings and row format.
- A change to the Plugin API: `docs/plugins/api.md`, and the tutorial if a step changes. Every `ts`/`tsx`
  block in those two pages must be a `// #region` of a compiled fixture in `test/docs/fixtures/`
  (`test/docs/tutorial.test.ts`); change the fixture and the page together.
- A new Built-in Plugin: follow the checklist in `docs/plugins/writing-a-plugin.md` §12 (its
  `CONTEXT.md` linked from `docs/agents/CONTEXT-MAP.md`, its section in `docs/plugins/built-in.md`, its
  operations in `docs/architecture/operations.md`).
- Storage, locking or doctor behavior: `docs/architecture/storage.md` or `data-model.md`.
- Anything a user sees (commands, flags, TUI keys, doctor codes, exit codes): `README.md`.
- Describe what is built; mark anything planned as planned. Do not add work plans, specs or review
  reports to `docs/`.

## TUI code organization (`src/tui/`)

- **One component per file.** Each React component lives in its own `PascalCase.tsx` file named after
  the component. Don't add new components to an existing file, and split a file when it starts holding
  several. A small private helper that only that component uses (a constant, a pure function) may stay
  in the same file.
- **Group by area, with a barrel.** Components are grouped in folders, each with an `index.ts` that
  re-exports what the rest of the app uses. Import from the folder (`'../components'`), not from files
  inside another folder.
  - `components/` — reusable UI building blocks (`Modal`, `SelectList`, `Form`, …).
  - `shell/` — the app frame: `Shell`, `Header`, `Sidebar`, `Footer`, toasts, overlays, `ScreenSlot`.
  - `screens/<area>/` — screens and their screen-specific pieces, registered in the area's `index.ts`.
  - `hooks/` — contexts and hooks.
- **Keep `app.tsx` thin.** It only wires providers around `Shell`. New layout or chrome goes in
  `shell/`; new screens go in `screens/`.
- Pure helpers and constants shared between files get their own `camelCase.ts` file (e.g.
  `shell/layout.ts`, `shell/boardKey.ts`).

## Tests

- Tests are split into two Vitest projects (`vitest.config.ts`), run as separate CI jobs:
  - `pnpm test:unit` — every suite that needs no build (core, storage, services, TUI, Plugins). Fast;
    run it while you work.
  - `pnpm test:cli` — every suite that mentions `runCli`, `CLI_PATH` or `FIXTURE_CLI_PATH`. Its global
    setup builds the CLIs from source first, so it is slower. Run it when you touch commands, output,
    exit codes, the CLI wiring or anything a command reaches.
  - `pnpm test` runs both, as `pnpm test:unit && pnpm test:cli` would.
- A suite's project follows from its text: referencing `runCli` or a CLI path puts it in `cli`. Keep
  in-process tests out of files that spawn the CLI, so the `unit` job stays fast.
- A test that fails in CI but passes locally is a race in the test or the code, not noise. Find the
  window from the last frame in the CI log, reproduce it deterministically with a barrier (for example
  a held Data Root lock, as in `test/plugins/specsTuiStates.test.tsx`), fix it, and keep that test as
  the regression. Never re-run CI until it passes, add retries, or raise timeouts to hide it.

## Async tests

- Synchronize on the state the **next action needs**. In TUI tests, use `waitForFrame` to wait for
  the destination screen's loaded data and relevant action before sending another key. Exclude an
  outgoing form when its text could also satisfy the matcher.
- A success toast or a saved file proves a mutation completed; it does not prove a returning screen
  finished reloading. For example, after adding a Comment, wait for its body and `edit Comment` on
  the Comments tab before pressing `e`, rather than waiting only for `Added Comment`.
- `app.press()` only paces keyboard input. Fixed sleeps, repeated key presses, retries, and larger
  timeouts are not substitutes for a readiness assertion. Use controlled promises/barriers to
  exercise delayed loads and ordering races deterministically; release them and restore mocks in
  `finally` so failures cannot leave work blocked.
- A screen or tab that reloads on return (`useReloadOnReturn`) keeps its loaded data on screen and its
  keys working while it reloads: show `<Loading />` only when there is no data yet, and do not gate
  `useInput` on `loading`. A Story tab can reload twice on return (its own reload, then again when the
  Story screen's reload passes a new `story`), so a key gated on `loading` can be dropped between the
  two loads even after the test saw the frame it waited for. Gate key hints and input on the same
  condition, so a hint in the footer means its key is accepted.

## Checks

Run `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` and `pnpm test:cli` before finishing, and report
each result. All four run in CI on every pull request and push to `main`; do not merge while any of
them fails.
