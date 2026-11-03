# Completion cleanup

This is a supervisor completion workflow, after it verifies a task PR merged and finishes the
worker's Stage Run. It is not another Stage Prompt: do not turn on a Done prompt or dispatch
historical completed Stories. Run on the machine recorded as owning the resources. An unavailable
owner, uncertain identity or active assignment means retain and report, never infer absence.

## Ownership and inactivity

At launch, retain a supervisor-owned resource record outside the checkout, beside the verified
launch receipt. Add resources as the worker creates them. Do not reconstruct ownership from a
branch prefix, Story Key, CWD scan, daemon environment variable or quiet/completed thread alone.
Record the exact repository, merged PR/head/base, canonical checkout/worktree paths, all worker and
descendant thread IDs, and only daemon state directories created exclusively for this task. Never
archive threads as part of cleanup; retain receipts and Run metadata.

Before cleanup, reconcile every assigned/reserved/running thread on the owning harness, including
its children and any manual continuation. The supervisor must hold an exclusive lease preventing
new assignments, checkouts or Git edits involving these resources for the entire cleanup command.
A process CWD scan is an additional refusal check, not proof that a harness has released a worktree.
If the harness cannot provide this exclusion, use dry run and retain the resources.

## Helper

`node scripts/clean-up-task.mjs --record /absolute/task.json` (relative to this skill's folder)
checks only listed local resources. Add `--apply` only after reviewing the dry run and confirming
completion/inactivity. Do not run it from a task worktree scheduled for removal. For remote owners,
invoke the installed script through SSH **on that owner**, with its record and harness adapter;
there is no local fallback or automatic discovery/sweep. It requires Node, Git, authenticated `gh`
and Linux `/proc` for worktree/daemon checks. It never fetches; fetch the base on the owner first.

The JSON record shape is:

```json
{
  "story": "WEB-42",
  "machine": "owner-hostname",
  "repo": "/absolute/control-checkout",
  "repository": "owner/repository",
  "pr": 123,
  "branch": "factory/web-42",
  "base": "main",
  "prHead": "0000000000000000000000000000000000000000",
  "worktrees": ["/absolute/task-worktree"],
  "daemonStates": ["/absolute/task-resources/agentic-tui"],
  "threads": ["verified-thread-id"],
  "protectedBranches": ["release", "factory-control"],
  "lease": "supervisor-exclusive-resource-lease-id",
  "harnessCheck": ["/absolute/supervisor-harness-check", "--lease", "supervisor-exclusive-resource-lease-id"]
}
```

Use the real PR head, hostname and paths; the sample is not runnable. `harnessCheck` is a trusted,
supervisor-configured executable/argument vector, run on the owner with no shell. It receives the
whole record as JSON on stdin. It must query the recorded harness afresh, validate exact Story/PR,
resource and thread ownership, confirm no assignments or descendants remain active, and verify its
exclusive lease is still held. Success exits 0 with `{ "inactive": true, "exclusive": true,
"record": <the exact input record> }`. It must fail on unknown/unreachable/conflicting state.
Do not replace it with an echo command or a static timestamp/attestation. No generic adapter is
shipped: harness commands and leases differ by factory. Until the supervisor provides one, cleanup
is unavailable and the resources stay. The helper re-runs it before resource actions.

The helper verifies the exact same-repository merged GitHub PR and its head/base, origin identity,
and that the PR merge commit is an ancestor of the current remote base. This supports squash merges
without treating an arbitrary merged ancestor as ownership. Local task branch and listed worktree
HEADs must equal that PR head. Protected main/master/develop, PR base, live default branch, control
checkout branch, configured protected branches and every `pr-assets/` branch are refused.

It retains dirty, untracked/ignored, locked, submodule or mismatched worktrees, any task with stashes
(their ownership is ambiguous), and worktrees with live CWD users or unreadable process information.
It uses `git worktree remove` without force. Immediately before branch deletion it rechecks all
worktrees for that branch, then uses Git's atomic expected-old-tip `update-ref -d`. An advanced tip
is never deleted. Git has no atomic lock spanning checkout discovery and branch deletion: the
supervisor lease is mandatory, and a dry run is not permission to apply later without fresh checks.

One JSON result reports each resource. Exit 0 means the requested local plan/actions succeeded;
exit 2 means a local resource was kept; exit 1 means a prerequisite/action error. An error includes
any actions already completed; it does not imply rollback. Report retained resources and reasons
in the task's completion handoff. A missing worktree requires reconciling the record rather than
silently deleting its branch. Nothing removes the record, receipts, logs or evidence.

## Task-owned daemons

For each new screenshot/test task, create a fresh private directory outside the repository and
set `AGENTIC_TUI_STATE_DIR` to its canonical absolute path before starting agentic-tui. Record this
exact path against the task before use. A session namespace alone shares the daemon. Never adopt,
stop or clean an existing/shared/default daemon, and never stop a process solely because its CWD
is a task worktree. Workers close their sessions and scoped daemon before returning; the supervisor
handles a leftover only through the recorded ownership workflow.

The helper checks daemon.json, the Linux PID/start identity/arguments, the exact state-dir environment
and the scoped API's PID and sessions. Running sessions cause retention. It rechecks process and
state identity before authenticated loopback `/shutdown`, waits briefly for exit and never signals
an unknown/replaced/unresponsive process. API failure retains and reports it. Tokens never appear
in output. Other task-owned watchers/servers must be stopped by their owning worker; this helper
does not guess ownership of arbitrary processes.

## Remote branches, evidence and repository settings

**All remote task refs and all local/remote `pr-assets` branches are retained.** A non-force remote
branch delete cannot compare the expected old tip atomically; another worker could advance it
between inspection and deletion. Report the ref/tip for supervisor reconciliation, rather than use
an unsafe delete or force push. The helper only lists remote task/evidence refs.

Linked screenshots remain available indefinitely in coordination with ROW-65. Associated
`pr-assets` cleanup is conditional/deferred, not satisfied by deleting links: it requires a separately
approved retention policy and archival destination, a verified durable copy, updated PR references
and verification that no remaining link depends on the old branch. Until then retain every asset
branch, even if the task merged. This helper never deletes them.

Repository automatic head-branch deletion on merge is a **proposal**, not performed by this helper
or skill. The supervisor may propose enabling it after reviewing repository protection and evidence
retention; do not execute a setting change without the user's approval. It does not replace local
worktree cleanup or authorize evidence deletion. Report this setting and retained remote/evidence
resources as conditional/deferred acceptance criteria, never as resources already cleaned.
