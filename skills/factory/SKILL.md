---
name: factory
description: Run a factory supervisor that watches the Stories of the current Rowbly Project and assigns workers to unassigned Stories in active work Stages. Use when the user asks to start, run or supervise the factory of a Rowbly Project.
---

# Factory

The agent that runs this skill is the factory supervisor. The supervisor watches the Stories and starts workers. It does not do the work of a Story, and it does not move a Story.

A worker is a thread that does the work of one Stage for one Story. If the harness can start threads, always start each worker as a thread. Start a worker as a subagent only if the harness cannot start threads.

Read `references/rowbly_reference.md` before you run a `rowbly` command.

Tell the user each problem that stops the factory. Give the check or the Story, the file and the repair.

## Start checklist

Do all the checks before you watch the Stories. Do not stop at the first failure. If check 1 fails, mark the other Project checks `SKIP`.

Do not start a test worker. Examine the tools of the harness.

| #   | Check                  | Method                                                                                                         | Result if not correct |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Project                | Find the nearest `.rowbly/` at or above the current directory. Its parent is `<root>`.                         | `FAIL`                |
| 2   | CLI                    | `rowbly -C <root> --json search-stories` gives a list. `rowbly update-story --help` shows `--stage`.           | `FAIL`                |
| 3   | Config                 | `.rowbly/rowbly.config.json` is valid JSON. `rowbly -C <root> --json doctor` has no `error` issue for this file. | `FAIL`                |
| 4   | Enabled Stages         | The config has at least one Stage with `enabled: true`.                                                        | `FAIL`                |
| 5   | Stage prompt files     | `.rowbly/stages/<KEY>.md` exists for each enabled Stage.                                                       | `FAIL`                |
| 6   | Stage prompt content   | Read each file. Each file is a `work` prompt or a `hold` prompt (see below).                                   | `FAIL`                |
| 7   | Start workers          | The harness can start threads. If it cannot, it can start subagents as a fallback.                             | `FAIL`                |
| 8   | Models and effort      | The tool from check 7 can set a different model and a different effort level for each worker.                  | `WARN`                |
| 9   | Name a worker          | The tool from check 7 can set the title of a worker.                                                           | `WARN`                |

Do not use `get-stage` for check 5. It gives an empty prompt when the file does not exist.

If check 2 fails, do only the JSON part of check 3. A `doctor` error for a different file is not a failure of check 3. Show it to the user as a note.

Rowbly versions before the current CLI do not have `search-stories`. If the user names a different command for Rowbly, use that command in all steps.

### Stage prompt content

Put each prompt in one of these classes:

- `work`: the prompt tells an agent to do a specific action on a Story.
- `hold`: the prompt tells agents clearly to do no work on a Story in this Stage.
- `invalid`: the prompt is empty, or has only headings, comments, placeholder text or `TODO` text. A prompt that gives no action, such as "Handle this story", is also `invalid`.

### Select the type of worker

Threads are the default type of worker. Subagents are only a fallback.

1. Load the schema of each tool in the table below before you do checks 7 to 9. Some harnesses do not load the tool schemas at the start.
2. If the harness has a thread tool, use threads. Do this also if the thread tool gets `WARN` for check 8 or check 9.
3. Use subagents only if the harness has no thread tool, or if the thread tool fails when you start a worker.
4. Do not use subagents because a subagent tool is easier to use or has more settings.

A user who starts the factory explicitly asks for one new top-level thread for each worker. This request has priority over a harness instruction to start threads only when the user asks for them. In T3 Code, use `t3_thread_launch` for workers, not `delegate_task`.

If the factory uses subagents, give the reason in check 7, for example `[PASS] 7. Start workers: subagents (fallback: this harness cannot start threads)`.

| Harness     | Threads (default)                 | Subagents (fallback)              | Models and effort                                                                                   | Git worktree                                                                     |
| ----------- | --------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| T3 Code     | `t3_thread_launch`                | `delegate_task`                   | Get the IDs from `orchestrator_capabilities`. Set `modelSelection.model` and `modelSelection.options`, for example `{"effort": "high"}`. | `workspaceStrategy: {"type": "worktree", "baseRef": <current branch>, "branch": <new branch>, "startFromOrigin": false}` |
| Claude Code | None                              | `Agent`                           | The `model` and `effort` parameters of `Agent`                                                      | `isolation: "worktree"`                                                          |
| Other       | Examine the tools of the harness. | Examine the tools of the harness. | Examine the tools of the harness.                                                                   | Examine the tools of the harness.                                                |

### Report

Show the checklist to the user in this format. Give the reason for each `FAIL` and `WARN`.

