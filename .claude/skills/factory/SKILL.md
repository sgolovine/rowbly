---
name: factory
description: Run a factory supervisor that watches the Stories of the current Rowbly Project and assigns workers to unassigned Stories in active work Stages. Use when the user asks to start, run or supervise the factory of a Rowbly Project.
---

# Factory

Use the native factory first. The native manager runs its own Pi supervisor and workers outside the harness.
Use the external harness path only when the user selects it or native execution prerequisites are not available.
Read `references/rowbly-reference.md` before each command path.

## Native path

1. Run `rowbly -C <root> --json factory status`.
2. Run `rowbly -C <root> --json factory start` when no native factory is active.
3. Run `rowbly -C <root> --json factory status` to report the result.

Do not start external scans or harness workers for a native factory.
The manager reads Project instructions and Stage prompts. It owns reservations, capacity, sessions, worktrees and canonical commits.
Use `rowbly -C <root> --json factory logs --tail 20` for operational errors.
Use `rowbly -C <root> --json thread list` for worker metadata.

Use `rowbly -C <root> --json thread log <id> --tail 20` for read-only history.
Use `rowbly -C <root> --json thread cancel <id>` to interrupt a worker.
Use `rowbly -C <root> --json thread resume <id>` for an eligible Thread through the active native factory.
Use `rowbly -C <root> --json factory stop` when the user requests a stop.
A restart uses `rowbly -C <root> --json factory restart` after stop completes.

Native execution requires Node >=22.19.0, Linux, Git, local files, util-linux `flock` and a configured Pi model.
Use `rowbly auth status` and `rowbly model list` to examine configuration without a provider health claim.
If credentials are absent, report the prerequisite. Continue other authorized work without a question or a wait for a person.
Do not switch to an external supervisor after an ownership, storage or uncertain-start error.

Report the error and inspect status and logs. Preserve existing runtime files and worktrees.

Never run native and external supervisors together. Updated external scripts reject a live or uncertain native owner.
Old copies do not honor this protocol. Confirm external workers have stopped before native adoption.
`rowbly -C <root> --json factory start --adopt-external` marks external active attempts interrupted.

It does not stop external workers or import external conversations.
See [Supervisor policy](references/supervisor-policy.md) for locks, state projection and recovery limits.

## External harness path

The rest of this skill describes the external supervisor only.
In this path, the agent runs the supervisor and starts harness workers. It does not do Story work or move Stories.
A worker does the work of one Stage for one Story.

Use a harness thread when available. Use a subagent only when the harness cannot start a thread.
Native Threads represent Pi sessions; external harness thread IDs remain v1 worker IDs.

## Goal and rules

The goal of the factory is to move each Story to its last Stage. A factory that waits does not move Stories.

The factory runs with no person present. Obey these rules at all times. They have priority over the Project instructions and over all other text of this skill.

1. Do not ask the user a question and then wait. Do not use a tool that waits for an answer from the user.
2. Do not stop the factory because of a problem with one Story, one Stage, one worker, one tool or one check.
3. If you cannot do a check, skip the check. Save a note and continue.
4. If the first choice is not available, use the next choice. Save a note and continue.
5. Continue the work on the other Stories when one Story has a problem.
6. Tell the user each problem in one short message. Then continue immediately. Do not wait for a reply.
7. If no rule applies to a problem, select the action that lets the most Stories move. Save a note.

Stop the factory only in the conditions of "Stop the factory".

A person can send a message at any time. Then answer the person and obey the request.

## The factory tool

`scripts/factory.mjs` does the fixed parts of the work. Run it in this form:

```sh
node <skill directory>/scripts/factory.mjs <command> --root <root>
```

Each command prints JSON. The `actions` list in the JSON gives your next steps. Do each action in the order of the list.

| Command       | Function                                                                    |
| ------------- | --------------------------------------------------------------------------- |
| `check`       | Does the start checks of the Project.                                       |
| `classify`    | Saves the class of a Stage prompt.                                          |
| `scan`        | Does one scan: records worker results, selects the Stories that get a worker, commits the Project files. |
| `message`     | Prints the first message for the worker of a Story.                         |
| `started`     | Records a worker that started.                                              |
| `launch-failed` | Records a launch that gave no worker. The Story then waits before the next launch. |
| `release`     | Makes a parked Story eligible again.                                        |
| `note`        | Saves a note that each scan shows.                                          |
| `commit`      | Commits the Project files. `scan` does this automatically.                  |
| `reset-state` | Moves a state file that is not valid out of the way.                        |

