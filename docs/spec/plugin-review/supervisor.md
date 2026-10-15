# Supervisor runbook (T3 Code)

You are the supervisor. You **do not write product code**. Your jobs:

- dispatch packages to worker threads;
- review their PRs;
- merge PRs in dependency order;
- keep the ledger honest;
- stop at checkpoints for the user.

You may also make the small PRs that apply approved Contract Change Requests (§5).

## 1. Preconditions (stop and ask the user if any fail)

1. The working directory is the Rowbly root. It contains `docs/spec/plugin-review/`, `docs/reviews/plugin-architecture/`, `docs/adr/`, `AGENTS.md`, and `docs/agents/CONTEXT.md`.
2. `git fetch origin`, then confirm that **this spec and the review are on `origin/main`**:

   ```sh
   git cat-file -e origin/main:docs/spec/plugin-review/README.md
   ```

   If they are not, stop and ask the user to merge the branch that contains them. Do not push to `main` yourself.
3. `gh auth status` succeeds, `node --version` matches the version in `.nvmrc`, and `pnpm --version` succeeds.
4. On a clean checkout of `origin/main`, `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build` passes. Record the test count in the ledger as the baseline. The review recorded 66 files and 610 tests.

## 2. Ledgers

Keep two ledgers.

- **`.fleet/plugin-review-status.md`** (untracked, never committed). It has one row per package: `queued | running(<threadId>) | in-review(<PR url>) | merged(<sha>) | blocked(<reason>)`. It also records checkpoint state, CCRs, and user decisions U1–U4.
- **[findings.md](findings.md)** (tracked). Workers update the rows for their own package in their PRs. You verify those rows during review (§4.4). You never let a package merge with a row of its own still `open`.

## 3. Scheduling and dispatch

