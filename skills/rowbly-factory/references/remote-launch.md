# Remote launches

Use this when `ROWBLY.md` or the user says to start workers on a T3 server that you reach only through
its `t3` CLI, usually on another computer over SSH. The CLI can start and message threads but cannot
set a model's options, so a **launcher** thread on that server starts each worker with its own
`t3_thread_launch`. [`scripts/launch-worker.mjs`](../scripts/launch-worker.mjs) does every step and
checks the result, so do not rebuild them by hand. Its `prepare-checkout` command updates a
checkout before it runs workers.

It needs Node 22 or later where you run it, SSH that logs in without a prompt, and the `t3` binary's
path on the server. The paths below are relative to this skill's folder. `ROWBLY.md` gives the host,
paths, launcher model and memory floor; this page gives none.

## Prepare a checkout

Update a checkout before it runs workers, as the skill's Update the checkout section says, in one
call:

```bash
node scripts/launch-worker.mjs prepare-checkout --project <dir> --rowbly '<command>' \
  [--ssh <host>] [--path <dirs>] [--t3 <path to t3>] [--data-root <dir>] [--branch <name>] \
  [--min-free-gb <n>] [--cleanup '<commit message>']
```

- `--rowbly` is the command that runs Rowbly in that checkout, such as `pnpm --silent dev` or
  `rowbly`; the script adds `--data-root`, `--json` and `--no-prompt`. `--path` is put in front of
  `PATH` for every command, for a non-login SSH shell that lacks `node` or `pnpm`. `ROWBLY.md`
  gives both for each machine.
- `--data-root` is relative to `--project` (default `.rowbly`); `--branch` is the branch the
  checkout must be on (default `main`).
- Leave out `--ssh` for a checkout on this computer.

It runs one command at a time, never beside `rowbly git sync`:

1. Checks `node`, the `--rowbly` command, `gh auth status`, `t3` (with `--t3`), free memory (with
   `--min-free-gb`) and the branch. It reports every failure at once and changes nothing.
2. Lists every changed and untracked Data Root file with NUL-delimited status records, including
   both rename paths. `dataRootChanges` and `policyChanges` contain `{status, path, from?}` records.
   Changes to `ROWBLY.md` or a Stage Prompt stop it with `policy`, before sync or cleanup.
   `policyDiff` holds `{paths, staged, worktree, untracked?}` per entry: staged and working diffs,
   plus the full diff of each new file. Read all of it before resolving policy.
3. Reads `rowbly plugins list` to establish enabled and loaded status explicitly; only an explicit
   disabled or unloaded Plugin skips synchronization. A failed or malformed inspection fails
   closed. With Git on, reads `rowbly git show`; an error (including recovery) fails closed.
   Retains `sync.synchronizationRun`, commit and evidence. Requested or active runs return
   `waiting` even with a clean Data Root, before further Git operations. Reconcile the retained
   identity as the skill's Confirm publication says before preparing again; do not rerun on a loop.
   Evidence on any success or failure closes readiness and retry gates until reviewed, with paths
   and run/commit identity retained in `sync`. Preserve the evidence files. After reconciliation,
   establish a settled result before a fresh preparation attempt.
   Runs `rowbly git sync` only for changes in the Data Root, with 3 tries about 10 then 20 seconds
   apart only while `error.details.retryable` is `true`, no outstanding run or evidence is present,
   and the result is usable. A clean, settled Data Root needs no sync or Automatic Merge Conflict
   Resolution. A fresh synchronized result must record both start and completion times.
4. Lists other uncommitted changes (`otherChanges`). Without `--cleanup` it stops with `dirty` and a
   `diffStat` for you to read. With `--cleanup '<message>'`, after you have read them, it commits
   them on `factory-cleanup/<date>`, pushes, opens a cleanup PR against `--branch` with `gh` and
   switches back.
5. Runs `git pull --ff-only` and reports `pulled.from` and `pulled.to`.

It prints one JSON line with `status`, `prerequisites`, `memory`, `git` (the preferences),
`dataRootChanges`, `policyChanges`, `sync`, `otherChanges`, `cleanup`, `pulled`, and `failures`:
one `{check, reason, fix}` for each problem, with `check` one of `node`, `rowbly`, `gh`, `t3`,
`memory`, `branch`, `policy`, `git`, `sync`, `changes`, `cleanup` or `pull`.

