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

1. Run `git status --porcelain`. If it prints nothing, go to step 3.
2. **Clean up.** Someone left uncommitted work here. Read every change (`git diff`, `git diff
   --cached` and each new file). If one must not be committed (a secret, build output, a large
   binary), stop and ask the user. Otherwise:
   - Create a branch `factory-cleanup/<YYYY-MM-DD-HHMM>` at the current commit, commit every change
     on it as one **cleanup commit** whose message sums up the changes, in the repository's commit
     style, and push it.
   - Open a **cleanup PR** against the branch you started on. Its description says what each change
     is and that the factory found it uncommitted at start. Do not merge it.
   - Switch back to the branch you started on.
3. Run `git pull --ff-only`. If it fails (diverged history, no upstream), stop and tell the user.

Tell the user in one line whether the checkout was clean, the cleanup PR if you opened one, and the
commit you pulled to. When workers use another checkout, `ROWBLY.md` says whether and how to update
it.

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

1. **Poll.** Run `rowbly software-factory runs --board <id>` about once a minute, and whenever a
   worker reports. Use the harness's way to wait or watch; do not busy-loop. Re-read
   `software-factory stages` before each start, so a Stage Prompt the user changed or turned off
   takes effect.
2. **Start** each Story whose `stageRun` is `null`, in the order `runs` lists them, while fewer
   workers run than the limit. See [Start a Story](#start-a-story).
3. **Retry** each Story whose Stage Run is `failed`, once: when `attempt` is 1, run
   `run start <KEY> --worker <name> --retry` and start a new worker with the failure reason in its
   brief. Leave it failed after that and tell the user. `ROWBLY.md` or the Stage Prompt may set
   another retry limit; follow it.
4. Leave `finished` Stage Runs alone. The Story is worked again only after it moves to another Stage
   and comes back, or the user clears the Stage Run.
5. **Act on each worker message**, as in [Worker messages](#worker-messages).

Report each start, retry, finish, failure, question and Board change to the user in one short line.

## Start a Story

1. Run `rowbly software-factory run start <KEY> --worker "<name>"`, where `<name>` identifies the
   worker you are about to start (its thread title or id). Start a worker only when this succeeds.
   Exit 4 means another agent already works the Story in this visit, or its Stage Prompt was turned
   off: skip it.
2. Read the Story in full: `stories show`, and for each Plugin that is on, its Specs, Tasks,
   Comments, Epic and Story links.
3. Write the brief from [the worker brief](references/worker-brief.md) and start the worker with the
   worker model, where and how `ROWBLY.md` or the user says.
4. If the worker cannot be started, run `run fail <KEY> --reason "<why>"`.

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
the user. If the Git Plugin commits Rowbly data, push it when `ROWBLY.md` says to.

## Stopping

When the user stops the factory, start nothing new and tell the user which Stage Runs are still
running. Leave them running: the next supervisor takes them over at its start.
