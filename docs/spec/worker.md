# Worker Guide

You implement exactly one work package in your own worktree and branch, then open one PR.

## 1. Before coding

1. Read these files: `docs/spec/README.md`, `docs/spec/contracts.md`, `CONTEXT.md`, `docs/adr/*`, and your package file in `docs/spec/packages/`.
2. Run `pnpm install && pnpm test` on your base so you know the starting state is green. WP00 is the exception, because it creates the toolchain.
3. Read the existing code your package builds on. Match its patterns and naming.

## 2. While coding

- **Language.** Use the terms in `CONTEXT.md` exactly, in identifiers, help text, error messages and tests. Never use a word from an `_Avoid_` list.
- **Layering.** The architecture rules in README §3 are mandatory. Commands and TUI screens call services. Services call storage. Only storage touches `fs`.
- **No business logic in commands or screens.** If you find yourself writing a rule twice, put it in the service.
- **Tests.** Write them as you go:
  - Use the temp Data Root fixture (`test/helpers`) for every test that touches files.
  - Use a fixed clock and a fixed id generator for deterministic snapshots.
  - Run every command scenario in your acceptance criteria through `runCli`.
  - Add an `ink-testing-library` test for every TUI screen you add.
- **Commits.** Make small Conventional Commits (`feat(stories): …`, `test(stories): …`) and push regularly.
- **Dependencies.** Do not add a runtime dependency unless the README §2 stack lists it. If you need one, ask in your thread first.
- **Simplicity.** Do the simplest thing that meets the acceptance criteria. Don't build speculative abstractions or options nobody asked for.

## 3. File ownership

You may only change:

1. the files and folders listed under **Owns** in your package, and
2. your own section of these shared registries, which WP00 pre-creates so that packages never edit the same lines:
   - `src/commands/index.ts`: one import and registration line per area, already present and pointing at your stub file. Normally you do not need to edit this file at all.
   - `src/tui/screens/index.ts`: same as above, for screens.
   - `README.md`: only the text between `<!-- BEGIN <area> -->` and `<!-- END <area> -->` for your area.
   - `test/helpers/fixtures.ts`: you may add new builder functions. Do not change existing ones.

Frozen contract files (`src/schemas/**`, `src/services/types.ts`, `src/core/errors.ts`, `docs/spec/contracts.md`, `CONTEXT.md`, `docs/adr/**`) need an approved CCR (§4) before you change them.

## 4. Contract Change Request

If you can't finish your package without changing a frozen file, stop work on that part and post this in your thread:

```text
CCR: <file> — <exact proposed change>
Why: <what fails without it>
Affects: <other WPs>
```

Then wait for the supervisor's answer. While you wait, keep working on the parts the CCR doesn't affect.

## 5. Definition of Done

1. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` all pass on your branch, rebased onto the latest `origin/main`.
2. Every acceptance criterion in your package file is met.
3. `--help` text exists for every command you added. Your README section is updated.
4. You opened the PR against `main`, titled `WPxx: <title>`. Its body contains:
   - a summary,
   - the acceptance-criteria checklist with every box checked,
   - the test commands you ran,
   - any deviations or follow-ups.

   Link the PR with `link_pull_request`, then report the URL in your thread.
5. Fix every review finding the supervisor sends with a new commit, not a force-push, and reply when you're done. If the supervisor asks you to rebase, rebase and force-push with lease.
