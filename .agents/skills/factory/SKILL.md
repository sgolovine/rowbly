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
| 2   | CLI                    | `rowbly -C <root> --json story search` gives a list. `rowbly story update --help` shows `--stage`.           | `FAIL`                |
| 3   | Config                 | `.rowbly/rowbly.config.json` is valid JSON. `rowbly -C <root> --json doctor` has no `error` issue for this file. | `FAIL`                |
| 4   | Enabled Stages         | The config has at least one Stage with `enabled: true`.                                                        | `FAIL`                |
| 5   | Stage prompt files     | `.rowbly/stages/<KEY>.md` exists for each enabled Stage.                                                       | `FAIL`                |
| 6   | Stage prompt content   | Read each file. Each file is a `work` prompt or a `hold` prompt (see below).                                   | `FAIL`                |
| 7   | Start workers          | The harness can start threads. If it cannot, it can start subagents as a fallback.                             | `FAIL`                |
| 8   | Models and effort      | The tool from check 7 can set a different model and a different effort level for each worker.                  | `WARN`                |
| 9   | Name a worker          | The tool from check 7 can set the title of a worker.                                                           | `WARN`                |

Do not use `stage get` for check 5. It gives an empty prompt when the file does not exist.

If check 2 fails, do only the JSON part of check 3. A `doctor` error for a different file is not a failure of check 3. Show it to the user as a note.

Rowbly versions before the current CLI do not have `story search`. If the user names a different command for Rowbly, use that command in all steps.

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
| `stories` | Check worker status, then do the steps in "Assign workers" for each Story in the list. |
| `error` | Tell the user the message. Stop if `.rowbly/` no longer exists. Otherwise, continue to scan. |

## Assign workers

Keep worker records with the Story, Stage, worker ID and result. Save each record immediately after a worker starts or stops.
Use these records on later scans and after a supervisor restart.
Use `scripts/supervisor-policy.mjs` for assignment decisions and report flags. Read [Supervisor policy](references/supervisor-policy.md) for its inputs and record format.
The supervisor supplies the current facts, saves the records and starts the workers. The scanner does none of these actions.
Examine existing harness workers for this Project before each assignment.
Do not assign a second worker to a Story with an active worker, including a worker from another supervisor.

Read the files again on each scan. Users can change them at any time.

1. Run `rowbly -C <root> --json story get <story>`. Skip a Story that no longer exists.
2. Read its current Stage in the config. Skip a Stage that is absent or has `enabled: false`.
3. Read `.rowbly/stages/<KEY>.md`. Stop the factory if the file does not exist.
4. Examine the prompt. Stop for an `invalid` prompt. Skip a `hold` prompt.
5. Skip the Story if a worker for it still runs, even if the Story changed Stage.
6. Skip the Story if its `agentLock.stage` equals its current Stage. Report the lock owner once.
7. Apply the attempt rules below through `evaluateScan`. Save its state before you start a worker.
8. Start a worker for each `start` or `retry` decision. See "Start a worker".
9. Save each new worker through `recordStart`. Preserve the earlier attempt in `history`.
10. Tell the user the Story, the Stage and the worker once per new attempt.

Check the status of recorded workers on each scan. An absent worker is not proof that it stopped.
Record a failure or interruption only after the harness confirms that the worker stopped.
Report each result once. Keep `reported` for results and `startReported` for new attempts.
Save each report flag after you tell the user. Do not use a report flag to decide retry eligibility.

Apply these attempt rules:

- Retry a failed or interrupted `IN_REFINEMENT` attempt on the next later scan after its confirmed stop.
- The scan that first confirms the stop records the result. It does not retry that attempt.
- Use the saved scan counter across supervisor restarts. Do not reset a saved `stoppedScan` on each scan.
- A saved terminal record without `stoppedScan` already confirms an earlier stop. It can retry on the first restart scan.
- Retry without a user request or a Stage change. There is no attempt limit, backoff or extra delay.
- Apply all assignment checks again before each retry. Check existing harness workers from all supervisors of this Project.
- Do not retry a refinement result of `blocked`. This result asks the user for missing information; it is not a worker failure.
- Keep completed attempts and all failed, interrupted or blocked development and review attempts ineligible during the same Stage stay.

After a scan observes a Stage departure, the earlier attempt does not prevent assignment in the new Stage.
An explicit user request can also make the Story eligible again. Keep each earlier attempt and its report flags in `history`.
Do not delete an attempt to clear its assignment restriction.
If a worker still runs after its Story moves, wait for it to stop before assignment in the new Stage.
An external lock can clear between scans. Reconsider the Story on the next scan without a Stage change.
Rowbly locks do not give mutual exclusion. Do not claim that two supervisors cannot race.

## Start a worker

Start one worker for each eligible Story. Use the type of worker from the checklist. If the factory uses threads, start a thread for each worker. Do not change to subagents for one Story.

- Set the title to `<story> <KEY>` if the harness can set a title.
- Use the model and the effort level that the Stage prompt names. If the prompt names none, use the default of the harness.
- If a Stage prompt changes code, give the worker its own Git worktree if the harness can do this. Then Stories in parallel do not change the same checkout. For a thread, use the branch name `<story>-<KEY>` in lower case.
- Give the worker the first message below. Replace each value in angle brackets.
- Get the Project instructions from the `instructions` value of `rowbly -C <root> --json project get-instructions`.
- Before each launch, read the current Story, its Specs if enabled, the Project instructions and the Stage prompt again.
- If the Stage or its prompt changed, apply the assignment checks again before launch. Give each retry a new worker ID.

```markdown
You are a factory worker. Do the work of Stage <KEY> for Story <story>.

Run each Rowbly command as `rowbly -C <root> --json ...`. Do not use a different Project.
A Git worktree has its own copy of `.rowbly/`. Do not change that copy.

Read the Story with `story get` and read its Specs if Specs are on.
Do only the work in the Stage prompt. Move the Story only as the Stage prompt tells you.
Do not change a Stage prompt or the Project config.

When you stop, report the result, the current Stage of the Story and each problem.


## Project instructions

<full text of the current Project instructions>

## Stage prompt

<full text of .rowbly/stages/<KEY>.md>
```

Each scan checks the current Stage. After a worker stops, the supervisor can assign its Story in the next work Stage.

If a thread tool fails when you start a worker, tell the user the error. Then start that worker as a subagent, and use subagents for the next workers.

If a worker fails, is interrupted or reports `blocked`, tell the user once for that attempt. Continue to scan the Stories.
Retry only failed and interrupted refinement attempts, as specified in "Assign workers".

## Stop the factory

Stop the factory if the user tells you to stop, or if a step of this skill tells you to stop.

1. Stop the scanner and its schedule.
2. Keep the worker records for a later restart. Delete only temporary scanner files.
3. Tell the user the reason, and each worker that still runs.

Do not stop a worker that runs if the user does not tell you to stop it.
