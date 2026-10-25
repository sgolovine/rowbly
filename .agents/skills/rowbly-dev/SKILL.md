---
name: rowbly-dev
description: "Carry a Rowbly Story from its Story Key (or number) to a validated draft pull request through a supervisor and specialized workers: read the Story, keep its Stage and Comments current, rightsize the task, research, plan, implement in an isolated branch and linked worktree, publish coherent checkpoints, validate, and open a draft PR. Use when the user gives a Story Key such as ROW-18 and wants it developed autonomously."
---

# Rowbly Dev

Give this skill a Story Key and it takes the Story through to a draft PR. The Story is the change
request; this file is the development workflow.

Rowbly is a file-backed Kanban tracker in a `.rowbly/` Data Root. Read
[the Rowbly reference](references/rowbly-reference.md) before you run any `rowbly` command.

## Operating Principle

Use the main thread as the supervisor. Perform complexity 1–2 tasks entirely in that thread; delegate execution for scores 3–10 according to the allocation below. Skipping an agent transfers its necessary work to the development role; it never removes that work. For scores 1–2, the supervisor also fills the development role. Preserve worktree isolation, an explicit parent, planning before implementation, coherent commits and pushes, and repository checks; require supervisor sign-off on validation before opening a draft PR and completing the task.

The supervisor owns the Story: it reads it, changes its Stage and adds its Comments. Workers report to the supervisor and do not run `rowbly` commands that change data.

## Inputs

Accept a Story Key (`ROW-18`, case-insensitive) or a bare number (`18`). Accept optional extra instructions too, such as a parent branch or a narrower scope. Extra instructions take precedence over the Story when they conflict.

Infer the target repository from the current working directory, which becomes the control checkout. If no git repository is present, stop and report that this workflow requires a git checkout.

## Rowbly Story

The supervisor does this before it scores complexity.

1. **Choose the command and the Data Root.** Run `rowbly --version`. In the Rowbly source repository without a global install, use `pnpm --dir <control-checkout> --silent dev` instead of `rowbly`. If the control checkout has a `.rowbly/` folder, add `--data-root <control-checkout>/.rowbly` to every call. Otherwise run the calls from the control checkout and confirm that the Story resolves. Add `--json --no-prompt` to every call.
2. **Run every `rowbly` command against the control checkout's Data Root, never from the linked worktree.** The Board shows progress there. If the Git Plugin is on, it commits each Rowbly change in the checkout where the command runs, and those commits must not land on the task branch. Do not commit `.rowbly/` changes on the task branch unless the Story's change is to Rowbly data itself.
3. **Resolve the Story Key.** For a bare number, read the Board's `keyPrefix` (`rowbly use`, then `rowbly boards list`) and form `<PREFIX>-<number>`. If several Boards could match and none is current, ask which one to use.
4. **Read the request.** Run `rowbly stories show <KEY>` and `rowbly plugins list`. Then, for each Plugin that is on, read the Story's Tasks (`tasks list`), Specs (`specs list --story <KEY>`), Comments (`comments list`) and Epic (`epics show <id>`), plus any Board Specs that the Story links. The Story's name, description, Specs and Comments together are the change request.
5. **Check that the Story can start.** If it is in a Stage of category `done`, stop and ask. If its Comments name an open draft PR or a task branch for it, report that work and ask whether to continue it or start again. If the request is materially ambiguous, ask the smallest set of blocking questions before you touch files. If the Comments Plugin is on, record the answers as a Comment.
6. **Read the Stages** of the Story's Board with `rowbly config show --board <id>`. Do not assume their keys.

### Story updates

Keep the Story current without being asked. The supervisor makes each update when the stage that causes it is accepted:

| When | Update |
| --- | --- |
| The plan is accepted, before the first code change | Move the Story to the in-progress Stage (reference §5). If the Comments Plugin is on, add a Comment with the complexity score, branch and a short plan. |
| A planned Task finishes | Move the Task to `done`. |
| A blocker or a decision that changes the scope | Add a Comment. |
| The draft PR is open | Add a Comment with the PR URL and the validation summary. Move the Story to a review Stage (key or name contains `review`) if the Board has one; otherwise leave it in the in-progress Stage. |

