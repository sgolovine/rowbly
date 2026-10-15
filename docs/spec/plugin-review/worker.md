# Worker guide

You implement exactly one package in your own worktree and branch, then open one PR.

## 1. Before coding

1. Read these files: `docs/spec/plugin-review/README.md`, `contracts.md`, your package file, `AGENTS.md`, `docs/agents/CONTEXT.md`, `docs/agents/CONTEXT-MAP.md`, and every ADR in `docs/adr/`, including the ADRs WP00 added.
2. **Read every review entry linked from your package's findings table.** The detailed entry holds:
   - the evidence and source locations;
   - the recommended change, often narrowed under "see scope" or "correction";
   - the acceptance criteria;
   - the reproduction.

   When the package file and the review entry disagree, the package file and contracts.md win.
3. Run `pnpm install && pnpm test` on your base so you know the starting state is green. Record the test count.
4. Locate every cited source line in the **current** code. The line numbers refer to review commit `5b3acd4`, and earlier packages may have moved things. If a finding's trigger no longer exists, because an earlier package already fixed it, verify that with a test and mark the row `done (fixed by <WPxx>)`.

## 2. While coding

- **Proportionality.** Implement the smallest change that satisfies the finding's acceptance criteria and the contracts. Do not build anything in [contracts.md §11](contracts.md#11-not-adopted--do-not-build). Do not implement a finding just because it has an ID; verify its trigger.
- **Tests first for defects.** For each P0 or P1 defect:
  1. Write the regression test.
  2. Watch it fail on the base.
  3. Fix the defect.

  Cover failure paths: injected I/O errors, rejecting guards, throwing callbacks, interrupted processes. Don't stop at happy paths. Use barriers or promises, never sleeps, for ordering.
- **Fixtures.** Use the temp Data Root helpers. Use a fixed clock and ID generator. Preserve unknown and disabled plugin bags in fixtures. Use more than one plugin wherever ordering or isolation matters.
- **Layering.**
  - Services never print.
  - Only storage touches `fs`.
  - Commands and screens call services.
  - Core never imports a built-in plugin.
  - Built-in plugins import only the plugin API.
- **TUI organization (AGENTS.md).**
  - One component per PascalCase file.
  - Area barrels; import across areas through the barrel.
  - Pure shared helpers go in camelCase files.
  - `app.tsx` stays thin.
- **Language.** Use `docs/agents/CONTEXT.md` terms (and the plugin's own `CONTEXT.md`) in identifiers, messages, help text, and tests. Never use an `_Avoid_` word.
- **Commits.** Small Conventional Commits, for example `fix(change-set): …` or `test(doctor): …`. Push regularly. Avoid repository-wide formatting or renames.
- **Dependencies.** No new runtime dependency without supervisor approval, recorded in the PR.

## 3. File ownership

You may change:

1. files under **Owns** in your package;
2. files under **May touch** in your package, only for the purpose stated there;
3. **consumer compile fixes** under [contracts.md §8.2](contracts.md#8-shared-file-ownership-and-sequencing). These are minimal mechanical edits that keep the build compiling after your signature change. List them in the PR;
4. new test files, plus new helper functions added to shared test helpers (do not change existing helpers you don't own);
5. your own rows in `docs/spec/plugin-review/findings.md`.

Restricted files need a CCR (§4):

- `types.ts` and the API barrels, unless your package holds a type grant;
- `docs/PLUGINS.md`, `docs/ARCHITECTURE.md`, glossaries, and existing ADRs, unless you are WP09A, WP09B, or WP10A;
- any file another running package owns.

For documentation changes, write a **Docs handoff** section in your PR body instead. It should name the doc and section and state the exact new behavior.

## 4. Contract Change Request (CCR)

If you can't finish without changing a file you don't own, stop that part and post this in your thread:

```text
CCR: <file / contract section> — <exact proposed change>
Why: <what fails without it>
Affects: <other packages>
```

Keep working on the parts the CCR doesn't affect while you wait for the supervisor's answer.

## 5. Finding status protocol

Your package file's findings table lists your rows. These rows also appear in [findings.md](findings.md). In your PR, change each of your rows' **Status** cell in `findings.md` to one of:

| Status | Use when |
| --- | --- |
| `done — <test file or short note>` | Implemented and covered. |
| `done (fixed by WPxx)` | An earlier package already fixed it, and you verified that. |
| `deferred: <reason>` | Optional, conditional, or decision-gated, and the condition doesn't hold. Quote the condition. P0 and P1 rows may not be deferred without the user's agreement, which the supervisor asks for. |
| `withdrawn` / `merged → <ID>` | Already set. Leave it unchanged and do not implement it. |

Never leave a row of your own as `open`.

## 6. Definition of Done

1. `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` pass on your branch, rebased onto the latest `origin/main`.
2. Every acceptance criterion in your package file is met.
3. Your findings rows are updated (§5).
4. You opened a PR against `main` titled `<WPxx>: <title>`. Its body contains:
   - **Summary.**
   - **Acceptance checklist**, with every box checked.
   - **Findings:** each ID with its final status and test.
   - **Reproductions rerun**, for P0 and P1 packages: which scripts, and before/after output.
   - **Consumer compile fixes**: files outside Owns that you touched, and why.
   - **Docs handoff**, if behavior described in the docs changed.
   - **Deviations / follow-ups.**
   - **Test commands run** and the test count before and after.

   Link the PR with `link_pull_request`, then report the URL in your thread.
5. Fix every review finding the supervisor sends as a new commit, not a force-push, and reply when done. If asked to rebase, rebase and run `git push --force-with-lease`.
