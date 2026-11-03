# How we work with the Rowbly Board

## Stages

- **Backlog**: people plan here. No Stage Prompt.
- **TODO**: an advisory readiness pass records concrete questions or missing requirements once per
  visit, keeps the Story in TODO and never authorizes implementation. After answering in an ordinary
  Comment or updating the requirements, a person can request another pass with
  `rowbly software-factory run clear <KEY>`; a complete unchanged review input fingerprint suppresses
  a duplicate Comment. The supervisor leaves finished Runs alone.
- **In Progress**: a person moves a Story here when it is ready to build. The factory takes it to a
  draft PR with `rowbly-dev` (its Stage Prompt), then moves it to In PR.
- **In PR**: the factory merges the PR when it is ready and moves the Story to Done, or sends it back
  to In Progress, with its branch and PR, when a review requests changes, a check fails or it
  conflicts with `main` (its Stage Prompt). It asks when a conflict involves another open PR or a
  stack layer.
- **Done**: merged.

Rowbly data is committed on `main` and pushed; the Git Plugin commits each change (Automatic
Commits On, frequency `change`) and `rowbly git sync` pushes it (Automatic Merge Conflict
Resolution On).

## The factory (`rowbly-factory`)

- **Supervisor**: runs on the main computer, in the main checkout on `main`, with
  `pnpm --silent dev … --data-root .rowbly --json --no-prompt`. It is the Board's only writer:
  workers report commands and merge `origin/main` to receive published Board changes. Run
  `rowbly git sync` once after all changes of one coherent event: `run start` plus its verified
  `run attach`, an applied worker block, or `run finish`/`run fail` plus its reported block.
  Publish before GO and before every reply or machine start that relies on the changes. Retain
  any earlier publication barrier required by that event; never defer a reply a worker awaits.
  Changes nobody waits for can share the next sync; flush when stopping. This reduces sync
  attempts, not per-change Automatic Commits: keep frequency `change` and force-change checks.
  Sync also brings in merged product changes; evidence or conflicts alone do not prove a second
  Board writer. Investigate the source commits, preserve all sides and report unresolved conflicts.
- **Workers run on the supervisor's computer (`thinkpad`) or the server `rook`**
  (`ssh 192.168.68.62`), whichever has capacity (see Capacity and Remote Machines). They are
  ordinary top-level T3 threads, started with `t3_thread_launch` on thinkpad and as below on rook;
  that is intended, not a fallback for sub-agents.
- **Rook's checkout.** After the supervisor updates its own checkout, it updates rook's shared
  checkout `~/Projects/rowbly` over SSH the same way: Rowbly changes saved there first through the
  Git Plugin, a cleanup commit and cleanup PR for any other uncommitted changes, then
  `git pull --ff-only` on `main`. Only the supervisor pulls there, at start, before any worker runs.
- **Memory on rook.** Check `free -h` there before each start, and start nothing while less than
  about 6 GB is available.
- **Worker model**: chosen per Stage (see Model Selection), unless the user names another.
- **Retries**: the default, one.

### Capacity and Remote Machines

- Local machine (`thinkpad`) capacity is 4 running worker threads.
- Remote machine (`rook`) capacity is 6 running worker threads, counting the launcher while it runs.
- The supervisor spawns each worker on whichever machine has capacity, `thinkpad` or `rook`.

### Model Selection

- The supervisor chooses each worker's model from the Stage being run and the target harness's live
  catalog. Record its exact provider instance/model IDs, complete typed options, policy rule and any
  fallback with `run start --provider --model --rule` (see the `rowbly-factory` skill).
- Coding uses Claude Opus (latest version) by default.
- Bug hunting uses GPT Sol (latest version).
- Refinement and PR writing use Claude Opus.
- Review (In PR) uses a new worker whose model differs from every implementing model in the
  verified implementation records, including correction workers. The same provider is allowed;
  changing effort or options does not qualify. Choose an available eligible model from the live
  catalog; ask when provenance is unknown or no eligible model is available.
- Keep variety across workers while preserving those defaults and every independent-review gate.
- Remaining usage is unknown: no supported tool here reports it. Never estimate or infer a quota.
  On an observed usage/rate limit, or when the user says a provider is low, choose another available
  provider/model and record `--fallback "<reason>"` with `--usage observed-limit` or
  `--usage user-stated`. Otherwise record `--usage unknown` (the default).

### Starting workers on rook