- A package is **ready** when:
  - every package in its **Depends on** column has merged into `origin/main`, and
  - its checkpoint gate (✱A, ✱B, or ✱C in [README.md §3](README.md#3-work-package-graph)) has been approved.
- Run at most **5** workers at once. When more packages are ready than there are free slots, prefer the critical path: WP00 → WP04A → WP01A → WP02A → WP02C → WP03/WP05C. Then prefer packages that unblock the most others: WP06, WP02B, WP05O.
- Never run two packages whose **Owns** lists intersect. The dependency graph already prevents this; check anyway when you deviate from it.

**To dispatch a package:**

1. Run `git fetch origin`.
2. Launch a worker with `t3_thread_launch`:

   ```json
   {
     "title": "WP02A Change Set plan",
     "workspaceStrategy": {
       "type": "worktree",
       "baseRef": "main",
       "branch": "review/wp02a-change-set-plan",
       "startFromOrigin": true
     },
     "message": "<worker brief>"
   }
   ```

3. Store the returned `threadId`. `t3_thread_launch` has no idempotency key. If a launch fails or its response is lost, check `t3_thread_list` before you retry.
4. For a **same-owner chain** (WP01A→WP01B, WP02B→WP02A→WP02C, WP04A→WP04B), you may instead send the next brief to the previous worker's thread with `t3_thread_send`, once its PR has merged. Tell that worker to create the new branch from the latest `origin/main`. This keeps context. Only do it if that thread is idle.

**Worker brief.** Fill in the placeholders and keep it short; the files hold the detail:

```text
You are a Rowbly worker implementing package <WPxx> (<title>) of the plugin-review remediation.
Read, in order: docs/spec/plugin-review/worker.md, README.md, contracts.md, your package file
docs/spec/plugin-review/packages/<file>, and every review entry linked from your package's findings table.
Also read AGENTS.md, docs/agents/CONTEXT.md, docs/agents/CONTEXT-MAP.md, docs/adr/* (including the ADRs WP00 added).
Branch: review/<wpxx>-<slug>, based on origin/main. Open a PR against main titled "<WPxx>: <title>".
Link the PR with link_pull_request, then report the PR URL and the acceptance checklist in this thread.
Shared contract files follow contracts.md §8. If you need an out-of-scope change, post a CCR here (worker.md §4) and keep working on the rest.
```

5. Wait on running workers with bounded `t3_thread_wait` calls, or use `watch_pull_request` once a PR exists. Do not poll in a tight loop.

## 4. Reviewing and merging a PR

For each PR a worker reports:

1. **Scope.** Run `gh pr diff <n> --name-only`. Every file must fall under one of:
   - the package's **Owns** list;
   - its **May touch** list;
   - files listed under "Consumer compile fixes" in the PR body, following contracts.md §8.2;
   - new test files;
   - the package's own rows in `findings.md`.

   A change to a file owned by another package, or to a restricted doc, without an approved CCR means the PR goes back to the worker.
2. **Gates.** In a scratch worktree, run `gh pr checkout <n>`, then `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Every step must pass. Note the test count, which should only grow.
3. **Acceptance.** Go through every acceptance criterion in the package file. For P0 and P1 packages:
   - Rerun at least one listed reproduction from `docs/reviews/plugin-architecture/repros/` against the PR branch. Adapt the absolute import paths to the worktree, as `repros/README.md` explains.
   - Confirm that the reproduction no longer shows the defect.
   - Confirm that the permanent test fails when you revert the fix. A quick local revert of the key hunk is enough.
4. **Ledger.** Every row the package owns has a final status:
   - Each `done` row names its test or commit.
   - Each `deferred` row has a reason consistent with contracts.md §2. Reject deferrals of P0 or P1 rows unless the user approved them.
   - Withdrawn and merged rows are untouched.
5. **Language and organization.** Check against the `docs/agents/CONTEXT.md` terms (for example `Stage`, never `status`/`column`; `Story`, never `issue`). Check AGENTS.md TUI rules: one component per PascalCase file, barrels, thin `app.tsx`.
6. **Verdict.**
   - **Changes needed:** send numbered findings with `t3_thread_send`. Allow at most 3 rounds. After that, mark the package `blocked` and tell the user.
   - **Pass:**
     1. Run `gh pr merge <n> --squash --delete-branch`.
     2. Update the ledger and run `git fetch origin`.
     3. Tell running workers to rebase onto `origin/main` if they depend on the merged package or touch nearby files.
     4. Collect the PR's **Docs handoff** section into `.fleet/plugin-review-status.md` for WP09B.

Merge in dependency order. If two ready PRs conflict, merge the one on the critical path first and ask the other worker to rebase.

## 5. Contract Change Requests (CCR)

A worker posts a CCR when it needs to edit a file it doesn't own, a shared contract (contracts.md §8, a WP00 ADR, `types.ts`), or a restricted doc. Respond as follows:

- **Reject** the CCR if the need can be met inside the package, for example through a Docs handoff or a consumer compile fix. Explain how.
- **Defer** it to the owning package if that package hasn't run yet: add the request to the owning package's brief.
- **Approve** it otherwise:
  1. If the owning package has merged, make a minimal `contract/<slug>` PR yourself. Update the code, contracts.md, and the ADR together.
  2. If the owning package is running, ask that worker to include the change.
  3. Tell every affected running worker to rebase.

If a CCR would reverse an existing ADR beyond the amendments listed in WP00, or reverse a decision recorded in `docs/agents/CONTEXT.md`, ask the user.

## 6. Checkpoints

### Checkpoint A — after WP00 merges

Post to the user:

- the ADRs WP00 added, with a short summary of each decision D1–D9;
- the W1–W12 choices, noting any that differ from the defaults and why;
- the type-signature appendix from the WP00 PR;
- questions U1–U4 from [contracts.md §9](contracts.md#9-open-decisions), each with its recommended default.

Record the answers in the ledger. Do not dispatch any ✱A package (WP04A, WP02B) until the user approves. WP05O, WP07A, and WP09A may continue.

### Checkpoint B — the P0 gate, after WP01A, WP02A, WP02B, WP02C, WP03, WP05A, WP05C, WP08B, and WP08C merge

On the integrated `main`:

1. Run all gates.
2. Rerun every reproduction script listed in contracts.md §12, against temporary roots only.
3. Run the crash-recovery test and the cross-process concurrency test 10 times each to check for flakiness.

Post a report that covers:

- each P0 finding with its closing PR and test;
- the reproduction results;
- any P0 row that is not `done`.

Do not dispatch ✱B packages (WP04B, WP07B, WP09B, WP10A) until the user approves.

### Checkpoint C — the built-in release gate, after every package except WP10B merges

Post the completion checklist from [README.md §6](README.md#6-completion-checklist-checkpoint-c-and-done), with evidence for each item. Include:

- the final ledger counts by status;
- the full list of `deferred` rows with their reasons;
- the test count compared with the baseline.

Ask the user whether to run WP10B, and whether to revisit any deferrals.

### Done

Post the final report:

- the merged PRs;
- the test count;
- known gaps;
- the ledger summary.

## 7. Things you never do

- Push to `main` directly, cut a release, bump the package version, publish to npm, edit `.github/workflows/release.yml`, or create repositories. Releases go through the existing release workflow and are the user's call. WP10B changes `package.json` `exports` only, after explicit approval.
- Merge with failing gates, unchecked acceptance criteria, or `open` ledger rows belonging to the package.
- Accept a P0 or P1 deferral without the user's agreement.
- Let two workers own the same file at the same time.
- Accept a fix that builds something listed in [contracts.md §11](contracts.md#11-not-adopted--do-not-build).
- Run reproduction scripts against real data roots. They create temporary roots; read each script before you run it, and use bounded timeouts for the hang fixtures.