Do not move the Story to `done`: the work is complete only when the PR merges, and that is outside this skill. Do not turn Plugins on, edit Story fields the request does not need, or delete records. If the Comments Plugin is off, put the same notes in the PR body and in the final report.

## Supervisor And Worker Workflow

1. **Score complexity first.** Before dispatching workers or starting repository work, the supervisor assigns an integer complexity score from **1 to 10** based on the request's scope, uncertainty, risk, dependencies, and available context. Use 1–3 for small, well-understood changes; 4–5 for bounded changes with moderate coordination or uncertainty; and 6–10 for broad, uncertain, or high-risk work. State the score, a brief rationale, and which worker types are needed, how many of each, and why. Do not automatically spawn research or validation agents; use the allocation below. Reassess the score and allocation when worker findings change the scope.
2. **Allocate by score.** For scores **1–2**, spawn no subagents: the supervisor performs research, baseline setup, planning, implementation, checks, screenshots, corrections, Git operations, and PR creation in the same thread. For scores **3–10**, the supervisor owns assignments, handoffs, communication, and acceptance; workers execute the work. If required subagent tools are unavailable, report that blocker.
3. **Keep the work when skipping an agent.** For scores **3–5**, omit a research agent by default and assign necessary research to the development agent before planning or implementation. For scores **6–10**, use a research agent unless sufficient findings are already available. At score **3**, omit a validation agent by default; the development agent performs necessary checks and captures screenshots. Scores **4–10** require a separate validation agent, which also owns screenshots. Omit a planning agent when an actionable plan with acceptance criteria exists, such as a Story Spec or a Story's Tasks with clear done criteria; otherwise select one as needed or have the development role prepare the plan. An existing plan still needs review. For scores 3–10, add optional agents only for a stated task-specific need or explicit user request. Reassess complexity if new findings warrant a different allocation.
4. **Preserve stage order and fresh assignments.** Complete necessary research → planning → development → validation, regardless of who owns each stage. The supervisor accepts prerequisite outputs before downstream work begins, including when one development assignment spans several stages. For delegated work, spawn a brand-new subagent for each new assignment, correction, or revalidation; never repurpose an existing session. An active development worker may finish the research, planning, checks, and screenshots included in its original assignment. Scores 1–2 stay in the same supervisor thread throughout. Parallelize only independent work.
5. **Make handoffs sufficient.** Give each worker the request, assigned scope and role, repository instructions, control checkout and established worktree/branch, relevant predecessor findings or accepted plan, acceptance criteria, and required output. Include the Story Key and the Story's full text (name, description, Specs, Tasks and relevant Comments), so that workers do not need to run `rowbly`. Have workers return findings or changes, evidence, blockers, and next-stage inputs. When several workers contribute, reconcile their outputs before accepting the stage. Follow the shared worktree contract's single-writer rule, including commands that generate files.

| Worker type | Responsibility and handoff |
| --- | --- |
| Research agent | Investigate the problem and relevant code, tests, constraints, and dependencies. Return evidence, affected touch points, and unresolved questions for planning. |
| Planning agent | Turn the request and research into the implementation plan below. Define ordered steps, ownership where work is split, and acceptance criteria for development and validation. |
| Development agent | Perform necessary research and planning when those agents are skipped. Execute the accepted plan, make scoped changes, run development checks, and commit and push coherent checkpoints. Return the implemented steps, deviations, changed files, commit IDs, and validation evidence. At score 3, also own screenshots and any checks not assigned to a validator. Also handle assigned integration or PR finalization work. |
| Validation agent | Independently inspect and test the development result against the accepted plan and original request. Report each criterion as met, unmet, or blocked, with evidence and actionable findings. Own screenshots for scores 4–10 and include them with the validation evidence. Do not make implementation fixes. |