The supervisor's T3 tools only reach its own computer, so it drives rook's T3 through its CLI over
SSH. Non-login SSH shells lack `node` and `pnpm`, so call the binary by its full path (check the
version folder, `ls ~/.t3/runtime/versions` on rook, after T3 updates). Read workers' messages and
check threads with:

```bash
T3=~/.t3/runtime/versions/0.1.2/t3
ssh 192.168.68.62 "cd ~/Projects/rowbly && $T3 thread list --json"
ssh 192.168.68.62 "cd ~/Projects/rowbly && $T3 thread show --json <threadId>"
```

Start every worker, and send it its brief, with the `rowbly-factory` skill's launcher script (its
`references/remote-launch.md`), run from this checkout with rook's settings. Do not rebuild these
steps by hand:

```bash
node skills/rowbly-factory/scripts/launch-worker.mjs launch \
  --ssh 192.168.68.62 --project '~/Projects/rowbly' --t3 '~/.t3/runtime/versions/0.1.2/t3' \
  --brief-dir '~/rook-briefs' --min-free-gb 6 --launcher-title 'Launcher: workers' \
  --launcher-provider codex --launcher-model gpt-6.1-sol \
  --key <KEY> --title '<title>' --brief <file> --model-selection '<modelSelection JSON>'
```

- **Title**: `rook: <KEY> <Stage name> <UTC time you decided to start it> #<attempt>`, for example
  `rook: ROW-12 In Progress 2026-11-02T23:28Z #1`. It identifies the launch: a retry of the same
  launch reuses it unchanged, and a new visit or attempt gets a new one.
- **Model selection**: for example
  `{"instanceId":"claudeAgent","model":"claude-opus-5-5","options":[{"id":"effort","value":"high"}]}`.
- **Stage Run first.** Use the worker's thread id as its Stage Run `--worker`. Launch with a short
  reservation as the brief, then run `run start <KEY> --worker <threadId> --provider <planned-instanceId>
  --model <planned-modelId> --rule "<rule>"` with the planned JSON-scalar `--option` values
  (for example `--option 'reasoningEffort="high"'`) and any fallback/usage source. Keep the worker
  reserved until selection comparison, attachment and publication below succeed; only then send
  the full brief with GO (same flags as above, without the launch-only ones):

  ```bash
  node skills/rowbly-factory/scripts/launch-worker.mjs send \
    --ssh 192.168.68.62 --project '~/Projects/rowbly' --t3 '~/.t3/runtime/versions/0.1.2/t3' \
    --thread <threadId> --title '<title>' --message <file>
  ```

- **Results**: on `launched`, `existing` or `sent`, go on. On `failed`, fix the reason and run the
  same command again. On `unknown`, wait and run the same command again. On `conflict` or
  `unverified`, start nothing for the Story and tell the user.
- **Receipts and archiving**: the script keeps a receipt per request in `~/.rowbly-factory/receipts`
  on thinkpad; never edit or delete them. Archive a worker only when done with it: its request then
  reports `conflict` and starts nothing, and a new worker needs a new title.

Keep each launched worker reserved and waiting for GO. Before attachment/publication/GO, compare
its actual provider instance/model IDs and complete typed options with the recorded planned
selection, ignoring option order. Extra, missing or duplicate option IDs and type/value differences
are mismatches: fail the Run with the verified reason and keep intent unchanged. Missing, empty or
malformed identity/configuration evidence is unverified, not a proven mismatch. Unknown or
unverified outcomes require receipt/remote-harness reconciliation, without GO or a duplicate.
After `run start`, retain its returned `stage`, `attempt` and `startedAt`, then attach the verified
launch receipt through
`rowbly software-factory run attach <KEY> --stage <stage> --attempt <attempt> --started-at <startedAt>
--worker <threadId> --machine rook --harness t3 --thread-id <threadId> --source "<receipt>"`.
For local workers use machine `thinkpad`; never resolve a rook thread through thinkpad's tools.
The CLI records the supervisor's attestation; it does not contact T3. Retain the verified identity
and exact worktree/branch paths in the supervisor-owned resource record as the factory skill says.
Publish the selection and attachment before sending the full brief and GO. If attachment or
publication fails, keep the worker reserved and reconcile rather than launching another. A definite failed launch ends the Stage Run with its
reason; an uncertain launch requires checking the durable receipt and remote harness first.
On supervisor restart use `runs --json` current `runMetadata.identity` to find the machine, harness
and thread. Legacy titles are unverified hints; an unreachable machine does not prove absence.

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

