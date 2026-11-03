# Remote launches

Use this when `ROWBLY.md` or the user says to start workers on a T3 server that you reach only through
its `t3` CLI, usually on another computer over SSH. The CLI can start and message threads but cannot
set a model's options, so a **launcher** thread on that server starts each worker with its own
`t3_thread_launch`. [`scripts/launch-worker.mjs`](../scripts/launch-worker.mjs) does every step and
checks the result, so do not rebuild them by hand.

It needs Node 22 or later where you run it, SSH that logs in without a prompt, and the `t3` binary's
path on the server. The paths below are relative to this skill's folder. `ROWBLY.md` gives the host,
paths, launcher model and memory floor; this page gives none.

## Launch

```bash
node scripts/launch-worker.mjs launch --key <KEY> --title "<title>" --brief <file> \
  --model-selection '<JSON>' --project <dir> --ssh <host> --t3 <path to t3> \
  [--launcher-title "<title>"] [--launcher-provider <id> --launcher-model <slug>] \
  [--brief-dir <dir>] [--receipt-dir <dir>] [--min-free-gb <n>] [--timeout <seconds>]
```

- `--brief` is the worker's first message, a local file. `--model-selection` is T3's
  `{"instanceId":…,"model":…,"options":[{"id":…,"value":…}]}`.
- `--project` is the checkout on the server; workers start in it (`workspaceStrategy` root,
  `runtimeMode` full-access). A `~` in `--project`, `--t3` or `--brief-dir` means the server's home.
- Leave out `--ssh` to drive a T3 server on this computer.

Each launch is one **request**: the host, project and title, bound to the brief and model selection
it was first run with. The script keeps a **receipt** for it on the computer that runs it, in
`--receipt-dir` (default `~/.rowbly-factory/receipts`): the request, the launchers it was sent to
and, once known, its thread. In order, the script:

1. Reads the receipt. If the title was used with another brief or model, it stops (`conflict`). If the
   receipt names a thread, it verifies that thread (step 7) and starts nothing.
2. Uses the newest thread titled `--launcher-title` (default `Launcher: workers`), or starts one from
   [`assets/launcher.md`](../assets/launcher.md) with `--launcher-provider` and `--launcher-model`,
   and waits until it is idle. To reuse a launcher started some other way, first send it
   `assets/launcher.md` (`t3 thread send --wait <launcherId> -`) and wait for `LAUNCHER-READY`.
3. Looks for this request's thread: in the thread list by title, and in the answers to every earlier
   `LAUNCH` request for the title in the launchers' messages. The list leaves out archived threads;
   the answers do not. If it finds a thread, it verifies it (step 7) and starts nothing. If an earlier
   request has no answer, it stops (`unknown`).
4. Checks free memory when `--min-free-gb` is given.
5. Copies the brief to `<brief-dir>/<KEY>-<hash>.md` on the server (default
   `~/.rowbly-factory/briefs`) and reads it back to compare.
6. Saves the receipt, then sends the launcher one `LAUNCH` request with a fresh id and waits for the
   answer line that carries that id.
7. Whatever the answer, and also when there is none, it checks with `t3 thread show`. Exactly one
   thread may belong to the request, and it must not be archived. It must have the title, the
   requested provider and model, full-access in the project folder (no worktree), and the brief as
   its first message. Then the script asks the launcher for the thread's `t3_thread_configuration`
   (`CONFIG`), because the CLI does not show options, and checks every requested option. The
   receipt records the thread.

Neither the title alone nor the launcher's own answer counts as verification. The launcher's turns
take up a slot on the server, as the worker threads do.

## Results

The script prints one JSON line: `ok`, `status`, `host`, `key`, `title`, `briefSha256`, `receipt`,
and, once a thread is known, `threadId`, `provider`, `model`, `options`, `runtimeMode`, `workspace`,
`launcherId` and `briefPath`, a `reason` when it fails, and a `note` when the launcher answered
oddly but the checks passed.

| `status` | Exit | Meaning | Next |
| --- | --- | --- | --- |
| `launched` | 0 | Started and verified, options included | Use `threadId`. |
| `existing` | 0 | This request's thread was already there and passes every check | Use it; it is the one an earlier call started. |
| `failed`, `error` | 1 | Nothing was started | Fix the `reason`, then run the same command again. |
| `unknown` | 2 | A request may have started a thread that cannot be found or confirmed | Wait, then run the **same** command again. If it stays `unknown`, see Restarting. |
| `conflict` | 2 | Several threads for the request, a thread that differs from it, an archived thread, or a title used for another request | Start nothing for the Story; look at the threads (`t3 thread show`) and tell the user. |
| `unverified` | 2 | The thread passes the CLI checks, but the launcher could not confirm its options | Do not count it as verified; run the same command again later, or tell the user. |

## Retrying, archiving and restarting

- **Retry** with the same command. The title is the request's identity: a second call finds the
  request's thread, from the receipt, the list or the launcher's answers, and never starts another.
  It fails closed: when a request was sent and its outcome cannot be established, it says `unknown`.
- **Archive** a worker only when you are done with it. A later run of its request reports the
  archived thread as a `conflict` and starts nothing.
- **Restart** only with a new request: a new title, for a new Stage visit or attempt (see Titles).
  Do it on purpose: after a `failed` result, an archived worker you no longer want, or a `conflict`
  or lasting `unknown` that you have looked into. Before you restart after `unknown`, read the
  launcher's messages and check that no thread was started for the request.
- Do not edit or delete receipts to get past a result. Without its receipt, a request is found only
  in the current launcher's messages and the thread list.

## Titles

Make each title unique to one request: name the server, the Story Key, the Stage, the attempt and the
time you decided to start it, such as `rook: ROW-12 In Progress 2026-11-02T23:28Z #1`. A Key and
Stage alone are not enough: a later visit to the Stage, or a retry, would find the earlier thread
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

  `send` checks the thread's title, sends nothing when the same message is already in the thread
  (`existing`), and otherwise reports `sent` once the message shows in the thread. If
  `run start` fails, tell the parked worker it is not needed, and start no work in it.
- **The title as the worker**, when `ROWBLY.md` allows it. Run `run start <KEY> --worker "<title>"`
  first, then launch with the full brief. This is safe only when the title is unique to the launch
  (see Titles), because the title is then the only link between the Stage Run and the thread.