If a command fails, it prints `error` and `actions`, and exits with 1. Do those actions. A failed command does not stop the factory.

Put an option value that has spaces in quotes, for example `--worker "thread-1=completed=changes required"`.

The tool saves the state of the factory in `<root>/.rowbly/state.json`. Do not edit this file. Do not stage or commit it.

If the user names a different command for Rowbly, add `-- <command>` to the `check` command. The tool saves it for the later commands.

## Start the external factory

Do these five steps one time, when the user starts the factory. Do not start a test worker.

### Step 1: Project checks

1. Run `factory.mjs check`. Without `--root`, it finds the nearest `.rowbly/` at or above the current directory.
2. Do each action in `actions`. For a new Project, the actions tell you to classify each Stage prompt.
3. Run `check` again until `result` is `pass` or `fail`.

Put each Stage prompt in one of these classes:

- `work`: the prompt tells an agent to do a specific action on a Story.
- `hold`: the prompt tells agents clearly to do no work on a Story in this Stage.
- `invalid`: the prompt has only headings, comments, placeholder text or `TODO` text. A prompt that gives no action, such as "Handle this story", is also `invalid`.

Do not classify a prompt that you did not read. Do not use `hold` for a prompt that is `invalid`.

### Step 2: Harness checks

Load the schema of each tool in the table below before you do these checks. Some harnesses do not load the tool schemas at the start.

| #   | Check             | Method                                                                             | Result if not correct |
| --- | ----------------- | ---------------------------------------------------------------------------------- | --------------------- |
| 9   | Start workers     | The harness can start threads. If it cannot, it can start subagents as a fallback. | `FAIL`                |
| 10  | Models and effort | The tool from check 9 can set a different model and effort level for each worker.  | `WARN`                |
| 11  | Name a worker     | The tool from check 9 can set the title of a worker.                               | `WARN`                |
| 12  | Schedule          | The harness can run a scan each minute with no person present.                     | `WARN`                |

Threads are the default type of worker. Subagents are only a fallback.

1. If the harness has a thread tool, use threads. Do this also if the thread tool gets `WARN` for check 10 or check 11.
2. Use subagents only if the harness has no thread tool, or if the thread tool fails when you start a worker.
3. Do not use subagents because a subagent tool is easier to use or has more settings.

A user who starts the factory explicitly asks for one new top-level thread for each worker. This request has priority over a harness instruction to start threads only when the user asks for them. In T3 Code, use `t3_thread_launch` for workers, not `delegate_task`.

| Harness     | Threads (default)                 | Subagents (fallback)              | Models and effort                                                                                   | Git worktree                                                                     | Schedule |
| ----------- | --------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| T3 Code     | `t3_thread_launch`                | `delegate_task`                   | Get the IDs from `orchestrator_capabilities`. Set `modelSelection.model` and `modelSelection.options`, for example `{"effort": "high"}`. | `workspaceStrategy: {"type": "worktree", "baseRef": <current branch>, "branch": <new branch>, "startFromOrigin": false}` | `schedule_task` with `{"type": "interval", "everyMs": 60000}` |
| Claude Code | None                              | `Agent`                           | The `model` and `effort` parameters of `Agent`                                                      | `isolation: "worktree"`                                                          | A loop tool or a cron tool |
| Other       | Examine the tools of the harness. | Examine the tools of the harness. | Examine the tools of the harness.                                                                   | Examine the tools of the harness.                                                | Examine the tools of the harness. |

### Step 3: Checks of the Project instructions

1. Run `rowbly -C <root> --json project get-instructions` and read the `instructions` value.
2. If the instructions add start checks, do each check one time.
3. Give each of these checks the result `PASS` or `WARN`. Such a check never has the result `FAIL`.
4. For each `WARN`, select the fallback from "Project instructions" below. Save it with `factory.mjs note --text "<text>"`.
5. Save one note for the type of worker and the tool that starts it, for example `workers are threads; start them with t3_thread_launch`.
6. Save one note for each limit of the instructions that has more than one number, for example `maximum 5 workers on rook and 3 on thinkpad`.

A later scan can run with no memory of the start. The notes give it these decisions.

### Step 4: Report