- **Worker liveness.** Use the current Run metadata identity to find the worker on its recorded
  machine and harness. A completed/running status, successful poll or reachable thread does not
  prove recent activity. Record a heartbeat only for a verified worker message or harness
  activity event, using the exact RunRef and worker and describing the evidence in source.
  Review stale Runs after the configured threshold; never clear, fail, retry or launch a
  duplicate from age alone. Keep waiting-user and ambiguous/unreachable states explicit.
  Fail only after verifying the worker is gone; reconcile a changed identity/Run or unreadable
  metadata before any dependent action.
- **Base branches.** Check where a Story's dependencies merged (`gh pr view <n> --json baseRefName`);
  work merged to `develop` is not on `main`. Ask before basing on anything but `main`.
- **zsh**: `"$c:refs/…"` applies the `:r` modifier, so write `"${c}:refs/…"`; a variable holding several
  options is passed as one word, so use a shell function.
- **`gh … -q` output** with empty fields shifts whitespace-split fields; join them with `|` and read
  them with `IFS='|'`.

### Waiting for checks

Workers and the supervisor never poll CI with model turns.

- **Supervisor first choice: T3's PR watch.** After a PR is opened (or when an In PR Stage Run
  starts), the supervisor registers its nonblocking `watch_pull_request`. Process actionable Board
  work and register all pending PR watches before yielding; T3 wakes it when checks finish,
  someone comments, or the branch conflicts. Independent diff review may start and
  finish while CI is pending. Defer only CI-dependent merge processing. Every wake requires a fresh
  inspection of all current-head conclusions; a comment or conflict wake does not mean checks
  settled. `unwatch_pull_request` when the PR merges, closes or is handed back.
- **Delegated review workers do not watch or poll PRs.** They return the head SHA and pending-check
  state to the supervisor after completing independent diff review and any other work that does
  not depend on CI; yield only remaining CI-dependent work.
- **Fallback (no PR watch in the harness): one bounded blocking command**, in the background with the
  harness's resume-on-exit, never a loop:

  ```bash
  timeout 30m gh pr checks <n> --watch --fail-fast --interval 30
  ```

  Every exit code, including 0, is only a wake signal. Read once with
  `gh pr view <n> --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision`.
  Confirm the exact current head matches the head being processed; discard stale results and
  process the new head if it changed. Inspect the full rollup before any merge:
  - All passed requires a nonempty rollup with every CheckRun `COMPLETED` and concluded `SUCCESS`,
    and every StatusContext in state `SUCCESS`; other review and merge gates still apply.
  - Actual `FAILURE`, `TIMED_OUT` or `ACTION_REQUIRED` conclusions, or StatusContext `FAILURE` or
    `ERROR`, route to the Stage Prompt's failure/return policy, with the check's name and link.
    `--fail-fast` may wake before other checks finish; classify actual results, not its exit code.
  - An empty rollup soon after a push (including "no checks reported") means checks are not yet
    registered: waiting, not failure. Wait one grace period of about 2 minutes and watch once more,
    then report waiting or ask.
  - Unfinished checks or pending StatusContexts, including after exit 124 (the 30-minute timeout),
    mean waiting: report the head SHA and pending names, never repair solely for a wait timeout and
    do not repeat a timed-out watch.
  - `CANCELLED`, `SKIPPED`, `NEUTRAL` and any unrecognized terminal conclusion or state cannot
    establish all passed. Follow explicit policy or ask for a decision; never infer success from
    exit 0. An unreadable or unusable PR is separate: report the error and ask.
- **Do not use `--required`**: `main` has no branch protection, so GitHub reports no required checks.
  Watch all checks.
- **Cancellation.** Stopping the factory or moving the Story out of In PR sends the watch a signal
  (`SIGINT`/`SIGTERM`); leave nothing running. A new push restarts checks: the watch for the old head
  is stale, so cancel it and start one for the new head.
- **Timeout.** 30 minutes by default (CI takes about 2 minutes today). A timeout is not a failure:
  report the head SHA and pending checks and ask rather than watching again.

### Evidence retention

Keep all existing `plugins/git/merge-evidence/` files and linked `pr-assets/<branch>` branches,
including after a Story is Done. No automated expiry or completion cleanup removes them.
Merge Evidence removal requires explicit user approval after the adding merge commit is upstream
and each decision is reviewed (or confirmed spurious). Use an ordinary upstream commit whose
message records the path, adding commit, review and approval; never rewrite history. Linked
screenshots remain indefinitely until every image is rehosted, every comment link updated and
verified to load, and the user explicitly approves removal. See ADR-0050 for the audit policy.
