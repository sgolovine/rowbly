---
name: factory
description: Run a factory supervisor that watches the Stories of the current Rowbly Project and starts a worker when a Story changes Stage. Use when the user asks to start, run or supervise the factory of a Rowbly Project.
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

## Watch the Stories

1. Make a new temporary directory outside the Project. The state file is `<temporary directory>/stages.json`.
2. Start the watcher:

   ```sh
   node <skill directory>/scripts/watch-stages.mjs --root <root> --state <state file>
   ```

3. Read each line of its stdout as one event. Use the tool of the harness that streams output, for example `Monitor` in Claude Code.
4. If the harness cannot stream output, add `--once`. Then run the command again on a schedule of about 30 seconds.
5. If the stream ends because of a time limit, start the watcher again with the same state file. The new run reports the changes that it did not see.

Rowbly has no command that watches Stories. The watcher compares the Stage of each Story with its last snapshot. A new Story is not a Stage change.

| Event          | Action                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `watching`     | Tell the user that the factory runs.                                                                  |
| `stage-change` | Do the steps in "Handle a Stage change".                                                              |
| `error`        | Tell the user the message. If `.rowbly/` no longer exists, stop the factory. Otherwise, continue to watch. |

## Handle a Stage change

Do these steps for each `stage-change` event. Read the files again each time, because users can change them at any time.

1. Run `rowbly -C <root> --json get-story <story>`. If its `stage` is not the `to` value of the event, ignore the event. A different event reports the new Stage.
2. Read the Stage in the config. If the Stage is not in the config or has `enabled: false`, the prompt is not active. Take no action.
3. Read `.rowbly/stages/<KEY>.md`. If the file does not exist, stop the factory.
4. Examine the prompt. If it is `invalid`, stop the factory. If it is `hold`, take no action.
5. If a worker for this Story still runs, hold the event. When the worker stops, do these steps again from step 1.
6. Start the worker. See "Start a worker".
7. Tell the user the Story, the Stage and the worker.

## Start a worker

Start one worker for each event. Use the type of worker from the checklist. If the factory uses threads, start a thread for each worker. Do not change to subagents for one Story.

- Set the title to `<story> <KEY>` if the harness can set a title.
- Use the model and the effort level that the Stage prompt names. If the prompt names none, use the default of the harness.
- If a Stage prompt changes code, give the worker its own Git worktree if the harness can do this. Then Stories in parallel do not change the same checkout. For a thread, use the branch name `<story>-<KEY>` in lower case.
- Give the worker the first message below. Replace each value in angle brackets.
- Get the Project instructions from the `instructions` value of `rowbly -C <root> --json get-instructions`.

```markdown
You are a factory worker. Do the work of Stage <KEY> for Story <story>.

Run each Rowbly command as `rowbly -C <root> --json ...`. Do not use a different Project.
A Git worktree has its own copy of `.rowbly/`. Do not change that copy.

Read the Story with `get-story` and read its Specs if Specs are on.
Do only the work in the Stage prompt. Move the Story only as the Stage prompt tells you.
Do not change a Stage prompt or the Project config.

When you stop, report the result, the current Stage of the Story and each problem.


## Stage prompt

<full text of .rowbly/stages/<KEY>.md>
```

A move by a worker is a Stage change. The watcher reports it, and the supervisor starts the worker for the next Stage.

If a thread tool fails when you start a worker, tell the user the error. Then start that worker as a subagent, and use subagents for the next workers.

If a worker fails or reports `blocked`, tell the user. Do not start the worker again. Continue to watch the Stories.

## Stop the factory

Stop the factory if the user tells you to stop, or if a step of this skill tells you to stop.

1. Stop the watcher.
2. Delete the temporary directory.
3. Tell the user the reason, and each worker that still runs.

Do not stop a worker that runs if the user does not tell you to stop it.