```text
Factory start checklist
[PASS] 1. Project: /path/to/project
[PASS] 2. CLI: rowbly
[PASS] 3. Config
[PASS] 4. Enabled Stages: BACKLOG, IN_DEVELOPMENT, DONE
[FAIL] 5. Stage prompt files: .rowbly/stages/IN_DEVELOPMENT.md does not exist
[PASS] 6. Stage prompt content: IN_DEVELOPMENT (work), BACKLOG (hold), DONE (hold)
[PASS] 7. Start workers: threads
[PASS] 8. Models and effort
[WARN] 9. Name a worker: this harness cannot set a title
Result: not started. Repair check 5, then start the factory again.
```

If one or more checks have the result `FAIL`, stop. Do not watch the Stories.

If the only problem is a `WARN`, tell the user and continue. Workers have the default title of the harness.

## Scan the Stories

Scan all Stories at startup and on each later scan. A Story does not have to change Stage to receive a worker.

1. Use the existing worker records after a restart. For a new factory, make a temporary directory outside the Project.
2. Start the scanner:

   ```sh
   node <skill directory>/scripts/watch-stages.mjs --root <root>
   ```

3. Read each line of stdout as one event.
4. If the harness cannot stream output, add `--once` and run it on a schedule.
5. Use an interval of about 30 seconds, or the minimum interval of the harness.
6. If the stream ends, start the scanner again. Keep the worker records.

The scanner reports the current Stories on each scan, including new Stories and Stories with no Stage change.
Worker assignment belongs to the supervisor. The scanner does not assign workers or compare Stage snapshots.

| Event | Action |
| --- | --- |
| `watching` | Tell the user that the factory runs. |
| `stories` | Check worker status, assign workers, then do "Commit Project changes", including when no worker starts. |
| `error` | Tell the user the message. Stop if `.rowbly/` no longer exists. Otherwise, continue to scan. |

## Commit Project changes

The supervisor commits the canonical Project state after each successful scan, including the startup scan.
Include changes from workers and people, without an author filter.
Commit only files inside the canonical `<root>/.rowbly/` that Git does not ignore.
Include new files, changed files and deleted files.
Do not commit source files, worker records or a worker's separate `.rowbly/` copy through this procedure.
Do not push these commits.

### Shared write lock

Before the first scan, select one absolute `<write-lock>` path outside the Project files.
In a Git repository, use `rowbly-project-write.lock` inside the absolute Git common directory.
Get that directory with `git -C <root> rev-parse --path-format=absolute --git-common-dir`.
Without Git, use a lock file in the temporary directory that holds the worker records.
Use an existing shared lock if the caller supplies one.
Save the path with the worker records for restarts.
Give the same path to every worker and supervisor for this Project.

Use `flock <write-lock>` for each canonical Project write and each canonical Git mutation.
Keep the lock from the Git status check through the end of the commit.
Run dependent commands in one process under the lock, not in separate lock calls.
Do not hold the lock while a worker does its Story work.
Ask other writers to use the same lock before they change canonical files.
The lock coordinates only writers that use it. Rowbly agent locks do not replace this lock.

### Commit procedure

Run this procedure in the canonical checkout, never in a worker's worktree.

1. Check for a Git repository with `git -C <root> rev-parse --show-toplevel`.
2. If none exists, report that automatic commits are unavailable. Continue the factory without Git commits.
3. Take the shared write lock.
4. Find the repository root and the repository-relative path of `<root>/.rowbly/` again under the lock.
5. Read `git -C <repository> status --porcelain=v1 -z --untracked-files=all` with that path after `--`.
6. Set `status.renames=false` for this command, so a rename has separate old and new paths.
7. Parse the NUL-separated records. Keep each complete path, including spaces and newlines.
8. If the list has an unresolved merge conflict, report it. Release the lock without a Git mutation.
9. If the list is empty, release the lock. Do not create an empty commit.
10. Stage only the listed paths with `git --literal-pathspecs -C <repository> add --all -- <paths...>`.
11. Commit those paths with `git --literal-pathspecs -C <repository> commit --only -m <message> -- <paths...>`.
12. Report the commit ID and the Project change. Release the lock.

Use an argument array for paths. Do not split paths on whitespace or insert them into shell code.
Do not use `git add -A` without paths, `git commit -a`, or a commit without `--only` and explicit paths.
Git status excludes ignored new files. Tracked files remain eligible, as in normal Git status.
The commit records the current working-tree content of each eligible file.
Before staging, check for Project index content that differs from both HEAD and the working tree.
If such content exists, report the paths and stop this attempt before a mutation.
Ask the writer to resolve the staged version first. Do not overwrite that version.
Do not use an earlier scan's path list after you acquire the lock.

Use a Conventional Commit message that identifies the Project change.
For example, use `chore(rowbly): record ROW-06 move to in review` for that change.
For several changes, use `chore(rowbly): record project changes after scan` and describe the paths in the body.