For scores 1–2, all worker responsibilities below belong to the supervisor, including corrections and finalization; no worker handoffs or fresh-agent requirements apply. For scores 3–10, the first selected worker performs baseline setup before its stage-specific work; all later workers receive the resulting worktree, branch, parent ref, and start SHA.

## Baseline

Assigned worker:

1. Inspect repository state before changing anything: `git status --short --branch`, `git remote -v`, and `git worktree list`.
2. Identify a parent branch from `main`, `master`, or `develop`:
   - If the user names the parent, require it to be one of those three and to exist; otherwise stop and ask for a supported parent.
   - When the user does not name the parent, use the remote default branch when it is one of those three; resolve an unset `origin/HEAD` with `git remote show origin`.
   - If the remote default is unavailable or has another name, use an existing branch in this order: `main`, `master`, then `develop`.
   - If none exists, stop and ask which supported parent branch to create or use. Do not base autonomous development on any other branch.
3. Preserve unrelated local work. Do not overwrite, revert, stash, or commit pre-existing user changes. A dirty original checkout does not need to be cleaned.
4. Fetch remotes with pruning. Choose `origin/<parent>` as the start point when available; otherwise use the local parent and note that push and PR steps may be blocked.
5. Read [the shared linked worktree contract](references/worktrees.md), then apply it before planning or editing, even when the original checkout is clean. Use:
   - the original checkout as the control checkout,
   - the selected parent ref as the start point,
   - `<harness>/<story-key-lowercase>-<short-kebab-summary>` (for example `claude/row-18-skills-create`) as the unique local branch unless the user requests another name,
   - a unique sibling path such as `../<repo>-worktrees/<story-key-lowercase>-<short-kebab-summary>`.
