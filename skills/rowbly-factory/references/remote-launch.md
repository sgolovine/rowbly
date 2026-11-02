# Remote launches

Use this when `ROWBLY.md` or the user says to start workers on a T3 server that you reach only through
its `t3` CLI, usually on another computer over SSH. The CLI can start and message threads but cannot
set a model's options, so a **launcher** thread on that server starts each worker with its own
`t3_thread_launch`. [`scripts/launch-worker.mjs`](../scripts/launch-worker.mjs) does every step and
checks the result, so do not rebuild them by hand.

It needs Node 22 or later where you run it, SSH that logs in without a prompt, and the `t3` binary's
path on the server. The paths below are relative to this skill's folder. `ROWBLY.md` gives the host, paths, launcher model and memory floor; this page
gives none.

## Launch

```bash
node scripts/launch-worker.mjs launch --key <KEY> --title "<title>" --brief <file> \
  --model-selection '<JSON>' --project <dir> --ssh <host> --t3 <path to t3> \
  [--launcher-title "<title>"] [--launcher-provider <id> --launcher-model <slug>] \
  [--brief-dir <dir>] [--min-free-gb <n>] [--timeout <seconds>]
```

- `--brief` is the worker's first message, a local file. `--model-selection` is T3's
  `{"instanceId":…,"model":…,"options":[{"id":…,"value":…}]}`.
- `--project` is the checkout on the server; workers start in it (`workspaceStrategy` root,
  `runtimeMode` full-access). A `~` in `--project`, `--t3` or `--brief-dir` means the server's home.
- Leave out `--ssh` to drive a T3 server on this computer.

In order, the script:

1. Lists the server's threads. If one already has the title, it verifies that thread (step 6) and
   starts nothing.
2. Checks free memory when `--min-free-gb` is given.
3. Copies the brief to `<brief-dir>/<KEY>-<hash>.md` on the server (default
   `~/.rowbly-factory/briefs`) and reads it back to compare.
4. Uses the newest thread titled `--launcher-title` (default `Launcher: workers`), or starts one from
   [`assets/launcher.md`](../assets/launcher.md) with `--launcher-provider` and `--launcher-model`.
   It waits until the launcher is idle, then lists the titles again. To reuse a launcher started
   some other way, first send it `assets/launcher.md` (`t3 thread send --wait <launcherId> -`) and
   wait for `LAUNCHER-READY`.
5. Sends the launcher one `LAUNCH` request with a fresh id and waits for the answer line that
   carries that id.
6. Whatever the answer, and also when there is none, it lists the threads itself. Exactly one thread
   may have the title. That thread must have the requested provider and model, run full-access in the
   project folder (no worktree), and have a first message whose sha256 matches the brief. Then it
   asks the launcher for the thread's `t3_thread_configuration` (`CONFIG`), because the CLI does not
   show options, and checks every requested option.

Neither the title alone nor the launcher's own answer counts as verification. The launcher's turns
take up a slot on the server, as the worker threads do.

## Results

The script prints one JSON line: `ok`, `status`, `host`, `key`, `title`, `briefSha256`, and, once a
thread is known, `threadId`, `provider`, `model`, `options`, `runtimeMode`, `workspace`, `launcherId`
and `briefPath`, a `reason` when it fails, and a `note` when the launcher answered oddly but the checks
passed.

| `status` | Exit | Meaning | Next |
| --- | --- | --- | --- |
| `launched` | 0 | Started and verified, options included | Use `threadId`. |
| `existing` | 0 | A thread with the title was already there and passes every check | Use it; it is the one an earlier call started. |
| `failed`, `error` | 1 | Nothing was started | Fix the `reason`, then run the same command again. |
| `unknown` | 2 | A request was sent, but no thread with the title is visible yet | Wait, then run the **same** command again. |
| `conflict` | 2 | Several threads have the title, or the one there differs from the request | Start nothing for the Story; look at the threads (`t3 thread show`) and tell the user. |
| `unverified` | 2 | The thread passes the CLI checks, but the launcher could not confirm its options | Do not count it as verified; ask the launcher again or tell the user. |

**Retrying.** The title is the request's identity, so a retry is always the same command with the
same title. A second call starts nothing while a thread has the title, and it waits for a busy
launcher before it looks. Never change the title to get past `unknown` or `conflict`. The thread
list leaves out archived threads, so archive a worker only when you are done with it, and never run
its launch again after that.

## Titles

Make each title unique to one launch: name the server, the Story Key, the Stage, the attempt and the
time you decided to start it, such as `rook: ROW-12 In Progress 2026-11-02T23:28Z #1`. A Key and
Stage alone are not enough. A later visit to the Stage, or a retry, would find the earlier thread
and report it as `existing` or `conflict`.

## The Stage Run comes first

Record the Stage Run before a worker starts on the Story. There are two ways:

- **Park, then GO**, when the Stage Run's `--worker` must be the thread id. Launch with a short
  reservation as the brief ("You are reserved for <KEY>. Do nothing. Reply RESERVED <KEY> and wait for
  GO."). Then run `run start <KEY> --worker <threadId>`, and only when it succeeds, send the full brief
  with GO:

  ```bash
  node scripts/launch-worker.mjs send --thread <threadId> --title "<title>" --message <file> \
    --project <dir> --ssh <host> --t3 <path to t3>
  ```

  `send` checks the thread's title, sends nothing when a message with the same sha256 is already in
  the thread (`existing`), and otherwise reports `sent` once the message shows in the thread. If
  `run start` fails, tell the parked worker it is not needed, and start no work in it.
- **The title as the worker**, when `ROWBLY.md` allows it. Run `run start <KEY> --worker "<title>"`
  first, then launch with the full brief. This is safe only when the title is unique to the launch
  (see Titles), because the title is then the only link between the Stage Run and the thread.