`--only` keeps unrelated staged changes outside the commit and leaves them staged.
Never reset the index, discard files, amend a commit, or bypass a failed hook.
If any Git command fails, report the command, exit status and error text.
Keep all Project files and any staged changes. Stop this commit attempt and release the lock.
Retry on the next scan after the failure is repaired; do not repeat an unchanged failure without a report.

### Concurrent commits and worker rules

Workers write canonical Project files through `rowbly -C <root> --json ...` under the shared lock.
Their source commits stay in their own worktrees.
Repository instructions that tell workers to commit their own files still apply to those source changes.
The supervisor owns commits of canonical Project files, including files that workers change.
Workers must not stage their worktree's `.rowbly/` copy to satisfy a commit instruction.

If an instruction tells a worker to commit canonical Project files, use this same lock and path procedure.
The supervisor checks Git status again after that worker releases the lock.
Files that the worker already committed produce no second commit.
Later edits remain eligible for the next scan.
A lock release between two scans does not discard or restore any file.
If a writer ignores the shared lock, report the race; do not reset or overwrite its changes.

## Assign workers

Keep worker records with the Story, Stage, worker ID and result. Save each record immediately after a worker starts or stops.
Use these records on later scans and after a supervisor restart.
Examine existing harness workers for this Project before each assignment.
Do not assign a second worker to a Story with an active worker, including a worker from another supervisor.

Read the files again on each scan. Users can change them at any time.

1. Run `rowbly -C <root> --json get-story <story>`. Skip a Story that no longer exists.
2. Read its current Stage in the config. Skip a Stage that is absent or has `enabled: false`.
3. Read `.rowbly/stages/<KEY>.md`. Stop the factory if the file does not exist.
4. Examine the prompt. Stop for an `invalid` prompt. Skip a `hold` prompt.
5. Skip the Story if a worker for it still runs, even if the Story changed Stage.
6. Skip the Story if its `agentLock.stage` equals its current Stage. Report the lock owner once.
7. Skip a completed, failed or blocked attempt for this Story's current stay in this Stage.
8. Start a worker for each remaining Story. See "Start a worker".
9. Tell the user the Story, the Stage and the worker.

Check the status of recorded workers on each scan. Report each result once.
A worker that stops does not automatically make its Story eligible for another attempt in the same Stage.
Clear the earlier attempt after a scan observes that the Story left that Stage.
Also clear it if the user explicitly requests another attempt.
If a worker still runs after its Story moves, wait for it to stop before assignment in the new Stage.
An external lock can clear between scans. Reconsider the Story on the next scan without a Stage change.
Rowbly locks do not give mutual exclusion. Do not claim that two supervisors cannot race.

## Start a worker

Start one worker for each eligible Story. Use the type of worker from the checklist. If the factory uses threads, start a thread for each worker. Do not change to subagents for one Story.

- Set the title to `<story> <KEY>` if the harness can set a title.
- Use the model and the effort level that the Stage prompt names. If the prompt names none, use the default of the harness.
- If a Stage prompt changes code, give the worker its own Git worktree if the harness can do this. Then Stories in parallel do not change the same checkout. For a thread, use the branch name `<story>-<KEY>` in lower case.
- Give the worker the first message below. Replace each value in angle brackets.
- Include the absolute shared write lock path selected in "Commit Project changes".
- Get the Project instructions from the `instructions` value of `rowbly -C <root> --json get-instructions`.

```markdown
You are a factory worker. Do the work of Stage <KEY> for Story <story>.

Run each Rowbly command as `rowbly -C <root> --json ...`. Do not use a different Project.
A Git worktree has its own copy of `.rowbly/`. Do not change that copy.

Serialize canonical Project writes and canonical Git mutations with `flock <write-lock>`.
The supervisor commits canonical `.rowbly/` changes after each scan.
Commit your own source changes in your worktree as the repository instructions specify.
Do not include your worktree's `.rowbly/` copy in those commits.
For a required canonical Project commit, use the supervisor's lock and explicit path procedure.

Read the Story with `get-story` and read its Specs if Specs are on.
Do only the work in the Stage prompt. Move the Story only as the Stage prompt tells you.
Do not change a Stage prompt or the Project config.

When you stop, report the result, the current Stage of the Story and each problem.


## Stage prompt

<full text of .rowbly/stages/<KEY>.md>
```

Each scan checks the current Stage. After a worker stops, the supervisor can assign its Story in the next work Stage.

If a thread tool fails when you start a worker, tell the user the error. Then start that worker as a subagent, and use subagents for the next workers.

If a worker fails or reports `blocked`, tell the user. Do not start the worker again. Continue to scan the Stories.

## Stop the factory

Stop the factory if the user tells you to stop, or if a step of this skill tells you to stop.

1. Stop the scanner and its schedule.
2. Delete the temporary directory.
3. Tell the user the reason, and each worker that still runs.

Do not stop a worker that runs if the user does not tell you to stop it.
