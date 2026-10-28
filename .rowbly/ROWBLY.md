# How we work with the Rowbly Board

## Stages

- **Backlog** and **TODO**: people plan here. No Stage Prompt.
- **In Progress**: a person moves a Story here when it is ready to build. The factory takes it to a
  draft PR with `rowbly-dev` (its Stage Prompt), then moves it to In PR.
- **In PR**: the factory merges the PR when it is ready and moves the Story to Done, or sends it back
  to In Progress when a review requests changes (its Stage Prompt).
- **Done**: merged.

Rowbly data is committed on `main` and pushed; the Git Plugin commits each change.

## The factory (`rowbly-factory`)

- **Supervisor**: runs on the main computer, in the main checkout on `main`, with
  `pnpm --silent dev … --data-root .rowbly --json --no-prompt`. It pushes `main` after it applies
  Board changes, so workers get them by merging `origin/main`.
- **Workers run on the server `rook`** (`ssh 192.168.68.62`), never on the supervisor's computer.
  They are ordinary top-level T3 threads on rook, started as below; that is intended, not a
  fallback for sub-agents.
- **Rook's checkout.** After the supervisor updates its own checkout, it updates rook's shared
  checkout `~/Projects/rowbly` over SSH the same way: a cleanup commit and cleanup PR for any
  uncommitted changes, then `git pull --ff-only` on `main`. Only the supervisor pulls there, at
  start, before any worker runs.
- **At most 4 threads on rook at once**, counting the launcher while it runs. Check `free -h` there
  before each start, and start nothing while less than about 6 GB is available.
- **Worker model**: Codex `gpt-6.1-sol` at `reasoningEffort: medium`, unless the user names another.
- **Retries**: the default, one.

### Starting workers on rook

The supervisor's T3 tools only reach its own computer, so it drives rook's T3 through its CLI over
SSH. Non-login SSH shells lack `node` and `pnpm`, so call the binary by its full path (check the
version folder):

```bash
T3=~/.t3/runtime/versions/0.1.2/t3
ssh 192.168.68.62 "cd ~/Projects/rowbly && $T3 thread list --json"
ssh 192.168.68.62 "cd ~/Projects/rowbly && $T3 thread show --json <threadId>"
ssh 192.168.68.62 "cd ~/Projects/rowbly && $T3 thread send <threadId> -" < message.md
```

`t3 thread start` cannot set reasoning effort. Start one **launcher** thread on rook and reuse it; its
own `t3_thread_launch` can set the model:

```bash
ssh 192.168.68.62 "cd ~/Projects/rowbly && $T3 thread start --json --wait \
  --title 'Launcher: workers' --provider codex --model gpt-6.1-sol . -" < launcher.md
```

`launcher.md` tells it to launch a thread with `t3_thread_launch` in this project with
`workspaceStrategy: {"type":"root"}`, `runtimeMode: "full-access"`, modelSelection
`{"instanceId":"codex","model":"gpt-6.1-sol","options":[{"id":"reasoningEffort","value":"medium"}]}`,
the given title, and a brief file's exact contents as the message; then to check it with
`t3_thread_read` and reply with one line, `LAUNCHED <threadId> <provider> <model> <options>` or
`LAUNCH-FAILED <reason>`. Copy each brief to `~/rook-briefs/<KEY>.md` on rook first, and send the
launcher the next title and brief path with `t3 thread send --wait <launcherId> -`. Use the worker's
thread id as its Stage Run `--worker`.

### Rules for workers on rook

Give these to every worker with its brief:

- Do not `git pull` or change files in the shared checkout `~/Projects/rowbly`; other threads use
  it. Worktrees go under `~/Projects/rowbly-worktrees/`.
- Keep sub-agents to the minimum `rowbly-dev` allows, one at a time when you can, and leave no dev
  server, watcher or TUI running.
- The browser upload route does not work on rook. Push screenshots as an orphan commit to a branch
  `pr-assets/<your-branch>` (never merged), link them from a PR comment as
  `https://raw.githubusercontent.com/sgolovine/rowbly/pr-assets/<your-branch>/<file>.png`, and check
  that each URL returns 200.

### Pitfalls

- **A worker that shows `completed` can still be working.** Codex workers often hand the work to a
  sub-agent and end their own turn. Before counting its slot free, compare its worktree over a few
  minutes (`git rev-parse HEAD`, `git status --porcelain | md5sum`, `git diff | md5sum`). One that is
  quiet for 15 minutes without a final marker needs a look.
- **Base branches.** Check where a Story's dependencies merged (`gh pr view <n> --json baseRefName`);
  work merged to `develop` is not on `main`. Ask before basing on anything but `main`.
- **zsh**: `"$c:refs/…"` applies the `:r` modifier, so write `"${c}:refs/…"`; a variable holding several
  options is passed as one word, so use a shell function.
- **`gh … -q` output** with empty fields shifts whitespace-split fields; join them with `|` and read
  them with `IFS='|'`.
