# Git Plugin: Automatic Commits and synchronization

Every command below takes `--json --no-prompt`.

The Git Plugin commits saved Rowbly changes to the git repository that holds the Data Root. Enable it
only when the user asks: future Rowbly writes will create commits. Automatic Merge Conflict Resolution
is a separate personal preference, Off by default; enable it only when the user asks for unattended
fetch/merge/push to the configured upstream.

## 1. Turn it on

The Data Root must be inside a git repository; otherwise `plugins enable git` exits 2 with an
explanation and leaves it off (an enabled Plugin loaded outside git shows as failed in `plugins list`).
Establish a clean Data Root baseline first: commit or stash pending edits under `.rowbly/`, because
edits by hand to an affected path are included in the next Automatic Commit.

```sh
rowbly plugins enable git --json --no-prompt
rowbly git show --json --no-prompt          # current preferences and the defaults they fall back to
```

## 2. Configure it

```sh
rowbly git configure --automatic-commits off --json --no-prompt             # pause locally; Plugin stays enabled
rowbly git configure --automatic-commits on --json --no-prompt              # resume saved frequency and author
rowbly git configure --frequency change --json --no-prompt                  # commit after each change (default)
rowbly git configure --frequency interval --interval 600 --json --no-prompt # batch, at most every 600 s
rowbly git configure --author-name "Rowbly Bot" --author-email "bot@example.com" --json --no-prompt
rowbly git configure --author-name '' --author-email '' --json --no-prompt  # back to git's user.name / user.email
```

- Preferences are personal, under `plugins.git` in Local State (`local.json`): `frequency`
  (`change` or `interval`), `automaticCommits` (boolean, default `true`, also when absent),
  `intervalSeconds` (an integer 1–86400, default 300), `authorName`, `authorEmail`. Do not edit that file by hand; use `git configure`. They take effect at once and are
  never committed. `git show` reports Automatic Commits On/Off (`automaticCommits` in JSON). Enabling
  the Plugin is still shared Data Root configuration. The TUI Git settings offer the same On/Off choice.
- Blank author fields clear the saved value and use git's effective `user.name` and `user.email`, including
  `.gitconfig`; `git show` reports them. Omitted configure flags preserve saved preferences.

## 3. What it commits

- Each Automatic Commit has the message `chore: update Rowbly data`. It includes the paths that saved
  Rowbly changes affected, deletions and other Plugins' writes included. Local State, locks and
  `.txn/` are excluded; git ignores still apply.
- Other paths and unrelated staged files stay untouched. An affected path that already has staged
  changes is refused with a warning instead of committed.
- Hooks and commit signing are turned off for Automatic Commits. Automatic Commits do not push, create branches or
  install hooks; synchronization can commit and push independently.

## 4. When it commits

- Saved changes enter a queue; rapid edits may share a commit. A CLI command waits for the commits that
  are due, but not for a future interval deadline.
- Interval mode starts its deadline at the first pending change and commits only when files changed.
  Timers run only while Rowbly is running: there is no daemon, and nothing is flushed on exit. Pending
  paths persist in git's own directory and, while Automatic Commits are On, are committed by the next
  Rowbly run once due. Changing the interval moves the deadline relative to the first pending change.
- Turning Automatic Commits Off keeps the Plugin enabled and its settings accessible, cancels waiting
  timers and prevents Automatic Commits after changes, at a deadline and on restart. Saved changes still add
  pending paths. Frequency, interval and author preferences remain saved; editing them does not turn
  Automatic Commits On. Turning On resumes at the selected frequency: change commits immediately;
  interval uses the first-pending deadline (adjusted by interval edits) and commits immediately if due.
- Disabling the Plugin also pauses waiting work and keeps pending paths. A commit already running may
  finish; later edits stay pending.
- A git failure (missing author, an index lock, a merge in progress) warns, keeps the Rowbly change
  saved, and leaves the work pending for a later run. Fix the cause, then run Rowbly again.

## Manual Sync

Use explicit manual Sync only when synchronization is requested. With Git On, `S`/the header **Sync**
Button has the same behavior as:

