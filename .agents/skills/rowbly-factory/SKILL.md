---
name: rowbly-factory
description: >
  Run a Rowbly factory: watch the Board's In Progress Stage, start one remote worker thread per Story
  that runs rowbly-dev, apply the workers' Board updates, move each Story to In PR when its draft PR
  opens, then merge ready PRs and move their Stories to Done. Use when the user asks to run, start or
  supervise the factory, or to keep picking up In Progress Stories on a remote server.
---

# Rowbly factory

The factory turns the Board into a queue. This thread is the **supervisor**. It owns the Board and
the merges, and never writes product code. Each Story in the in-progress Stage gets one **worker**: a
thread on a remote server that runs the `rowbly-dev` skill
([`../rowbly-dev/SKILL.md`](../rowbly-dev/SKILL.md)) and stops at a draft PR. Read
[the Rowbly reference](../rowbly-dev/references/rowbly-reference.md) before you run any `rowbly`
command.

| Stage key | Who moves a Story there | When |
| --- | --- | --- |
| `in-progress` | the user | the Story is ready for a worker |
| `in-pr` | the supervisor | the worker reports its draft PR |
| `done` | the supervisor | the PR has merged |

## Rules

These rules come from the user. Follow them unless the user changes them in the session.

1. **Workers run on the remote server only**, never on this computer. Default server: `rook`
   (`ssh 192.168.68.62`, alias `ssh-rook`).