6. Never develop directly on `main`, `master`, or `develop`. Perform all remaining repository work from the linked worktree and leave it in place for review or follow-up unless the user explicitly requests cleanup. The `rowbly` commands in [Rowbly Story](#rowbly-story) are the one exception: they run against the control checkout's Data Root.
7. Install dependencies in the linked worktree before the first check if the repository needs them (for example `pnpm install --frozen-lockfile`).

## Coordinate With Other Agents

Other agents may be working on the same code in different worktrees. Worktree isolation does not prevent overlapping changes or integration conflicts. The supervisor coordinates ownership and handoffs; assigned workers perform repository comparisons and integration changes.

- Before editing, use available agent coordination channels to identify active work that overlaps the task. Share the intended scope, branch, and affected files or interfaces; agree on ownership, dependencies, and landing order where work overlaps. Also check the Board: other Stories in the in-progress Stage can show overlapping work.
- Keep affected agents informed when scope, shared interfaces, or dependencies change. Preserve their work, and resolve conflicting approaches together rather than overwriting changes or silently duplicating implementation. If coordination is unavailable, report the unresolved overlap and continue independent work.
- Before the final validation and PR, fetch the latest parent and check relevant companion branches or PRs. Incorporate required landed changes into the task branch without rewriting published checkpoints, resolve conflicts while preserving both tasks' intended behavior, and rerun affected checks. Document companion PRs, dependencies, and the agreed landing order in the PR and handoff; report any unresolved integration blocker. Coordination does not authorize merging PRs or modifying another agent's branch or worktree.

## Plan

Before implementation, the planning owner prepares a concise plan for supervisor review and presents it in the conversation. When a plan already exists, such as a Story Spec or a list of Tasks, review and present it instead. Without a planning agent, the development role performs any necessary planning; scores 1–2 do this in the supervisor thread. If the change is large enough to warrant a plan file, keep that file out of the commit and PR. Include:

- the requested outcome in concrete terms, traced to the Story's description, Specs and Tasks,
- relevant files, modules, APIs, commands, or workflows discovered from the repo,
- assumptions and any accepted clarifications,
- ordered implementation steps, each mapped to the Story's Tasks where they exist,
- validation criteria that define done behavior, and the evidence required before opening the PR: test commands, manual checks, or logs,
- screenshot scenarios and their owner for every task: affected screens, states, and viewports for UI changes, or visible output such as rendered documentation, CLI results, or API responses for non-UI work; plan before-and-after captures where they demonstrate the change,
- risks, migrations, compatibility concerns, or rollout notes when relevant.

If the plan reveals a material gap, the supervisor obtains the needed clarification before accepting it. Begin implementation only after the supervisor accepts the plan and makes the first [Story update](#story-updates).

## Implementation

Assigned development worker:

1. Read the existing code and tests around the planned touch points before editing.
2. Follow repository patterns for architecture, naming, style, dependencies, tests, and error handling. Read the repository's agent instructions (`AGENTS.md`, `CLAUDE.md`) first; they take precedence over this skill for tests, documentation and checks.
3. Keep changes scoped to the request. Do not perform opportunistic refactors, formatting sweeps, dependency upgrades, or unrelated cleanup.
4. Update or add tests near the changed behavior when the repository's test policy requires them. When tests are not required or not practical, explain why and use the strongest available validation.
5. Update documentation, examples, migrations, or configuration only when required by the changed behavior.
6. Review the diff while working to catch accidental edits, generated noise, secret material, or unrelated changes.
7. Create and publish checkpoints throughout development:
   - Create multiple focused commits as implementation progresses, committing each coherent milestone before moving to the next, such as a schema or API change, the core implementation, tests, or documentation. Do not accumulate the entire implementation for one final commit or defer splitting it into commits until the end.
   - Use a single commit only for very minor work that forms one small, coherent change, such as a typo fix or a narrowly scoped one-line correction. A task being atomic does not by itself justify one commit. Choose meaningful boundaries; do not create empty or artificial commits merely to increase the count.
   - Before each checkpoint, run the fastest relevant targeted check and inspect the staged diff. Keep each commit focused and leave the branch in a usable state when practical.
   - Follow the repository's documented or recent commit convention. If none is clear, use Conventional Commits 1.0.0 (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, and similar). Mention the Story Key in each commit message, for example `feat(cli): add skills create (ROW-18)`.
   - Push immediately after the first commit with `git push -u origin <branch>`, then push again after every later commit. Do not wait until the end of a multi-milestone task to publish all progress.
   - Do not use meaningless checkpoint messages such as `WIP`, and do not amend, squash, rebase, or force-push already published checkpoints unless the user explicitly asks.
   - Report each finished Task to the supervisor, which moves it to `done`.

## Validation

When a separate validation agent is selected, a fresh validation worker reviews the diff and independently runs the repo's relevant checks against the completed implementation before opening the PR. Otherwise, the development role performs these checks and records the validation report (in the supervisor thread for scores 1–2, or the development handoff at score 3). Skipping a validation agent does not skip validation or supervisor sign-off. Prefer discovered project commands over generic guesses; run every check the repository's agent instructions name:

- type checks,
- lint or formatting checks,
- unit tests,
- integration or end-to-end tests,
- build commands,
- targeted manual verification for UI or behavior that automated tests do not cover.

Return a validation report identifying the validated commit, coverage of each accepted plan step, acceptance criterion and Story Task, commands and outcomes, and any missing or incorrect behavior. If a check cannot be run because of missing credentials, services, packages, time, or environment constraints, record the exact command, failure, and residual risk for the PR.

The supervisor reviews the report against the Story and accepted plan. For scores 1–2, the supervisor fixes issues, updates any plan gaps, and reruns affected checks in the same thread. For scores 3–10, if validation finds an implementation issue or an unmet plan requirement, spawn a **brand-new development agent** with the plan, findings, and current worktree/commit to fix it. Never send fixes back to an earlier development session. After its changes are committed and pushed, use the current complexity score and allocation to determine revalidation: spawn a **brand-new validation agent** when separate validation is selected; otherwise, the correction worker supplies updated checks and evidence. Repeat until the evidence supports acceptance, or report a concrete blocker with the work left reviewable. Have the planning owner resolve material plan gaps before further development, using a fresh assignment when delegated.

The supervisor explicitly records validation sign-off only when the evidence supports fulfillment of the Story and accepted plan. Document any accepted validation limitations; do not treat an unmet requirement as complete. Changes after sign-off invalidate it and require fresh validation and supervisor sign-off before finalization.

Development workers review `git status --short` and the relevant diff before each commit, then the staged diff after staging. The worker responsible for validation runs the complete relevant validation suite before PR finalization.

## Screenshots

Screenshots are a required deliverable for **every task**, separate from validation. Capture and include them even when a validation agent is skipped or validation checks cannot be performed. Screenshots do not substitute for checks. At scores **1–2**, the supervisor captures them in the same thread; at score **3**, the development agent owns them; at scores **4–10**, the validation agent owns them. If an optional validator is used at score 3, screenshot ownership stays with development.

Capture actual task-relevant output, including for non-UI changes: rendered documentation, CLI behavior, or API responses as appropriate. For UI changes, capture comparable before-and-after states. Use the screenshot tool or skill that the repository's agent instructions name; in the Rowbly repository, that is the `rowbly-screenshots` skill. Inspect the images for readability, correct revision and state, and absence of secrets. When validation is performed, combine screenshots with its evidence and report while retaining screenshot completion as a separate requirement. Preserve the images and capture context for PR upload, outside every checkout; if checks are blocked, still capture any available screenshot evidence and report the check limitations separately.

## Finalize And Open PR

After validation sign-off, the supervisor finalizes scores 1–2 in the same thread; for scores 3–10, assign a fresh development worker to finalize the branch and PR. The screenshot owner supplies the images and evidence for upload. Any delegated follow-up capture remains with the designated role in a fresh assignment.

1. Confirm task changes are committed and the branch still matches the signed-off commit. If final changes are needed, return through development, fresh validation, and supervisor sign-off before opening the PR. Stage only files that belong to the task and follow the checkpoint rules.
2. Confirm every commit has been pushed and the local task branch is synchronized with its upstream.
3. Open a draft pull request by default with `gh pr create --draft --base <parent>`, where `<parent>` is the parent branch established earlier. Start the title with the Story Key or follow the commit convention with the Key, for example `feat(cli): add skills create (ROW-18)`. Use a ready-for-review PR only when the user explicitly requests it. If `gh` is unavailable or unauthenticated, leave the branch pushed and report the compare URL as the blocker instead of retrying other tooling.
4. Write the PR body with:
   - the Story Key and name, and a summary of the user-facing or developer-facing change,
   - implementation notes that matter for review,
   - validation commands and outcomes,
   - known gaps, skipped checks, or follow-up work,
   - a link to the uploaded screenshot comment for every task, added after the upload below.
5. Upload the screenshot evidence to the PR for every task. For UI changes, use the `github-pr-screenshots` skill when it is available, with the newly created PR URL, keeping capture responsibility with the screenshot owner above. For non-UI work, or when that skill is not available, upload the task-relevant images directly. Include the screenshots alongside validation results when available, or as standalone evidence when validation was not performed. Verify that the posted comment displays every image and link it from the PR body. Local screenshot paths or other artifact links do not satisfy the upload requirement. If capture or upload is blocked, preserve any captured images and report their paths and the exact blocker; do not claim the task is complete.
6. Make the last [Story update](#story-updates).

Do not merge the PR, mark it ready, request reviewers, or modify remote repository settings unless the user explicitly asks.

## Completion Criteria

The supervisor finishes only after reviewing the finalization result (its own work for scores 1–2 or the worker's handoff for scores 3–10), confirming that the PR contains the signed-off commit and the uploaded screenshots, confirming the Story's Stage and Comments with `rowbly stories show <KEY>`, and reporting the Story Key and its Stage, branch, linked worktree path, pushed commits, PR URL, validation performed, supervisor sign-off, and any skipped checks or unresolved risks. Leave the linked worktree in place for review or follow-up unless the user explicitly asks to remove it. If pushing, opening a PR, or uploading required screenshots is blocked, keep the branch and commits reviewable, add a Comment to the Story with the blocker if the Comments Plugin is on, and report the exact blocker.