| `status`  | Exit | Meaning                                                               | Next                                                                                                                    |
| --------- | ---- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ready`   | 0    | Up to date; any Rowbly changes were published                         | Workers may run there.                                                                                                  |
| `failed`  | 1    | A check, the sync (with its `reason`), the cleanup or the pull failed | Apply each `fix`; leave the machine out until it passes.                                                                |
| `policy`  | 2    | `ROWBLY.md` or a Stage Prompt has uncommitted changes                 | Show the user `policyDiff`; never sync or clean them up.                                                                |
| `dirty`   | 2    | Changes outside Rowbly data                                           | Read them; run again with `--cleanup` or ask the user.                                                                  |
| `waiting` | 2    | The sync is still requested or running                                | Retain `sync.synchronizationRun`; reconcile it as Confirm publication says before any new preparation or Git operation. |

## Launch

```bash
node scripts/launch-worker.mjs launch --key <KEY> --title "<title>" --brief <file> \
  --model-selection '<JSON>' --project <dir> --ssh <host> --t3 <path to t3> \
  [--launcher-title "<title>"] [--launcher-provider <id> --launcher-model <slug>] \
  [--brief-dir <dir>] [--receipt-dir <dir>] [--min-free-gb <n>] [--timeout <seconds>]
```

- `--brief` is the worker's first message, a local file. `--model-selection` is T3's
  `{"instanceId":…,"model":…,"options":[{"id":…,"value":…}]}`.
  Choose these exact IDs and typed values from the target server's live model catalog and option
  descriptors, resolving inherited options before launch. Keep the complete intended option set:
  strings, finite numbers and booleans retain their JSON types; IDs must be unique. Do not guess
  supported types, coerce numeric-looking strings or silently substitute defaults.
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
   request has no answer, it stops (`unknown`). A discovered thread's ID and intended selection
   are saved in the receipt before verification; if the thread cannot be read, the result remains
   `unknown`, including on the first call without a prior receipt.
4. Checks free memory when `--min-free-gb` is given.
5. Copies the brief to `<brief-dir>/<KEY>-<hash>.md` on the server (default
   `~/.rowbly-factory/briefs`) and reads it back to compare.
6. Saves the receipt, then sends the launcher one `LAUNCH` request with a fresh id and waits for the
   answer line that carries that id.
7. Whatever the answer, and also when there is none, it checks with `t3 thread show`. Exactly one
   thread may belong to the request, and it must not be archived. It must have the title, the
   requested provider and model, full-access in the project folder (no worktree), and the brief as
   its first message. Then the script asks the launcher for the thread's `t3_thread_configuration`
   (`CONFIG`), because the CLI does not show options, and compares the complete typed option set
   independent of order, refusing extra, missing or duplicate IDs and different types/values. The
   receipt records the thread. Missing, empty, whitespace-only or malformed CLI provider, model or
   runtime evidence, or CONFIG thread ID, provider, model or runtime evidence, is `unverified`.
   Validation leaves the original values and intended selection unchanged; only complete,
   well-formed differing values establish a mismatch.

Neither the title alone nor the launcher's own answer counts as verification. The launcher's turns
take up a slot on the server, as the worker threads do.

## Results

The script prints one JSON line: `ok`, `status`, `host`, `key`, `title`, `briefSha256`, `receipt`,
and, once a thread is known, `threadId`, `provider`, `model`, `options`, `runtimeMode`, `workspace`,
`launcherId` and `briefPath`, a `reason` when it fails, and a `note` when the launcher answered
oddly but the checks passed.

| `status`          | Exit | Meaning                                                                                                                                  | Next                                                                                   |
| ----------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `launched`        | 0    | Started and verified, options included                                                                                                   | Use `threadId`.                                                                        |
| `existing`        | 0    | This request's thread was already there and passes every check                                                                           | Use it; it is the one an earlier call started.                                         |
| `failed`, `error` | 1    | Nothing was started                                                                                                                      | Fix the `reason`, then run the same command again.                                     |
| `unknown`         | 2    | A requested or discovered thread cannot be found or confirmed                                                                            | Wait, then run the **same** command again. If it stays `unknown`, see Restarting.      |
| `conflict`        | 2    | Several threads for the request, a thread that differs from it, an archived thread, or a title used for another request                  | Start nothing for the Story; look at the threads (`t3 thread show`) and tell the user. |
| `unverified`      | 2    | CLI or CONFIG identity/configuration evidence is missing, empty, whitespace-only or malformed, or the launcher could not confirm options | Do not count it as verified; run the same command again later, or tell the user.       |

## Retrying, archiving and restarting

- **Retry** with the same command. The title is the request's identity: a second call finds the
  request's thread, from the receipt, the list or the launcher's answers, and never starts another.
  It fails closed: when a request was sent or a worker discovered and its outcome cannot be
  established, it says `unknown`.
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

Record the planned Model Selection, Stage Run and verified identity before a worker starts on the
Story. Use **Park, then GO**:

1. Choose the exact provider instance/model IDs and complete typed options as the skill's
   Model Selection policy says. Preserve this intent, its policy rule and any fallback reason.
   Launch with this `--model-selection` and a short reservation as the brief ("You are reserved for
   <KEY>. Do nothing. Reply RESERVED <KEY> and wait for GO."). Keep the result and durable receipt.
2. Run `rowbly software-factory run start <KEY> --worker <threadId> --provider <instanceId>
   --model <modelId> --rule "<rule>" [--option '<id>=<json>']… [--fallback "<why>"]
   [--usage unknown|observed-limit|user-stated]`, recording the selection chosen in step 1,
   not one reconstructed from the returned worker. Keep its returned Stage, attempt and startedAt.
   T3 `instanceId` maps to `--provider`; each option's `value` is its JSON scalar. For example,
   `{"id":"reasoningEffort","value":"high"}` becomes `--option 'reasoningEffort="high"'`,
   while `{"id":"fastMode","value":true}` becomes `--option 'fastMode=true'`.
   String `"123"` needs `--option 'text="123"'`; number `123` needs `--option 'number=123'`.
   Null, compound, nonfinite or malformed values and duplicate IDs are refused with exit 2.
   Alternatively, when `ROWBLY.md` permits it, start with a unique launch title first, then launch
   the reservation. A title is an unverified hint, never sufficient recovery identity.
3. Compare the recorded intent with the actual `provider`, `model` and complete `options` from the
   verified result. Comparison is order-independent and type-sensitive: extra, missing or duplicate
   IDs, differing values, and string/number/boolean differences are mismatches. The script checks
   the request against the worker's CLI identity and launcher CONFIG result; compare those actual
   values with the Stage Run selection too. A proven selection mismatch means no attachment,
   publication or GO: run `rowbly software-factory run fail <KEY> --reason "<actual mismatch>"`.
   Never rewrite intended selection to match the worker. A `conflict` caused by ambiguous identity
   or a reused title requires reconciliation; it is not by itself proof of a model mismatch.
   `unknown` or `unverified` means insufficient evidence: keep the worker reserved and reconcile
   the receipt and remote harness, without failing on a guessed mismatch or launching a duplicate.
4. Generate the full brief as the skill's Start a Story procedure says: combine the worker
   template's rules with `rowbly software-factory brief <KEY>`, including `--instructions-file`
   when needed and `--retry-file` on retry. Incomplete context means no GO; fail the Run with its
   gaps unless the user explicitly permits incomplete context. Preserve the prior attempt's
   metadata, receipt and continuation decision in retry context before `run start --retry`.
5. Attach the verified actual worker using `rowbly software-factory run attach <KEY> --stage <stage> --attempt <attempt>
   --started-at <startedAt> --worker <threadId> --machine <machine> --harness t3 --thread-id <threadId>
   --source "<durable launch receipt>"`. Rowbly records the supervisor's attestation; it does not
   contact T3. Use the receipt's machine and actual returned identity, never a guessed title.
6. Publish the Board (including planned selection and verified identity) as the skill's Board persistence
   section says. When Git is enabled and loaded, keep GO closed until that section confirms fresh
   synchronized completion with no requested or active run. When Git is disabled or not loaded,
   skip sync and treat publication as done. Then send the full brief and GO:

   ```bash
   node scripts/launch-worker.mjs send --thread <threadId> --title "<title>" --message <file> \
     --project <dir> --ssh <host> --t3 <path to t3>
   ```

`send` checks the title, sends nothing when the same message is already present (`existing`), and
otherwise reports `sent` once it shows in the thread. If start, attach or publication fails, do
not send GO. Keep the worker parked or cancel it and verify cancellation before another launch.
A definite failed launch uses `run fail --reason`; `unknown` requires receipt/harness reconciliation,
not a duplicate launch. On restart, resolve `runMetadata.identity.threadId` through its harness on
its recorded machine. Local tools do not resolve remote IDs. Preserve metadata and receipt evidence
before a retry replaces the current Run.
