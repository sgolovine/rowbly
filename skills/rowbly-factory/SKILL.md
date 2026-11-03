---
name: rowbly-factory
description: "Run a Rowbly software factory on one Board: act as its supervisor, start a worker thread for each Story that arrives in a Stage whose Stage Prompt is on, record each Stage Run, answer or relay workers' questions, and apply the Board changes they report. Use when the user asks to run, start or supervise the factory, or to keep working a Board's Stories with agents."
---

# Rowbly factory

The factory turns a Board into a work queue. Each Stage whose **Stage Prompt** is on says what an
agent does with a Story in that Stage. This thread is the **supervisor**: it watches the Board,
starts one **worker** for each Story that arrives in such a Stage, and is the only writer of the
Board. It never writes product code itself.

Rowbly is a file-backed Kanban tracker in a `.rowbly/` Data Root. Read
[the Rowbly reference](references/rowbly-reference.md) before you run any `rowbly` command, and add
`--json --no-prompt` to every call.

## Inputs

All optional, given when the user starts the skill:

- **Board**: a Board id. Without one, use the current Board (`rowbly use`), else the only Board.
- **Worker limit**: how many workers run at once. Default 4.
- **Worker model**: default your own model.
- **Other instructions**, such as where workers run and how to start them. These take precedence
  over `ROWBLY.md`, which takes precedence over this file.

Keep this file free of machine and user specifics: servers, paths, models, thread tools and limits
belong in `ROWBLY.md` or the user's instructions.

## Update the checkout

Do this first, in the git repository that holds the Data Root (find it as the reference says). Skip
it when the Data Root is not in a git repository.