```sh
rowbly git sync --rebase --json --no-prompt
```

- It works with both automatic preferences Off and changes neither. It runs literal `git pull
  --rebase` in an owned private context BEFORE staging/committing pending Rowbly additions, edits and
  deletions, then normally pushes to the configured upstream. No-change requests still pull/push
  without creating an empty or audit-only commit. It preserves unrelated staging/dirty/untracked
  bytes, Local State/locks/transactions and later pending revisions. Never use force-push, reset-hard,
  whole-repository staging or a stash to bypass a refusal.
- Replay uses the existing reconciliation rules, including recognized identity and Custom Field
  continuation and committed resolution edits from normal two-parent Rowbly merges. Unknown/future
  data stays opaque. Ambiguous merge bases, octopus merges, non-Rowbly merge-only resolution edits,
  unprovable skipped correspondence and ambiguous new alias destinations refuse before publication.
- Wait for this command's exact `{ id, mode: "rebase", commit, upstream, evidence, repairs,
  pushed: true }` result. An automatic merge, old `last`, active phase or local commit alone cannot
  prove manual success. Simultaneous callers join the same manual id, including across processes.
  The header disables duplicate input and shows progress, including at compact widths; success
  appears only after push. Late root/host results cannot toast in another session.
- `CONFLICT`/4 failures have empty stdout and the usual JSON error on stderr. A rejected push retains
  the valid local commit and evidence in error details. Resolve the cause, preserve that evidence,
  then explicitly run manual Sync again. Unresolved publication recovery stays `DATA_INTEGRITY`/6.
  Missing/interrupted receipts mean the push result is unknown. Restart performs only local recovery
  for manual intent; it never retries its network request automatically. Git Off/host disposal stops
  unadmitted work; admitted work can finish and later edits remain pending.
- Bare `git sync` and settings **Run now** keep the automatic merge behavior below. Its On/Off does
  not disable manual Sync. `git show` includes `manualAvailable`, optional pending `manual`, and
  `mode`/`id` on active/last results, so a manual rebase is distinguishable from an automatic merge.

## 5. Automatic Merge Conflict Resolution

```sh
rowbly git configure --automatic-merge-resolution on --merge-interval 600 --json --no-prompt
rowbly git sync --json --no-prompt
rowbly git show --json --no-prompt
rowbly git configure --automatic-merge-resolution off --json --no-prompt
```

- `synchronization` in personal `plugins.git` Local State defaults to `{ enabled: false,
  intervalSeconds: 300 }`; the merge interval accepts 1–86400 seconds. Configure only supplied fields:
  `--merge-interval` preserves enablement, and `--automatic-merge-resolution` preserves the interval.
  Neither changes Automatic Commits, its frequency, interval or author. Synchronization includes
  pending Rowbly changes even with Automatic Commits Off. Do not edit Local State by hand.
- The current branch needs a configured upstream and working noninteractive Git authentication.
  A run fetches that upstream, prepares a merge separately, reconciles Rowbly data/configuration,
  validates and commits the result when needed, then pushes normally. No prompts/editor, rebase,
  force-push, automatic branching or hook installation is used.
- Independent fields and non-overlapping Markdown hunks combine. Conflicting leaves or overlapping
  hunks use stable content/source ordering, retaining exact base, both alternatives, provenance and
  decisions in committed content-addressed `plugins/git/merge-evidence/` files. Edit wins over delete,
  including edited descendants. Distinct concurrent additions retain both complete records/scoped
  files with source-qualified key remapping; identical additions coalesce. Configuration Cascade
  levels stay separate; referenced definitions may be restored, incompatible field types split and
  constraints relaxed to retain valid data, with original values and repairs in evidence.
- Supported format handlers reconcile only their own Plugin Data/files, including when their Plugin
  is Off. Unknown, invalid or future data stays opaque; unsafe reconciliation stops with alternatives
  preserved. Do not rewrite unfamiliar bags or apply blanket doctor fixes to make a merge succeed.
- Repeated Task numbers or Comment ids in a recognized current-format bag in BASE or either source
  stop synchronization with `CONFLICT` (exit 4) before local publication or push. Raw inputs, live
  branch, index and remote stay unchanged, including while the owner is Off. Another source's future
  shape does not hide a known duplicate. With the owner on, doctor reports `PLUGIN_DATA_INVALID`
  (warning), with no automatic fix. Preserve both records while resolving their identity by hand.
  Individually valid concurrent additions still retain both records with evidence.
- Timers run anywhere in the open TUI, including outside settings. The persisted deadline is initial
  scheduling time or last attempt completion plus the interval. Changing the interval recalculates
  from that anchor. Reopening resumes one overdue attempt, then schedules a full interval later.
  No daemon runs while closed. CLI commands drain due/admitted work, then exit without waiting for
  future deadlines; do not wait in a loop for them.
- Off disables Run now and prevents future admission, including stale timers. An already admitted
  run may finish, including push. Disabling Git, replacing a host, switching Data Roots or shutting
  down stops future scheduling for that host, retaining preferences and results. Local crash recovery
  completes before reads/writes even while Off, without network work or a newly authorized push.
- Runs serialize with other Rowbly processes, linked worktrees, writes and Automatic Commits. Later
  saved edits remain pending. Unrelated staged, dirty and untracked content stays intact; non-Rowbly
  conflicts, unsafe local path overlap and staged Rowbly ambiguity stop safely. Missing upstream,
  detached HEAD and authentication/network errors report their cause. Fix the cause and let the next
  interval or an on-demand attempt retry. A rejected push preserves the valid local merge; the next
  enabled attempt fetches/reconciles again before a normal push.

### Read the result

`git show --json` returns preferences plus `synchronizationRun`; `git sync --json` returns that run
summary directly. Required `enabled` and `intervalSeconds` reflect current preferences. Optional
`branch`, `upstream` and `prerequisite` explain setup. `requested` means pending; `active` includes
run identity, process, host, start time and phase. `last` includes `kind` (`synchronized`, `failed`,
`interrupted`), message, start/finish time, optional local commit/upstream, evidence paths and repairs.
All times are epoch milliseconds. Inspect pending/active before interpreting `last`: an old successful
result can coexist with a new run. A local commit alone does not prove push success; require a
completed `last.kind: synchronized`. Preserve reported evidence paths in your handoff. Do not report
successful synchronization after a rejected push or while another process is still running it.

For a person using the TUI: settings (`,`) → **Git** shows the exact **Automatic Merge Conflict
Resolution** section. `m` edits its preferences, `e` edits Automatic Commits, and `ctrl+s` saves either
form. The clickable **Run now** control has the matching `r` key; both are disabled while Off, pending
or running. The overview shows upstream/prerequisite, deadline, active phase, last attempt/result/time,
commit, repairs and evidence paths. Scroll for long results.

## 6. With doctor

`doctor --fix` repairs are saved changes too. To inspect every repair before the next commit, disable
Git first (`rowbly plugins disable git`), remember that it was on, run the repairs until
`rowbly doctor` exits 0, then `rowbly plugins enable git`. Keep other Plugins on so their checks run.

## Common mistakes

- **HIGH: picking `change` when the user asked for commits every N minutes.** Use
  `--frequency interval --interval <seconds>`.
- **MEDIUM: waiting or running a loop for an interval commit.** CLI commands do not wait for a future
  deadline; the next Rowbly run commits it.
- **MEDIUM: assuming Automatic Commits Off also prevents synchronization commits or pushes.** The
  two preferences are independent; inspect and configure each explicitly.
- **MEDIUM: enabling it with unrelated edits under `.rowbly/`.** They are swept into the next Automatic
  Commit. Start from a clean baseline.


For bare `git sync`, a completed failed attempt returns `CONFLICT` (exit 4), with the usual
JSON error on stderr and the safe run summary in `error.details.synchronizationRun`, including any
retained local commit and evidence paths. It prints no success result on stdout. An active or pending
run owned by another process returns its run summary with exit 0; this means pending, not synchronized.
`git show` remains an inspection command and can successfully display a previous failed result.
