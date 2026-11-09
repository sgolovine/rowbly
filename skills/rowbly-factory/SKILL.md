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
- **Worker model**: chosen as [Model Selection](#model-selection) says; default your own model.
- **Other instructions**, such as where workers run and how to start them. These take precedence
  over `ROWBLY.md`, which takes precedence over this file.

Keep this file free of machine and user specifics: servers, paths, models, thread tools and limits
belong in `ROWBLY.md` or the user's instructions.

## Update the checkout

Update every checkout the factory uses, the one you run in and each one workers run in on another
machine, before it is used: yours first, at start; another machine's before it runs its first
worker. Skip a checkout that is not a git repository. Run these steps one at a time, in the git
repository that holds the Data Root (find it as the reference says).
[`scripts/launch-worker.mjs prepare-checkout`](references/remote-launch.md#prepare-a-checkout) does
all of them in one call, here or over SSH, and returns one JSON result; use it for another machine,
and for yours when you can.

1. **Look first.** Run `git status --porcelain=v1 -z --untracked-files=all` and read its NUL-delimited paths (both sides of a rename). Tell the user in one line what is uncommitted in the
   Data Root: that is what step 3 publishes.
2. **Policy is not cleanup.** Uncommitted changes to `ROWBLY.md` or a Stage Prompt file are the
   factory's policy. Show the user the staged and working diffs and the content of each new policy file, and ask them to commit it (or commit it as `ROWBLY.md`
   says changes to it are committed), then start again. Never run on unpublished policy, never let
   a sync publish it unannounced, and never put it in a cleanup PR.
3. **Board changes.** Establish enabled and loaded status with `rowbly plugins list`; an inspection error or malformed output is a failure, never evidence that Git is off. When Git is on, read `rowbly git show`; stop on inspection or recovery errors. Retain its synchronization run, request/run identity, commit and evidence. If requested or active is present, report waiting before any further Git operation, even with clean files; reconcile that run as **Confirm publication** says before preparing again. Evidence on either a successful or failed result requires review as **Evidence or a conflict** says before readiness or retry. Run `rowbly git sync` only when the Git Plugin is
   enabled **and loaded** (`rowbly plugins list`) and `git status --porcelain -- <Data Root>` is not
   empty; a clean Data Root needs no sync, so its checkout never needs Automatic Merge Conflict
   Resolution. Set up [Board persistence](#board-persistence) first, and confirm publication as
   [A failed sync](#a-failed-sync) says, following its failure policy. Sync commits Rowbly changes
   that were saved but not yet committed, merges the upstream and pushes; it leaves other staged,
   changed and untracked files, and files edited by hand, as they are. If `git` is disabled or not
   loaded, skip this step and its publication gates as Board persistence says: the factory does not
   need the Git Plugin.
4. Run `git status --porcelain` again. If it prints nothing, go to step 6.
5. **Clean up.** Someone left uncommitted work here. Read every change (`git diff`, `git diff
   --cached` and each new file). If one must not be committed (a secret, build output, a large
   binary), stop and ask the user. Otherwise:
   - Create a branch `factory-cleanup/<YYYY-MM-DD-HHMM>` at the current commit, commit every change
     on it as one **cleanup commit** whose message sums up the changes, in the repository's commit
     style, and push it.
   - Open a **cleanup PR** against the branch you started on. Its description says what each change
     is and that the factory found it uncommitted at start. Do not merge it.
   - Switch back to the branch you started on.
6. Run `git pull --ff-only`. If it fails (diverged history, no upstream), report it.

Tell the user in one line, per checkout, whether it was clean, what the sync published, the cleanup
PR if you opened one, and the commit you pulled to.

**When an update fails.** Your own checkout is the Board's: if its update fails, stop and tell the
user. Another machine's checkout only guards that machine: leave the machine out of capacity, tell
the user what failed and how to fix it, keep starting workers elsewhere, and update it again on each
pass of [the loop](#the-loop) or when the user says it is fixed. `ROWBLY.md` says which machines
there are and how to reach Rowbly on each.

## Board persistence

Workers see your Board changes only after they are committed and pushed. The factory does not
depend on the Git Plugin: use Git setup and sync only when `rowbly plugins list` shows `git` with
both `enabled: true` and `loaded: true`. If either is false, skip this section's Git commands and
every sync/publication gate in this skill and its references. Treat each step that publishes the
Board (before a GO, a reply or another machine's start) as done. Then the Board is not pushed for
you; tell the user once, at start, that workers on other checkouts will not see Board changes until
someone pushes them.

- **Commit each change.** The Git Plugin's preferences are personal: read them with `rowbly git
  show`. When `ROWBLY.md` or the user says Board changes are committed or pushed as they happen, and
  Automatic Commits are Off or `frequency` is `interval`, run `rowbly git configure
  --automatic-commits on --frequency change` and tell the user. Otherwise leave them as they are.
- **Push with the Git Plugin.** The CLI's `rowbly git sync` needs Automatic Merge Conflict
  Resolution On (`synchronization.enabled` in `rowbly git show`); while it is Off the command
  fails. Only the TUI's **Sync** (`S`) works with it Off, and you work in the CLI. If it is Off,
  turn it on only when `ROWBLY.md` or the user says to (`rowbly git configure
  --automatic-merge-resolution on`); otherwise ask the user before you start.
- **Why you sync.** You are the Board's only writer: workers report commands and never commit
  `.rowbly/`. `rowbly git sync` publishes your Board changes, so a worker sees them when it merges
  the upstream, and brings in what merged upstream meanwhile, such as pull requests.
- **When to push.** When `ROWBLY.md` or the user says to push Board changes, run `rowbly git sync`
  after `run start` and `run attach`, before you send GO, after each worker block you apply, and after
  `run finish` or `run fail` with its block, before you tell a worker the Board has changed. If it
  fails, follow [A failed sync](#a-failed-sync). Confirm publication as below before releasing any
  dependent GO, reply or start on another machine.
- **One sync per event.** Make every Board change of one event first (a start and its attach, one
  applied block, a finish or fail with its block), then sync once, before the GO or reply that relies
  on them. A change nothing waits for, such as a Comment recording an answer you already sent, goes
  out with the next sync. Sync once more when you stop. Never hold back a sync that a GO, a reply or
  another machine's start relies on. Keep any earlier publication barrier required by `ROWBLY.md`
  or the user.
- Batching sync reduces publication attempts, not the per-change Automatic Commits. Keep Automatic
  Commits frequency `change` when required by policy, and keep every force-change check.
- **Evidence or a conflict.** When `git sync` reports evidence paths or a Rowbly conflict, keep every
  side and every evidence file. Find the commits involved and what wrote them (a merged pull request,
  older data or another writer), and tell the user about any conflict nobody has resolved.
- Never run `git rebase`, `git reset` or a force push yourself.

### A failed sync

One rule for every `rowbly git sync`, at start and while the factory runs. It replaces the
reference's advice not to retry a failed command unchanged:

1. **Try 3 times in all, backing off.** After a failed sync, wait about 10 seconds and run it
   again; after a second failure, wait about 20 seconds and run it a third and last time. Run no
   other git or Board command during sync or backoff, except `rowbly git show` when needed to
   establish settlement as below. Tell the user in one line that you are retrying and why.
2. **Classify by `error.details.reason`,** never by the message text:
   - **Retryable** (`details.retryable` is `true`: `capture-changed`, `index-changed`, `network`):
     step 1. `capture-changed` means a person or another program kept saving, such as someone
     moving Stories in the TUI. People may keep working in the TUI while the factory runs: they are
     not a second automated writer, so never stop the factory because of their edits.
   - **Configuration** (`resolution-off`, exit 2): when `ROWBLY.md` or the user allows it, run
     `rowbly git configure --automatic-merge-resolution on` in that checkout, tell the user, and
     sync again as the next of the 3 tries; otherwise ask the user. A missing upstream
     (`no-upstream`) is fixed by hand: tell the user.
   - **Needs a person** (`conflict`, `evidence`, `unexpected`, or evidence paths in a successful
     or failed result): go straight to step 3; for evidence or a Rowbly conflict follow **Evidence or a
     conflict** above, and report the commits involved.

   A Rowbly too old to give `details.reason` is classified as before: no retry for evidence paths,
   a Rowbly conflict, Automatic Merge Conflict Resolution Off, or exit 2 or 3.
3. **After the last try,** tell the user its message and reason. At start, stop when it is your own
   checkout: it may be missing upstream changes. For another machine's checkout, leave that machine
   out as [Update the checkout](#update-the-checkout) says. While the factory runs, keep going, but send no GO, reply or start on another
   machine that relies on the unpublished change; publish it with the next sync that succeeds.

**Confirm publication for each attempt.** Before invoking sync, retain the attempt's start time
and the previous `synchronizationRun.last` from `rowbly git show`. Retain the `requested` id returned
by sync, or `active.id` when no request id is present. Exit 0 alone, from either sync or show, does
not establish success.
While `synchronizationRun.requested` or `active` is present, keep dependent gates closed, even if
`last` still shows an older success. To establish settlement, read only `rowbly git show`, about
5 seconds apart, for at most 30 seconds per attempt. Do not start another sync or run other git or
Board commands concurrently. If it remains requested or active at that bound, report waiting and
keep the dependent gates closed; a wait timeout is neither success nor a failed attempt and does
not authorize a retry or another status-wait loop. Reconcile the outstanding run before resuming.

Read `runs` and act on the Board only after a sync has settled.

Release dependent gates only when both are absent and a fresh completed `last.kind` is
`synchronized` for the relevant attempt: its `startedAt` is at or after this attempt began, its
`finishedAt` records completion, and its `id` matches the retained request/run id when available.
An unchanged older result cannot publish this event. If freshness or relevance cannot be verified,
keep the gates closed and reconcile or report the uncertainty. A settled `failed` or `interrupted`
result is a failed attempt even when show exits 0: use its message and evidence in steps 1–3 above,
counting it within the same 3 total attempts, keeping dependent gates closed until publication is
confirmed. The no-retry exceptions still apply.

## Evidence retention

Merge evidence (`plugins/git/merge-evidence/` in the Data Root) and the screenshots or other files a
pull request links are audit evidence. Keep them after the Story is Done, and leave them out of any
cleanup. Never edit, prune or delete them yourself: removing one is the user's decision, after its
merge commit is upstream and its decisions or links were reviewed, and linked images must be hosted
elsewhere first. For merge evidence, record its path, adding commit, review and approval in the
ordinary upstream removal commit; preserve history. For linked images, update and verify every link
before an approved removal. `ROWBLY.md` says where this repository keeps its screenshots.

## Before you start

Check everything below, then report every problem at once, each with how to fix it. A check
stops only what it guards:

- **The whole factory** stops, starting nothing, when the Board itself cannot be worked: no way to
  start threads (check 1), no Data Root or Board (2), the Plugin off (3), your own checkout not
  updated (a failed sync or pull there, [Update the checkout](#update-the-checkout)), or no usable
  machine and no usable Stage left after the checks below.
- **One machine** that fails its update, its prerequisites or its memory floor is left out of
  capacity and reported with its fix; workers start on the others. Check it again on each pass of
  [the loop](#the-loop), or when the user says it is fixed, except that `waiting` retains the
  outstanding run identity and requires reconciliation before another preparation or Git command.
  Policy and dirty results require their own review protocols before another attempt.
- **One Stage** whose Stage Prompt fails check 4 or 5 is skipped: report it and the Stories waiting
  in it, and work the other Stages.

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
   Name those Stages and tell the user to write them (`prompt edit`) or turn them off. When the
   Board has no Stage Prompt yet, tell the user that `rowbly software-factory setup --board <id>`
   adds the factory Stages and default Stage Prompts it lacks; do not run it yourself.
5. **What the Stage Prompts need.** Read each Stage Prompt that is on, and `ROWBLY.md` if the Data
   Root has one. List every skill, tool, command, server, credential and permission they name, and
   check that you or the workers you start will have each. Name each one that is missing and the
   Stage that needs it. Check every Stage a Stage Prompt names, such as the one it moves Stories to,
   against the Board's Stages (`stages` lists their keys and names): a Stage Prompt that names a
   Stage the Board does not have fails this check, and only its own Stage is skipped.
6. **Stage Runs already running.** Read `runMetadata` in `runs`. For a current verified identity,
   resolve its `threadId` through its `harness` on its recorded `machine`, then take over the
   verified worker. Never resolve remote IDs through local tools by assumption. An unavailable
   machine does not prove the worker is gone. Missing identity, legacy worker strings and titles
   require independent verification from a launch receipt or harness result, followed by
   `run attach` for this exact Run and Board publication. Opaque metadata needs explicit repair.
   Reconcile unknown/conflicting launch state before clearing or retrying; ask the user when it
   cannot be resolved. Do not start a duplicate or infer failure from age alone. Check each
   running Run's `runMetadata.selection` against the model policy, as
   [Model Selection](#model-selection) says, and report any that is missing or does not comply.
   Finding the worker is not activity: touch only on what it has done since
   (see [Stale Runs](#stale-runs)).

Then tell the user the Board, the Stages that have a Stage Prompt on, the worker limit and model, and
where workers run. One supervisor works a Board: if the user says another one is running, stop.

## The loop

Run until the user stops you. Do not wait for the user between events.

1. **Read, then wait.** Run `rowbly software-factory runs --board <id>`, act on it (steps 2 to 5),
   and keep its `digest`. If you changed the Board, read `runs` again; when you changed nothing, run
   `rowbly software-factory wait --board <id> --since <digest> --timeout <seconds>` in the
   background, with the harness's way to run a command and resume when it exits. It returns as soon
   as `runs` differs from that digest (a Story entered a Stage whose Stage Prompt is on, or a Stage
   Run or eligibility changed), at once if it already does, or with `changed: false` after the
   timeout, or once when a running Stage Run becomes stale. Act on what it returns as on `runs`.
   Worker messages do not reach it: resume on them as well. Stop the wait (a signal) when you stop.
   Never wait on a digest newer than the `runs` you acted on. Re-read `software-factory stages`
   before each start, so a Stage Prompt the user changed or turned off takes effect, and check a
   changed one again as [Before you start](#before-you-start) check 5 says.
   On each pass, try again each machine or Stage left out at start or since; bring it back when it
   passes, and tell the user.
2. **Start** each Story whose `stageRun` is `null` and `eligibility.eligible` is `true`, in the order
   `runs` lists them, while fewer workers run than the limit. See [Start a Story](#start-a-story).
3. **Retry** each eligible Story whose Stage Run is `failed`, once: when `attempt` is 1, follow
   [Retry context](#retry-context) before `run start <KEY> --worker <name> --retry`, then start a new
   worker with that context in its brief. Leave it failed after that and tell the user.
   `ROWBLY.md` or the Stage Prompt may set another retry limit; follow it.
4. Leave `finished` Stage Runs alone. The Story is worked again only after it moves to another Stage
   and comes back, or the user clears the Stage Run.
   An [advisory Stage Prompt](references/readiness.md) finishes without moving the Story; only a
   person requests another pass by clearing its Run, and the prompt skips duplicate output only
   when complete known review inputs are unchanged.
5. **Blocked and held Stories.** When `eligibility.eligible` is false, report its `reasons[].message` and
   skip both starts and retries. A `BLOCKED` reason lists unfinished blocking Stories in `blockers`.
   Reconsider on the next Board change or `runs` result: a blocker reaching a Stage of category
   `done` removes that restriction automatically. Do not clear a failed Run or move a Story to
   bypass its blockers. A `HELD` reason means a person holds the Story to work it by hand: never
   release it yourself; it becomes eligible again when they release it, with its Stage Run as it
   was. If eligibility cannot be read, report the error and start nothing from
   that result. Existing running workers are still supervised normally.
6. **Act on each worker message**, as in [Worker messages](#worker-messages).
7. **Stale Runs.** Check each running Stage Run whose `liveness.stale` is true, as in
   [Stale Runs](#stale-runs).

Report each start, retry, finish, failure, question and Board change to the user in one short line.

## Start a Story

1. Choose the worker's provider, model and options as [Model Selection](#model-selection) says.
2. Run `rowbly software-factory run start <KEY> --worker "<launch identifier>" --provider <id>
   --model <id> --rule "<rule>" [--option <id>=<json>]… [--fallback "<why>"] [--usage <source>]`.
   Keep its returned `stage`, `attempt` and `startedAt` as the expected Run reference. The worker
   string alone is a launch hint, not verified identity. If the harness can reserve a real thread
   waiting for GO, use its actual ID. Start work only after this succeeds. Exit 4 means a Run
   already exists, its Stage Prompt is off, unresolved blocking Stories remain or a person holds
   it: report the returned reason and skip it. Re-read eligibility after Board changes; never
   launch from a stale overview or after a refused start.
3. Run `rowbly software-factory brief <KEY>`, with `--instructions-file` for the user's instructions
   for workers and the other Stories workers are on, and on a retry `--retry-file` with the
   [retry context](#retry-context). Its `markdown` supplies the generated context of
   [the worker brief](references/worker-brief.md) after the rules: the Story in full, the Stage
   Prompt and `ROWBLY.md`. The brief is the template's rules, with `<KEY>` filled in, followed by
   `markdown`. For an independent review, follow [Independent review](#independent-review):
   append one filled Implementation records section after the generated markdown, containing all
   verified authoring records and the selected reviewer identity. Do not substitute the manual
   template or rely on its unfilled placeholders. Finalize that section from the verified launch
   before sending GO in step 6. Exit 4 with `details.incomplete` means part of the Story or
   `ROWBLY.md` cannot be read: launch nothing, run `run fail <KEY> --reason "<the gaps>"` and tell the user. Use
   `--allow-incomplete` only when the user says so. Without the `brief` command, fill in the whole
   template by hand from `stories show`, each Plugin's own commands and `ROWBLY.md`.
4. Launch or use the reserved worker with the recorded selection, as `ROWBLY.md` says, keeping it
   waiting for GO. Verify the actual machine, harness, worker ID and thread ID from the launch
   receipt/harness result. For a remote T3 CLI use [remote launches](references/remote-launch.md),
   including its durable receipt. Compare actual provider instance/model IDs and the complete
   typed option set with the recorded selection, ignoring option order. Extra, missing or duplicate
   IDs and different types or values are mismatches: send no GO and fail the Run as step 7 says,
   naming what launched. Unknown or unverified evidence needs reconciliation first. Never change
   the selection to match the launch; a retry records its own.
5. Run `rowbly software-factory run attach <KEY> --stage <stage> --attempt <attempt> --started-at
   <startedAt> --worker <actual-id> --machine <machine> --harness <harness> --thread-id <thread-id>
   --source "<verification receipt>"`. Use the expected reference from start. Rowbly records your
   attestation and Me; it does not contact the harness. Identical repeats write nothing; conflicting
   identity is refused. Preserve another section's values when adding current-Run metadata.
6. Retain the verified thread identity and exact worktree/branch paths in a supervisor-owned
   [resource record](references/cleanup.md) outside the checkout. Add private daemon directories
   as workers report them; complete the merged PR/head/base fields before cleanup.
   Publish the attachment as [Board persistence](#board-persistence) says, then send the full brief
   and GO. Attachment or publication failure means no GO; inspect the recorded Run and reconcile.
7. A confirmed failed launch uses `run fail <KEY> --reason "<why>"`. If launch success is uncertain,
   reconcile the receipt and actual harness state first; do not retry, clear or start another worker
   merely because a response was lost. If a worker exists but start/attach failed, keep it waiting
   or cancel it through its harness, and verify that outcome before another launch.

## Model Selection

The selection that `run start` records is what you chose before the launch: the provider instance,
model and options as your harness names them, the policy rule you applied, and why you did not use
that rule's model when you did not. It is your intent, not proof of what launched; the launch
receipt confirms it.

- **Policy.** Follow the user's instructions, then `ROWBLY.md`'s model policy. Without either, use
  your own model and record `--rule "supervisor default"`. A model the user names for a Story or a
  run is `--rule "user named"`.
- **Exact options.** Read the target harness's live model catalog and supported option descriptors.
  Resolve any inherited options before recording the full intended selection; never guess types
  or silently substitute values. `--option <id>=<json>` takes a JSON string, finite number or
  boolean, with unique IDs: `--option 'reasoningEffort="high"'` or `--option 'fastMode=true'`.
  String `"123"` and number `123`, or string `"true"` and boolean `true`, remain different.
  Malformed JSON, null, compound/nonfinite values and duplicate IDs exit 2. These new flags need
  no released CLI or stored-data migration; starts without selection still work.
- **Usage is unknown unless you can see it.** Rowbly has no usage source. Count remaining usage
  only when your harness reports it for that provider; never estimate it, never infer it from
  signing in or a successful launch, and never record a number you did not read. `--usage` is
  `unknown` (the default), `observed-limit` (a launch or turn failed with a usage or rate limit) or
  `user-stated` (the user said usage is low).
- **Fallback.** Use another model than the rule's only for a reason you can name: an observed
  limit, the user's word, or a model that cannot be started. Record it with `--fallback "<why>"`.
- **Audit.** `runs` shows each current Run's `runMetadata.selection`, so the selection and any
  fallback reason stay readable after a restart. A Run with no selection was started without one.

## Retry context

Prepare this before starting a retry: `run start --retry` replaces the failed Stage Run, including
its worker, timestamps and reason. A retry starts another worker; it does not by itself authorize
discarding earlier work.

1. **Capture the previous attempt.** Read `stories show <KEY>` and the current `runs` result. Keep
   the failed Stage Run's attempt, worker, status, reason (or "not recorded"), and start/finish
   times, plus current identity/selection/heartbeat from `runMetadata` when available. A retry resets
   recognized metadata even if timestamps repeat, so retain this evidence first. Read the Story's
   Comments when that Plugin is on, and the prior worker's messages when
   its recorded identifier resolves. Summarize what it completed, validation and publication
   outcomes, and what remains; distinguish a failed worker or launch from failed implementation.
2. **Recover existing work.** Include the prior branch, worktree path, machine and PR URL whenever
   recorded in the Story, Comments or identified worker's handoff. Give the source for each detail
   (for example a Comment id or worker message). Verify recorded branches and PRs with Git or the
   hosting service when available, and paths on the recorded machine when accessible. Mark each
   missing detail "unknown" and an inaccessible or stale detail as unverified. Do not derive a
   worker identity or machine from a branch name, Story Key, Comment author or the current host;
   the Stage Run's `by` is who started it, not the worker. Report conflicting evidence rather than
   choosing an identity or treating unavailable work as absent.
3. **Decide how to proceed.** Follow an explicit continuation or restart instruction from the user,
   Stage Prompt or `ROWBLY.md`. Otherwise ask the user before choosing between existing work and a
   restart, or when missing/conflicting context prevents a safe choice. The brief must say either
   "Continue" with the exact known branch/worktree/PR and remaining work, or "Start again" with
   the reason and the instruction authorizing that deliberate restart. Preserve previous work;
   an unavailable machine or unknown branch is not permission to silently start again.
4. **Preserve and hand off.** Assemble the retry section of
   [the worker brief](references/worker-brief.md) in a file for `brief --retry-file`. If Comments
   are on, save the captured context, evidence sources and continuation/restart decision as a
   Comment before replacing the Run, so another supervisor can recover it. Otherwise retain it in
   the supervisor's messages and brief.
   Only then run `run start <KEY> --worker <name> --retry` with the new attempt's selection, as in
   [Start a Story](#start-a-story); launch only on success, using the
   returned attempt number and the captured previous outcome. Do not substitute the new Run's
   worker or status for the previous attempt's details.

## Returned work

A worker in a later Stage may move a Story back to an earlier one, for example to repair a pull
request. That is a new visit, not a retry: finish the later Stage Run before the move, and start a
new worker for the earlier Stage as for any Story. When the Story's Comments record the branch and
PR to repair, check that the PR is still open and its branch and head commit match the record, and
put them in the brief's other instructions with the failure to fix: "Continue" when the Stage
Prompt or `ROWBLY.md` says returned work is continued, otherwise as a question for the user. On a
mismatch, report it and ask; never start again or discard the recorded work.

## Independent review

Follow this when a Stage Prompt asks for an independent review before a merge. The reviewer must be
a new worker using a model different from every model that implemented the Story. Its approval
holds only for the commit it reviewed.

1. **Record each implementation.** A Run is an implementation when its worker can change the
   Story's code (for example, its Stage Prompt names `rowbly-dev`), finished or failed. Before you
   apply its block, whose move ends the Run and removes its metadata, add a Comment yourself:

   ```text
   Implementation record: <Stage name> attempt <n>, <finished|failed>.
   Worker: <worker> (thread <threadId>, harness <harness>, machine <machine>).
   Model: <provider instance>/<model>, options <id=value, …>. Source: <launch receipt or result>.
   Branch: <branch or unknown>. PR: <URL or unknown>. Head: <commit SHA or unknown>.
   ```

   Take the worker and model from the launch you verified, not from the worker's own message; take
   the head from `gh pr view <n> --json headRefOid` or the branch. Record a failed attempt too: it
   may have pushed commits.
2. **Check provenance before a review.** Read every implementation record in the Comments. When the
   branch has commits that no record accounts for (work from before this rule, a person, an
   unverified worker or an unknown model), you may add a record from verified evidence, such as a
   launch receipt or the harness's thread, citing it. Otherwise ask the user which workers and
   models wrote them. Never guess a model.
3. **Choose the reviewer.** Start a new worker: never send the brief to a thread named in a record.
   Its model must differ from every implementing model in the records. The same provider is
   allowed; changing only effort or options does not make it another model. When `ROWBLY.md`
   and the user leave no such model available, ask the user rather than reuse one. Append one
   filled Implementation records section to the actual generated review brief after its markdown.
   Include ALL verified authoring records, their evidence sources, and the selected
   reviewer's verified worker ID, thread ID, provider instance and model. Check the assembled
   message before GO; missing or unknown provenance requires asking the user, never guessing.
4. **Approval holds for one commit.** A review Comment approves only the head SHA it names. A commit
   pushed after it, including a merge of the base branch, needs another review. Changes requested
   send the Story back to be built; that Run gets its own record, and the next reviewer must differ
   from it as well.
5. **Check before Done.** Before you apply a move to a Stage of category `done` from a reviewing
   Stage, check that a review Comment, on the Board or earlier in the same block, approves the PR's
   final head (`gh pr view <n> --json headRefOid,state`) from a reviewer that meets step 3. If none
   does, do not apply the move; tell the user.

## Story PR links

When the GitHub Plugin is on and a worker opens a PR for a Story, save its reported URL with
`stories edit <KEY> --github-pr <url>`. Use that Story's GitHub PR field as the first PR candidate
when recovering work; without a link, use recorded Comments/branches and the hosting service.
Always verify the PR's repository, state, branch and current head; a saved URL proves no review,
check result or worker identity. Refused opaque data is a blocker, never permission to replace it.

## Worker messages

Workers end messages with these markers, as the brief asks:

| Marker                          | Action                                                                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a fenced `rowbly` block         | [Apply it](#apply-a-workers-commands); Rowbly holds its move until the Stage Run is finished.                                                                                                                                                                               |
| `FACTORY-QUESTIONS <KEY>`       | Answer from the Story, its Specs and Comments, the Stage Prompt and `ROWBLY.md` when they settle the question. Ask the user when you are not sure, and never guess at scope. Send the answers to the worker. If the Comments Plugin is on, record the answers as a Comment. |
| `FACTORY-DONE <KEY>`            | Run `run finish <KEY>`, add the [implementation record](#independent-review) when the Run implemented work, then apply its last `rowbly` block with any move held earlier added at its end.                                                                                 |
| `FACTORY-FAILED <KEY> <reason>` | Run `run fail <KEY> --reason "<reason>"`, add the implementation record when the Run implemented work, then apply its last block; Rowbly drops its move.                                                                                                                    |

Each message from a worker, and each event its harness reports for it (a turn starting or ending,
a commit pushed), is verified activity: record it as the Stage Run's heartbeat.

```sh
rowbly software-factory run touch <KEY> --stage <stage> --attempt <attempt> --started-at <startedAt> \
  --worker <worker> --source "<what you saw, such as: worker message, PLAN>" --json --no-prompt
```

Copy the Run and worker from `runs`. Touch only on activity you saw: not on polling, on the thread
being reachable, or on a status such as `completed` or `running`. Exit 4 means the Run changed or
has no attached worker: read `runs` again and do not attach just to touch. Exit 6: report it.

## Stale Runs

`runs` marks a running Stage Run `stale` when its worker has not been seen (its heartbeat, else its
start) for 15 minutes, or `--stale-after <minutes>` given to both `runs` and `wait`. Stale asks you
to check; it never permits clearing, failing, retrying or starting another worker by itself.

1. Find the worker through its attached identity and read its thread.
2. New activity since `lastSeenAt` (a message, a turn, a commit): touch with that as `--source`.
3. Waiting for a person, or for an answer you owe it: leave the Run as it is and tell the user once.
   Do not touch for waiting.
4. Verifiably gone (the harness reports the thread missing or ended with no final marker, and asking
   it for its state gets no reply): `run fail <KEY> --reason "<what you checked>"`; the usual retry
   rule then applies.
5. You cannot tell (the machine is unreachable, the evidence conflicts): report it to the user and
   leave the Run alone.

Finish or fail the Stage Run before you move the Story: a move ends the Stage Run.

After a PR is verified merged and its worker is finished, follow
[completion cleanup](references/cleanup.md) on the owning machine. This is a supervisor completion
step, not a new Stage Prompt or a sweep of historical Stories. Retain explicit resource ownership
at launch; cleanup defaults to dry run, requires fresh harness inactivity and an exclusive resource
lease, and retains remote refs and all evidence branches. Unknown or active resources stay.

## Waiting for pull request checks

A Stage whose work depends on a pull request's checks (merging, say) must not spend model turns
watching CI. Waiting is the supervisor's job, and a worker never loops on `gh pr view` or `gh pr
checks`.

- **Prefer an event.** If the harness can watch a pull request and wake you when its checks finish,
  a review arrives or the branch conflicts, use it, end your turn and act on the wake. The
  supervisor owns that watch; a worker does not start one. `ROWBLY.md` names the harness's tool.
- **A worker returns state instead of waiting.** Independent diff review may start and finish
  while checks are still running. Complete work that does not depend on CI first. If remaining
  work needs the checks, report the PR URL, the exact head SHA and each pending check's name,
  end the turn and let the supervisor resume it.
- **Fallback: one bounded watch.** Where there is no event, the supervisor starts a single command in
  the background, with the harness's way to resume when it exits, and never a loop of model turns:

  ```sh
  timeout 30m gh pr checks <number> --watch --fail-fast --interval 30
  ```

  Watch all checks; `--required` reports nothing on a branch without protection rules.
- **Inspect conclusions after every wake.** An event or any watch exit code is only a wake
  signal; exit 0 does not prove every check passed. Read once with
  `gh pr view <number> --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup`.
  Confirm the head SHA still matches the head being processed and inspect the full rollup for
  that current head before any merge. If it changed, discard the old result and process the new
  head. Classify actual check conclusions, not the watch exit code:

  | Outcome                          | Sign                                                                                                                               | Do                                                                                                                       |
  | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
  | Settled, all passed              | nonempty current-head rollup: every CheckRun is `COMPLETED` with conclusion `SUCCESS`, and every StatusContext has state `SUCCESS` | continue the Stage's work, subject to its other gates                                                                    |
  | A check failed                   | a conclusion of `FAILURE`, `TIMED_OUT` or `ACTION_REQUIRED`, or a StatusContext state of `FAILURE` or `ERROR`                      | route it as the Stage Prompt says for failed checks; name the check and its link                                         |
  | No checks yet                    | empty current-head rollup soon after a push (the watch may say "no checks reported")                                               | not a failure: wait one grace period (about 2 minutes) and watch once more; then report **waiting** or ask, never repair |
  | Still pending or wait timed out  | unfinished checks or pending StatusContexts, including after the watch's timeout (exit 124)                                        | not a failed check: report **waiting** with the head SHA and the pending names, or ask; do not repeat a timed-out watch  |
  | Terminal result needs a decision | `CANCELLED`, `SKIPPED`, `NEUTRAL`, or any unrecognized terminal conclusion or state                                                | does not establish all passed: follow an explicit policy or ask; never infer success from exit 0                         |

  A pull request that cannot be read or used (no access, wrong repository, closed) is separate:
  report the error and ask. `mergeable` reads `UNKNOWN` for a while after a push to the base
  branch; that is pending too.
- **Cancel and restart.** A push gives the pull request a new head and new checks, so cancel the
  watch for the old head (send the process a signal) and start one for the new head. Stopping the
  factory, finishing the Stage Run or moving the Story away cancels it too. Leave no watch running.

## Apply a worker's commands

Workers never change the Board; they report the commands their Stage Prompt asks for. Never run a
reported line yourself. Save the block to a file exactly as the worker wrote it and let Rowbly check
and run it:

```sh
rowbly software-factory apply <KEY> --file <block.md> --dry-run --json --no-prompt
rowbly software-factory apply <KEY> --file <block.md> --json --no-prompt
```

- Each line gets a `decision`: `apply`, `hold`, `drop` or `reject`, with a `reason`. Only the
  worker's own Story may be changed, with `stories edit|move`, `comments add|edit`, `tasks
  create|edit|move`, `specs create|edit --story` and `story-linking add|remove --blocks`; shell
  syntax, `--blocked-by` (it writes the other Story), `software-factory` commands and options such as
  `--data-root`, `--yes`, `--*-file` or `--finished-run` are rejected.
- **Rejected (exit 2).** Nothing ran. Tell the worker and ask the user about each rejected line. To
  run the allowed lines, write a new block with only those lines and apply it.
- **Held.** A `stories move` waits until the Stage Run is `finished`. Keep every held line; after
  `run finish`, add it to the end of the worker's last block. A move after `run fail` is dropped.
- **Failed at a line.** The lines before it stay applied (`exitCode` 0 in `details.commands`); the
  failed line and those after it did not run. Tell the worker and the user, and do not apply the
  lines that ran again. A move that fails with `CONFLICT` found its Stage Run cleared or replaced
  after `apply` read it (Rowbly ran it with `--finished-run`); it moved nothing. Check `runs` before
  applying it again.

Then push as [Board persistence](#board-persistence) says.

## Stopping

When the user stops the factory, start nothing new and tell the user which Stage Runs are still
running. Leave them running: the next supervisor takes them over at its start.