1. **Board changes first.** If `rowbly plugins list` shows `git` on, set up
   [Board persistence](#board-persistence), then run `rowbly git sync`. It commits Rowbly changes
   that were saved but not yet committed, merges the upstream and pushes, and leaves other staged,
   changed and untracked files as they are. If it fails, stop and tell the user its message. It
   handles only changes Rowbly saved: a file edited by hand, inside the Data Root or not, is
   still uncommitted after it.
2. Run `git status --porcelain`. If it prints nothing, go to step 4.
3. **Clean up.** Someone left uncommitted work here. Read every change (`git diff`, `git diff
   --cached` and each new file). If one must not be committed (a secret, build output, a large
   binary), stop and ask the user. Otherwise:
   - Create a branch `factory-cleanup/<YYYY-MM-DD-HHMM>` at the current commit, commit every change
     on it as one **cleanup commit** whose message sums up the changes, in the repository's commit
     style, and push it.
   - Open a **cleanup PR** against the branch you started on. Its description says what each change
     is and that the factory found it uncommitted at start. Do not merge it.
   - Switch back to the branch you started on.
4. Run `git pull --ff-only`. If it fails (diverged history, no upstream), stop and tell the user.

Tell the user in one line whether the checkout was clean, the cleanup PR if you opened one, and the
commit you pulled to. When workers use another checkout, `ROWBLY.md` says whether and how to update
it.

## Board persistence

Workers see your Board changes only after they are committed and pushed. Skip this section when the
Git Plugin is off.

- **Commit each change.** The Git Plugin's preferences are personal: read them with `rowbly git
  show`. When `ROWBLY.md` or the user says Board changes are committed or pushed as they happen, and
  Automatic Commits are Off or `frequency` is `interval`, run `rowbly git configure
  --automatic-commits on --frequency change` and tell the user. Otherwise leave them as they are.
- **Push with the Git Plugin.** The CLI's `rowbly git sync` needs Automatic Merge Conflict
  Resolution On (`synchronization.enabled` in `rowbly git show`); while it is Off the command
  fails. Only the TUI's **Sync** (`S`) works with it Off, and you work in the CLI. If it is Off,
  turn it on only when `ROWBLY.md` or the user says to (`rowbly git configure
  --automatic-merge-resolution on`); otherwise ask the user before you start.
- **When to push.** When `ROWBLY.md` or the user says to push Board changes, run `rowbly git sync`
  after `run start` and before you send the brief, after each worker block you apply, and after
  `run finish` or `run fail` with its block, before you tell a worker the Board has changed. If it
  fails, retry it once; then tell the user and send nothing that relies on the change.
- Never run `git rebase`, `git reset` or a force push yourself.

## Before you start

Check everything below, then report every problem at once. If any check fails, start nothing:
tell the user what is missing and how to fix it, and stop.

1. **Threads.** You must be able to start agent threads that run on their own, read what they write,
   and send them messages. Any way that does this is fine: sub-agents, ordinary top-level threads, a
   CLI, or threads on another machine reached over SSH. Running the factory is the user's request for
   these threads, so start top-level threads when that is the way you have. Follow `ROWBLY.md` or the
   user on how to start them. Fail this check only when you have no way at all.
2. **Data Root and Board.** Find the Data Root as the reference says. Resolve the Board as in
   [Inputs](#inputs). If several Boards could match and none is current, ask the user to start the
   skill again with a Board.
3. **Plugin.** `rowbly plugins list` must show `software-factory` on and loaded. If it is off, tell the
   user to run `rowbly plugins enable software-factory`. Do not turn it on yourself.
4. **Stage Prompts.** Run `rowbly software-factory stages --board <id>`. Use only the Stages whose
   `prompt.enabled` is `true`, and there must be at least one. A Stage Prompt that is still the
   template Rowbly writes is missing: its text is exactly
   `# <Stage name>\n\nWhat an agent does with a Story in the <Stage name> Stage: what to read first, what to change, and when the Story is ready to leave it.\n`.
   Name those Stages and tell the user to write them (`prompt edit`) or turn them off.
5. **What the Stage Prompts need.** Read each Stage Prompt that is on, and `ROWBLY.md` if the Data
   Root has one. List every skill, tool, command, server, credential and permission they name, and
   check that you or the workers you start will have each. Name each one that is missing and the
   Stage that needs it.
6. **Stage Runs already running.** In `rowbly software-factory runs --board <id>`, a Story whose
   `stageRun.status` is `running` was started by an earlier supervisor. Look for its worker (by
   `stageRun.worker`) and take it over if you find it. Otherwise ask the user whether to clear the
   Stage Run and start again (`run clear`, then [start the Story](#start-a-story)).

Then tell the user the Board, the Stages that have a Stage Prompt on, the worker limit and model, and
where workers run. One supervisor works a Board: if the user says another one is running, stop.

## The loop

Run until the user stops you. Do not wait for the user between events.

1. **Read, then wait.** Run `rowbly software-factory runs --board <id>`, act on it (steps 2 to 5),
   and keep its `digest`. If you changed the Board, read `runs` again; when you changed nothing, run
   `rowbly software-factory wait --board <id> --since <digest> --timeout <seconds>` in the
   background, with the harness's way to run a command and resume when it exits. It returns as soon
   as `runs` differs from that digest (a Story entered a Stage whose Stage Prompt is on, or a Stage
   Run or eligibility changed), at once if it already does, or with `changed: false` after the
   timeout. Act on what it returns as on `runs`. Worker messages do not reach it: resume on them
   as well, and keep the timeout as long as your check on quiet workers allows. Stop the wait (a signal) when you stop.
   Never wait on a digest newer than the `runs` you acted on. Re-read `software-factory stages`
   before each start, so a Stage Prompt the user changed or turned off takes effect.
2. **Start** each Story whose `stageRun` is `null` and `eligibility.eligible` is `true`, in the order
   `runs` lists them, while fewer workers run than the limit. See [Start a Story](#start-a-story).
3. **Retry** each eligible Story whose Stage Run is `failed`, once: when `attempt` is 1, follow
   [Retry context](#retry-context) before `run start <KEY> --worker <name> --retry`, then start a new
   worker with that context in its brief. Leave it failed after that and tell the user.
   `ROWBLY.md` or the Stage Prompt may set another retry limit; follow it.
4. Leave `finished` Stage Runs alone. The Story is worked again only after it moves to another Stage
   and comes back, or the user clears the Stage Run.
5. **Blocked Stories.** When `eligibility.eligible` is false, report its `reasons[].message` and
   skip both starts and retries. A `BLOCKED` reason lists unfinished blocking Stories in `blockers`.
   Reconsider on the next Board change or `runs` result: a blocker reaching a Stage of category
   `done` removes that restriction automatically. Do not clear a failed Run or move a Story to
   bypass its blockers. If eligibility cannot be read, report the error and start nothing from
   that result. Existing running workers are still supervised normally.
6. **Act on each worker message**, as in [Worker messages](#worker-messages).

Report each start, retry, finish, failure, question and Board change to the user in one short line.

## Start a Story

1. Run `rowbly software-factory run start <KEY> --worker "<name>"`, where `<name>` identifies the
   worker you are about to start (its thread title or id). Start a worker only when this succeeds.
   Exit 4 means another agent already works the Story in this visit, or its Stage Prompt was turned
   off, or unresolved blocking Stories remain: report the returned reason and skip it.
   Re-read eligibility after Board changes; never launch from a stale overview or after a refused start.
2. Read the Story in full: `stories show`, and for each Plugin that is on, its Specs, Tasks,
   Comments, Epic and Story links.
3. Write the brief from [the worker brief](references/worker-brief.md) and start the worker with the
   worker model, where and how `ROWBLY.md` or the user says. To start it through a `t3` CLI on another
   computer, follow [remote launches](references/remote-launch.md).
4. If the worker cannot be started, run `run fail <KEY> --reason "<why>"`.

## Retry context

Prepare this before starting a retry: `run start --retry` replaces the failed Stage Run, including
its worker, timestamps and reason. A retry starts another worker; it does not by itself authorize
discarding earlier work.

1. **Capture the previous attempt.** Read `stories show <KEY>` and the current `runs` result. Keep
   the failed Stage Run's attempt, worker, status, reason (or "not recorded"), and start/finish
   times. Read the Story's Comments when that Plugin is on, and the prior worker's messages when
   its recorded identifier resolves. Summarize what it completed, validation and publication
   outcomes, and what remains; distinguish a failed worker or launch from failed implementation.
2. **Recover existing work.** Include the prior branch, worktree path, machine and PR URL whenever
   recorded in the Story, Comments or identified worker's handoff. Give the source for each detail
   (for example a Comment id or worker message). Verify recorded branches and PRs with Git or the
   hosting service when available, and paths on the recorded machine when accessible. Mark each
   missing detail "unknown" and an inaccessible or stale detail as unverified. Do not derive a
   worker identity or machine from a branch name, Story Key, Comment author or the current host;
   the Stage Run's `by` is who started it, not the worker. Report conflicting evidence rather than
   choosing an identity or treating unavailable work as absent.
3. **Decide how to proceed.** Follow an explicit continuation or restart instruction from the user,
   Stage Prompt or `ROWBLY.md`. Otherwise ask the user before choosing between existing work and a
   restart, or when missing/conflicting context prevents a safe choice. The brief must say either
   "Continue" with the exact known branch/worktree/PR and remaining work, or "Start again" with
   the reason and the instruction authorizing that deliberate restart. Preserve previous work;
   an unavailable machine or unknown branch is not permission to silently start again.
4. **Preserve and hand off.** Assemble the retry section of
   [the worker brief](references/worker-brief.md). If Comments are on, save the captured context,
   evidence sources and continuation/restart decision as a Comment before replacing the Run, so
   another supervisor can recover it. Otherwise retain it in the supervisor's messages and brief.
   Only then run `run start <KEY> --worker <name> --retry`; launch only on success, using the
   returned attempt number and the captured previous outcome. Do not substitute the new Run's
   worker or status for the previous attempt's details.

## Worker messages

Workers end messages with these markers, as the brief asks:

| Marker | Action |
| --- | --- |
| a fenced `rowbly` block | [Check it](#apply-a-workers-commands), then apply it, except `stories move`: hold a move until the worker's final message. |
| `FACTORY-QUESTIONS <KEY>` | Answer from the Story, its Specs and Comments, the Stage Prompt and `ROWBLY.md` when they settle the question. Ask the user when you are not sure, and never guess at scope. Send the answers to the worker. If the Comments Plugin is on, record the answers as a Comment. |
| `FACTORY-DONE <KEY>` | Run `run finish <KEY>`, then apply its last `rowbly` block, held moves last. |
| `FACTORY-FAILED <KEY> <reason>` | Run `run fail <KEY> --reason "<reason>"`, then apply its last block without any move. |

A worker that stops with no final marker, or has written nothing for a long time, needs a look:
ask it for its state. If it is gone, run `run fail` with what you know.

Finish or fail the Stage Run before you move the Story: a move ends the Stage Run.

## Apply a worker's commands

Workers never change the Board; they report the commands their Stage Prompt asks for. Before you
run a block, check every line:

- It is one `rowbly` command, with no shell syntax (`;`, `|`, `&&`, `$(…)`, redirection), and no
  `--data-root`.
- It changes only the worker's own Story: `stories move|edit <KEY>`, and that Story's Comments,
  Tasks, Story Specs, Attachments, Epic and Story links.
- It is not a `software-factory` command. Stage Runs are yours.

Ask the user about any line that fails a check, and run the others. Run each command against your
Data Root, in order, with `--json --no-prompt`. On an error, stop the block and tell the worker and
the user. Then push as [Board persistence](#board-persistence) says.

## Stopping

When the user stops the factory, start nothing new and tell the user which Stage Runs are still
running. Leave them running: the next supervisor takes them over at its start.