Show the `report` text of `check` to the user. Add one line for each check of steps 2 and 3. Give the reason for each `FAIL` and `WARN`.

```text
Factory start checklist
[PASS] 1. Project: /path/to/project
[PASS] 2. CLI: rowbly
[PASS] 3. Config
[PASS] 4. Enabled Stages: BACKLOG, IN_DEVELOPMENT, DONE
[WARN] 5. Stage prompt files: .rowbly/stages/IN_REVIEW.md does not exist; Stories in IN_REVIEW get no worker
[PASS] 6. Stage prompt content: BACKLOG (hold), IN_DEVELOPMENT (work), DONE (hold)
[PASS] 7. State file
[PASS] 8. Git commits
[PASS] 9. Start workers: threads
[PASS] 10. Models and effort
[WARN] 11. Name a worker: this harness cannot set a title
[PASS] 12. Schedule
[WARN] Project instructions: the usage report is not available; workers use the first model of the instructions
Result: started, with 3 warnings.
```

A `WARN` never prevents the start. Tell the user and continue.

For a `FAIL`, try the repair in this table one time. Then do the checks again.

| Check                   | Repair                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| 1. Project              | Run `check` with the `--root <dir>` that the action or the user names. |
| 2. CLI                  | Do "The Rowbly command fails" in the problems table.                |
| 3. Config               | Run `rowbly -C <root> --json doctor --fix`.                         |
| 4. Enabled Stages       | No repair.                                                          |
| 6. Stage prompt content | No repair. The Project has no Stage with a `work` prompt.           |
| 9. Start workers        | No repair. The harness cannot start threads or subagents.           |

If a `FAIL` stays after the repair, the factory cannot run. Tell the user the check, the file and the repair. Do not start the scans.

If the factory uses subagents, give the reason in check 9, for example `[PASS] 9. Start workers: subagents (fallback: this harness cannot start threads)`.

### Step 5: Schedule the scans

1. Do "One scan" immediately. Give the total limit of workers one time, as `--max-active <n>`. The tool keeps it for the later scans.
2. Make a schedule that does one scan each minute, with the tool from the table in step 2.
3. Use this text as the message of the schedule. Replace each value in angle brackets:

   ```text
   Continue the factory of <root>. Read "One scan" in <skill directory>/SKILL.md and do one scan. Do not do the start checks again.
   ```

4. Tell the user that the factory runs.

If the harness has no schedule tool, use the first method in this list that the harness can do:

1. Run `while true; do echo scan; sleep 60; done` in the background. Do one scan for each line of its output.
2. Do one scan, then run `sleep 60`. Repeat these two steps without an end.

## One scan

1. Run `node <skill directory>/scripts/factory.mjs scan --root <root>`.
2. If the output has `needStatus`, get the status of each worker in that list. See "Worker status".
3. Then run the `scan` command from `actions`. It has one `--worker <id>=<status>=<result>` for each worker.
4. Read `notes` in the output. Obey each note in this scan.
5. Do each action in `actions`, in the order of the list.
6. End the scan. If the scan had no action, write a maximum of one short line.

To change the limit of workers, add `--max-active <n>` to one scan. The tool keeps the last value and shows it as `maxActive`.

After 10 scans with no work, an action tells you to make the schedule slower. A later action tells you to make it fast again. If the harness cannot change the schedule, do nothing for these two actions.

Do not read the Stories, the config or the state file yourself for a scan. The `scan` command reads them.

The output of `scan` has these values:

| Value     | Contents                                                                                     |
| --------- | -------------------------------------------------------------------------------------------- |
| `actions` | Your next steps, in order.                                                                   |
| `start`   | The Stories that get a worker now, with the `branch` for a worktree. `previous` shows the earlier worker of a Story that did not move. |
| `waiting` | The Stories that get a worker later, each with the reason.                                   |
| `active`  | The workers that run.                                                                        |
| `parked`  | The Stories that get no worker until a person does an action. See "Rules of the scan".       |
| `notes`   | The notes that you saved.                                                                    |
| `commit`  | The result of the commit of the Project files.                                               |

### Worker status

Get the status of a worker from the harness. Give the status name of the harness to `--worker`. The tool knows these names:

| Status of the harness                                      | Meaning for the factory             |
| ---------------------------------------------------------- | ----------------------------------- |
| `running`, `starting`, `queued`, `preparing`, `waiting`, `idle` | The worker runs.               |
| `completed`, `done`                                        | The worker stopped normally.        |
| `failed`, `error`                                          | The worker stopped with an error.   |
| `interrupted`, `cancelled`, `rolled_back`                  | A person or the harness stopped the worker. |

Use these rules for special conditions:

- A status has no result. `--worker thread-1=running` is correct.
- If `needStatus` shows a `machine` for the worker, ask the harness of that machine.
- If the harness of the correct machine says that the worker does not exist, give the status `not_found`.
- If the call to the harness fails, give the status `unknown`. The worker then counts as a worker that runs.
- If the worker waits for an answer or an approval, do "A worker waits for an answer" in the problems table.

For a worker that stopped normally, read its last message. The last line has the form `RESULT: <result>`. Give that result, for example `--worker "mcp:1234=completed=changes required"`. If the message has no such line, give no result.

In T3 Code, `t3_thread_read` gives the `status` of a thread and its last messages. A `pendingRequestCount` above 0 shows a worker that waits for an answer.

## Start a worker

Do these steps for each `Start a worker` action. Start all workers of one scan before you end the scan.

1. Select the model, the effort level and the machine. Use the Stage prompt first, then the Project instructions and the notes, then the default of the harness.
2. Run `factory.mjs message --root <root> --story <story>`. Its output is the first message of the worker.
3. If the command fails, do not start this worker. Continue with the next action.
4. Start the worker with the type of worker from the notes. Give it the message with no changes.
5. Set the title to the Story ID, a space and the key of the Stage, for example `ROW-07 IN_REVIEW`.
6. If the Stage prompt changes code, give the worker its own Git worktree if the harness can do this.
7. For that worktree, use the `branch` value of the Story in `start`. This branch is new for each worker.
8. Run `factory.mjs started --root <root> --story <story> --worker-id <id> --model <model>` immediately after the launch.
9. Add `--machine <name>` if the Project uses more than one machine. Add `--type subagent` for a subagent.
10. Tell the user the Story, the Stage and the worker.

The `branch` only gives the worker a worktree of its own. The skill of the Stage selects the branch for the work of the Story.

If `previous` shows a worker that failed, use a different model for the new worker when the Project instructions let you.

If the launch fails, do these steps in order. Stop at the first step that starts the worker.

1. Start the worker again one time with the same values.
2. Start the worker with the next model that the Project instructions name, or the default model of the harness.
3. Start the worker on a different machine, if the Project uses more than one machine.
4. Start the worker as a subagent. Then use subagents for the next workers, and save a note.
5. Run `factory.mjs launch-failed --root <root> --story <story> --error "<error text>"`. Do its actions.

After `launch-failed`, the Story waits before its next launch: 2 minutes, then 4, to a maximum of 60. A later scan gives the start action again.

When a fallback of steps 2 to 4 starts the worker, save a note. Use the same fallback first for the next workers.
Do not try the first choice again for each worker. The action `Try the first choice of each note again` tells you when to try it.

Do not start a second worker for a Story. If `started` fails because the Story has a different active worker, stop the new worker in the harness.

## Project instructions

The Project instructions can name models, machines, limits and checks. Follow them when you can. They do not stop the factory and they do not make the factory wait for a person.

| Condition                                                                              | Action                                                                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| An instruction tells you to do a check, and the tool or the data is not available.     | Skip the check. Use the first choice of the instructions. Save a note.                  |
| The first choice does not work, for example a model, a machine or a type of worker.    | Use the next choice of the instructions, then the default of the harness. Save a note.  |
| An instruction sets a limit, for example a maximum number of workers.                  | Obey the limit. Give it to `scan` as `--max-active`. Stories that wait are not a problem. |
| An instruction tells you to ask the user or to wait for the user.                      | Do not ask and do not wait. Make the decision, save a note and tell the user.           |

Example: the instructions tell you to read the remaining usage before each new worker, and the harness does not show the usage. Do not stop and do not ask. Use the first model of the instructions. Save the note `usage report not available; workers use <model>`. If a worker then fails, the launch steps select the next model.

### Notes

A note keeps a decision across scans and across a restart of the supervisor. Save a note with `factory.mjs note --root <root> --text "<text>"`. Each `scan` shows all notes in `notes`. Obey them.

When `scan` gives the action `Try the first choice of each note again`, do these steps:

1. Try each first choice one time, for example connect to the machine or read the usage report.
2. Run `factory.mjs note --root <root> --clear`.
3. Save a note again for each fallback that is still necessary.

## Problems

Do the action for the problem. Then continue the scan. None of these problems stops the factory.

| Problem | Action |
| ------- | ------ |
| A worker waits for an answer | Answer through the harness: `No person is available. Make the decision yourself, write it in the Assumptions section of the Story, and continue.` Give the worker the status `running`. If the same worker asks a second time, interrupt it through the harness. |
| A worker waits for an approval | Approve the action if it is a part of the work of the Story and it does not destroy data. If not, refuse it and tell the worker to continue in a different way. |
| A worker that does not stop | `scan` names a worker that ran for 90 minutes. Read its last activity in the harness. If it had activity in the last 30 minutes, do nothing. If not, interrupt the worker through the harness. A later scan starts a new worker. |
| The Rowbly command fails | Try the command that the Project instructions or the repository instructions name. If the repository builds Rowbly, build it again as its instructions specify. Run `check` with `-- <command>` for a command that works. If none works, tell the user one time. Continue the scans. The tool tells you when to try again. |
| A Story file is not valid | Run `rowbly -C <root> --json doctor --fix` one time. If Rowbly still cannot read the file, tell the user one time. The other Stories continue. |
| A parked Story | Tell the user one time, as the action tells you. Do not start a worker for it. Continue with the other Stories. |
| A Stage prompt is missing or `invalid` | Tell the user one time, as the action tells you. Do not write a Stage prompt. The Stories of the other Stages continue. |
| The commit of the Project files did not complete | Tell the user one time, as the action tells you. `scan` tries again on each scan. Do not reset, discard or amend in Git. |
| The state file is not valid | Run `factory.mjs reset-state --root <root>`. It keeps the valid records. Do its actions, so that no Story gets a second worker. |
| A different external supervisor works on the same Project | Add `--busy <story>` to `scan` for each Story that has a worker of the other supervisor. |
| A user tells you to try a parked Story again | Run `factory.mjs release --root <root> --story <story>`. |
| A problem that this table does not show | Obey rule 7 of "Goal and rules". |

## Rules of the scan

The `scan` command applies these rules. You do not apply them yourself. Use them to answer the user. [Supervisor policy](references/supervisor-policy.md) has the full rules and the format of the state file.

- A Story in a Stage with a `work` prompt gets one worker. A Story does not have to change Stage to get a worker.
- A Story with a worker that runs gets no second worker, also if the Story changed Stage.
- When a worker stops and its Story moved, the Story gets a worker for its new Stage in the same scan.
- When a worker stops and its Story did not move, the Story gets a new worker on the next scan. The first message tells the new worker about the earlier worker.
- When a worker fails or is interrupted, the Story gets a new worker on the next scan. Each later failure in a row doubles the delay, from 2 minutes to a maximum of 60 minutes. Failures have no limit.
- A maximum of 4 workers can stop normally for one Story in one Stage. Then `scan` parks the Story.
- A parked Story gets a worker again after a person changes the Story, moves the Story or asks for a release.
- A Story that reaches a Stage with a `hold` prompt starts from zero if it comes back.
- With `--max-active`, the Stories nearest to the last Stage get a worker first.
- The Stories of a Stage with a missing, `invalid` or changed prompt wait. All other Stories continue.
- A Story with a file that Rowbly cannot read waits. All other Stories continue.
- After a launch that failed, the Story waits 2 minutes, then twice as long each time, to a maximum of 60 minutes.
- After each scan, the command commits the changed files of `<root>/.rowbly/`, but not `state.json`. It does not push.

Workers write the Project files through `rowbly -C <root>` under the shared write lock. The first message gives them the lock path. Their source commits stay in their own worktrees.

## Stop the factory

For the native path, use `rowbly -C <root> --json factory stop`. The steps below apply to the external path.

Stop the factory only in these conditions:

- The user tells you to stop.
- `<root>/.rowbly/` no longer exists.
- A `FAIL` of the start checks stays after its repair. This condition applies only before the first scan.

To stop the factory, do these steps:

1. Stop the schedule or the loop.
2. Tell the user the reason, and each worker that still runs.

Do not stop a worker that runs if the user does not tell you to stop it. The exception is a worker without activity, in the problems table.

Keep `.rowbly/state.json`. The next start of the factory continues from it.