2. **At most 4 threads run on the server at once.** That count includes the launcher while it
   runs, and a worker whose thread shows `completed` while its sub-agent still writes to its worktree
   (see [Pitfalls](#pitfalls)). Check `free -h` on the server before each launch, and hold back when
   less than about 6 GB is available.
3. **Worker model:** GPT 6.1 sol at medium reasoning effort (`codex` / `gpt-6.1-sol` /
   `reasoningEffort: medium`), unless the user names another model.
4. **The Board is updated only from this computer.** Workers never run a `rowbly` command that
   changes data. The supervisor applies their updates, lets the Git Plugin commit them on `main` and
   pushes `main`. Workers merge `origin/main` into their branches to get Board changes.
5. **Merge when ready.** A PR is ready when it is mergeable and clean, every check passed, and no
   review requests changes. Mark it ready, merge it with a merge commit (squash is disabled), then move
   its Story to `done`. Merge one PR at a time.
6. **Ask the user** about anything that changes scope: a worker's blocking questions, a base branch
   other than `main`, a PR that conflicts with the user's own PR, or a Story that a worker cannot do
   (for example, a manual check on hardware the server lacks). Never answer them yourself.

## Setup

1. **Control checkout and Data Root.** Work from the repository's main checkout on `main`. In the
   Rowbly repository the command is `pnpm --silent dev … --data-root .rowbly --json --no-prompt`; use
   a shell function, because zsh does not split a variable that holds several options:
   `r() { pnpm --silent dev "$@" --data-root .rowbly --json --no-prompt; }`.
2. **Stages.** Run `rowbly stages list --board <id>`. If there is no `in-pr` Stage, ask the user
   before you add one (`rowbly stages add in-pr --name "In PR" --after in-progress --board <id>
   --level board`).
3. **State folder.** Keep run state outside every checkout:
   `export FACTORY_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/rowbly-factory"`. It holds
   `threads.tsv` (`<KEY><TAB><threadId>`, one line per worker), `queue.txt` (Stories that are blocked
   or waiting for a slot, with the reason), the briefs, and the scripts' `seen.json` and
   `applied.json`.
4. **The server.** The local T3 tools only reach this computer, so drive the server's T3 through its
   CLI over SSH. Non-login SSH shells lack `node` and `pnpm`, so call the binary by its full path:

   ```bash
   T3=~/.t3/runtime/versions/0.1.2/t3          # on the server; check the version folder
   ssh 192.168.68.62 "cd ~/Projects/rowbly && $T3 thread show --json <threadId>"
   ssh 192.168.68.62 "cd ~/Projects/rowbly && $T3 thread send <threadId> -" < message.md
   ssh 192.168.68.62 "cd ~/Projects/rowbly && $T3 thread list --json"
   ```

5. **The launcher.** `t3 thread start` cannot set model options such as reasoning effort. Start one
   launcher thread on the server instead and reuse it. It has the server's own T3 tools, so its
   `t3_thread_launch` call can set the model. Copy each brief to `~/rook-briefs/` on the server first.

   ```bash
   ssh 192.168.68.62 "cd ~/Projects/rowbly && $T3 thread start --json --wait \
     --title 'Launcher: workers' --provider codex --model gpt-6.1-sol . -" < launcher.md
   ```

   `launcher.md` tells it to launch, with `t3_thread_launch`, a thread in this project with
   `workspaceStrategy: {"type":"root"}`, `runtimeMode: "full-access"`, modelSelection
   `{"instanceId":"codex","model":"gpt-6.1-sol","options":[{"id":"reasoningEffort","value":"medium"}]}`,
   the given title, and the brief file's exact contents as the message. It then checks the result with
   `t3_thread_read` and replies with one line, `LAUNCHED <threadId> <provider> <model> <options>` or
   `LAUNCH-FAILED <reason>`. For later launches, send it the next title and brief path with
   `t3 thread send --wait <launcherId> -`. Add the returned id to `threads.tsv`.

6. **The monitor.** Run [`scripts/poll.py`](scripts/poll.py) under the Monitor tool. A Monitor
   expires after 30 minutes: start it again each time it reports that it expired.

## Supervisor loop

Act on each event that `poll.py` prints:

| Event | Action |
| --- | --- |
| `NEW-IN-PROGRESS <KEY>` | [Pick up the Story](#pick-up-a-story). |
| `MARKER <KEY> ROWBLY-UPDATE` | Read the worker's message, then run [`scripts/apply.py <KEY>`](scripts/apply.py) and push `main`. |
| `MARKER <KEY> QUESTIONS FOR USER` | Read the questions. Check any facts they rest on (for example `gh pr view <n> --json baseRefName`). Ask the user, then send the answers to the worker with `t3 thread send`, and add a Comment with the decisions. |
| `MARKER <KEY> DONE` | Apply its update (it moves the Story to `in-pr`), link the PR to this thread, check its screenshots, then [merge it](#merge-and-finish) when it is ready. |
| `STATUS <KEY> completed` with no DONE | Read the last message. If it says that work goes on in a sub-agent, watch the worktree instead (see [Pitfalls](#pitfalls)). |
| `LOWMEM` | Start nothing new until memory recovers. |
| A slot frees up | Start the next Story from `queue.txt` whose blockers have merged. |

Do not wait for the user between events. Report each launch, question, PR, merge and blocker in a
short message.

## Pick up a Story

1. **Read it in full.** Run `stories show`, `specs list --story`, `tasks list`, `comments list`, the
   Epic (`epics show <id>`), and the Story's `plugins` bag, which holds the Story Linking `blocks`
   lists. The name, description, Specs, Tasks, Comments and Epic together are the request.
2. **Check that it can start.**
   - **Blocked:** another Story blocks it and that Story's PR has not merged. Add it to
     `queue.txt` with the reason.
   - **Can't run on the server:** for example, a manual check across macOS, Windows and Linux
     terminals. Ask the user, and record the decision as a Comment on the Story and on the Stories it
     blocks.
   - **Earlier work exists:** its Comments or `git branch -r` show an earlier branch or PR for it.
     The worker reports that and asks.
3. **Check overlap.** Note other running workers that touch the same files, interfaces, ADR numbers
   or docs pages. Also note the base each Story needs: if its dependencies are only on `develop`,
   ask the user.
4. **Write the brief** from [the worker brief](references/worker-brief.md): the overrides, then the
   Epic and the Story's full text. Copy it to `~/rook-briefs/<KEY>.md` on the server.
5. **Launch** through the launcher once there is a free slot. Record the thread id, and tell the user
   the Story, the model and the number of threads running.

## Stacks

When the user asks for a group of Stories (for example one Epic) to land as a stack:

- Order the stack by Story key, unless the blocking links need another order. Each Story must sit
  above every Story that blocks it.
- The bottom PR is based on `main`; each other PR is based on the branch below it. Workers merge the
  lower branch in (never rebase) and put a "Stack" section listing every layer at the top of the PR
  description. Send these rules to running workers and include them in every later brief in the
  group.
- Merge from the bottom up. Branches are not deleted on merge, so after each merge run
  `gh pr edit <next> --base main`.

## Merge and finish

1. **Screenshots.** Every PR needs uploaded screenshots that display. Check each image URL in the
   PR's screenshot comment (`curl -s -o /dev/null -w '%{http_code}'`). The server's browser upload
   does not work. If a worker could not upload, copy its images over with `scp`, look at each one
   (readable, demo data only, no secrets), and publish them with
   [`scripts/upload-screenshots.sh`](scripts/upload-screenshots.sh). Then edit the worker's comment
   and the PR description to show them.
2. **Merge** with [`scripts/merge.sh <pr> <KEY>`](scripts/merge.sh). It waits for GitHub to
   finish computing mergeability and checks. If the PR is clean, every check passed and no review
   requests changes, it marks the PR ready, merges it, moves the Story to `done` and pushes `main`.
   Otherwise it prints `NOT READY` and changes nothing. Merge PRs one at a time, dependencies first.
3. **After a merge**, check CI on `main` (`gh run list --branch main --limit 4`). Tell the running
   workers whose branches overlap to merge `origin/main`, and name the files that changed. Start
   any queued Story that this merge unblocked.

A PR that conflicts with `main`, or with an open PR of the user's, is not ready: ask the user which
lands first. For a rebuild, a fresh worker continues on the same branch and PR; give it the user's
decisions and the list of conflicting files.

## Pitfalls

- **A worker that shows `completed` can still be working.** Codex workers often hand the work to a
  sub-agent and end their own turn. Before you count a slot as free, compare the worktree over a few
  minutes: `git rev-parse HEAD`, `git status --porcelain | md5sum` and `git diff | md5sum`. A worker
  that has gone quiet for 15 minutes without a DONE needs a look.
- **Mergeability reads `UNKNOWN` right after any push to `main`.** That includes your own Board
  commits, so wait for it before you merge.
- **Empty fields in `gh … -q` output** shift whitespace-split fields. Join the fields with `|` and
  read them with `IFS='|'`.
- **zsh quirks:** `"$c:refs/…"` applies the `:r` modifier, so write `"${c}:refs/…"`. A variable that
  holds several options is passed as one word.
- **ADR numbers:** two workers can claim the same next number. Assign them in the briefs, and have
  workers check `origin/main` and the open PR branches again before they open their PRs.
- **Base branches:** check where a Story's dependencies merged (`gh pr view <n> --json
  baseRefName`). Work merged to `develop` is not on `main`.
- **Update blocks** may come without a code fence, and workers sometimes repeat a block that only
  says nothing changed. Read the message before you apply it, and record repeats with
  `apply.py --mark-only <KEY>` instead of adding them as Comments.
