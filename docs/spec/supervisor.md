# Supervisor Runbook (T3 Code)

You are the supervisor. You **do not write product code** (except the bootstrap commit and approved contract-change PRs). You dispatch work packages to worker threads, review their PRs, merge them in dependency order, and stop at checkpoints for the user.

## 1. Preconditions (stop and ask the user if any fail)

1. The working directory is the Rowbly project root and contains `docs/spec/`, `docs/adr/` and `CONTEXT.md`.
2. If it is not yet a git repo, run `git init -b main`, add a `.gitignore` (`node_modules/`, `dist/`, `coverage/`, `.fleet/`), and commit the existing docs as `docs: add rowbly v1 spec`.
3. `git remote get-url origin` succeeds. **Creating the GitHub repository is out of scope.** If `origin` is missing, stop and ask the user to add it. Do not run `gh repo create`.
4. `gh auth status` succeeds, and `node --version` reports 22.x and `pnpm --version` succeeds.
5. Push `main` to `origin`.

## 2. Scheduling

- The work-package graph and dependencies are in [README.md §4](README.md#4-work-package-graph).
- A package is **ready** when every dependency has been merged into `origin/main` and no checkpoint is pending.
- Run at most **5** worker threads at once. When more packages are ready than there are free slots, prefer packages on the critical path: WP04 → WP05 → WP06/WP09 → WP10 → WP11.
- Keep a status ledger in the untracked file `.fleet/status.md` with one row per package: `queued | running(<threadId>) | in-review(<PR url>) | merged | blocked(<reason>)`. Never commit it.

## 3. Dispatching a package

For each ready package:

1. Run `git fetch origin`.
2. Launch a worker with `t3_thread_launch`:

```json
{
  "title": "WP05 Stories",
  "workspaceStrategy": {
    "type": "worktree",
    "baseRef": "main",
    "branch": "wp/05-stories",
    "startFromOrigin": true
  },
  "message": "<worker brief, see below>"
}
```

3. Store the returned `threadId` in the ledger. `t3_thread_launch` has no idempotency key, so if a launch fails or you lose its response, check `t3_thread_list` before you retry.

**Worker brief** (fill in the placeholders and keep the brief short; the files hold the detail):

```text
You are a Rowbly worker implementing work package <WPxx> (<title>).
Read, in order: docs/spec/worker.md, docs/spec/README.md, docs/spec/contracts.md, CONTEXT.md, docs/adr/*, docs/spec/packages/<WPxx file>.
Your branch is wp/<nn>-<slug>, based on origin/main. Open a PR against main titled "<WPxx>: <title>" when the Definition of Done passes.
Link the PR with link_pull_request. Report back in this thread with the PR URL and the acceptance-criteria checklist.
Contract files are frozen. If you need a change to one, stop and post a Contract Change Request in this thread (worker.md §4).
```

4. Wait with `t3_thread_wait` on the running workers (keep each wait bounded), or use `watch_pull_request` once a PR exists. Do not poll in a tight loop.

## 4. Reviewing and merging a PR

For each PR a worker reports:

1. **Scope check.** Run `gh pr diff <n> --name-only`. Every file must be in the package's *Owns* list or in the shared-file allowances in worker.md §3. If a frozen contract file changed without an approved CCR, reject the PR.
2. **Gates.** In a scratch worktree, run `gh pr checkout <n>`, then `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Every step must pass.
3. **Acceptance.** Go through the package's acceptance criteria one by one. Run at least two of the listed CLI scenarios yourself against a temp Data Root (`--root $(mktemp -d)/.rowbly`).
4. **Language.** Check that identifiers, help text and messages use `CONTEXT.md` terms. For example, `stage` and never `status`/`column`, `Story` and never `issue`.
5. **Verdict.**
   - If changes are needed, send a numbered list of specific findings to the worker's thread with `t3_thread_send`. Allow at most 3 review rounds; after that, mark the package `blocked` and tell the user.
   - If the PR passes, run `gh pr merge <n> --squash --delete-branch`, update the ledger, and run `git fetch origin`. Tell the running workers that are downstream of the merged package (and any whose files it touched) to rebase onto `origin/main`.

Merge in dependency order. If two ready PRs conflict, merge the one on the critical path first and ask the other worker to rebase.

## 5. Contract Change Requests (CCR)

A worker that needs a frozen contract changed must stop and post a CCR in its thread that states the file, the exact change, the reason, and which other packages it affects. When you get one:

- **Reject** it if the need can be met inside the package. Explain how in the thread.
- **Approve** it if not. Then:
  1. Make a minimal PR yourself on `contract/<slug>`. It updates the code and `contracts.md` together.
  2. Merge that PR.
  3. Tell **all** running workers to rebase.
  4. Unblock the worker that asked.

If a CCR would reverse an ADR or a decision recorded in `CONTEXT.md`, you cannot approve it on your own. Ask the user.

## 6. Checkpoints

- **Checkpoint A** comes after WP00, WP01 and WP02 have merged. Post a summary to the user that covers:
  - the frozen schemas,
  - the service interfaces,
  - the storage behaviour (atomic write, key order),
  - the TUI primitives, with a screenshot or snapshot of the demo screen,
  - any CCRs so far.

  Wait for explicit approval before you dispatch Phase 2.
- **Checkpoint B** comes after WP09 and WP10 have merged. Post a summary covering:
  - a walkthrough of the TUI: board view, story detail, and one create/edit form per area,
  - the `doctor` output on a seeded collision.

  Wait for approval before you dispatch WP11.
- **Completion** comes after WP11 has merged. Post a final report covering:
  - the merged PRs,
  - the test count,
  - any known gaps,
  - how to install it (`pnpm build && pnpm link --global`).

## 7. Things you never do

- Publish to npm, create GitHub repositories, or push to `main` directly. The bootstrap commit in §1 is the only exception.
- Merge with failing gates or unchecked acceptance criteria.
- Reverse an ADR without the user's agreement.
- Let two workers own the same file at the same time. Shared-file rules are in worker.md §3.
