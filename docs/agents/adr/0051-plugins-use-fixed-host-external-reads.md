# ADR-0051: Plugins use fixed host-owned external reads

**Status:** Accepted. Built for ROW-69. Extends [ADR-0020](0020-plugin-execution-and-data-contracts.md) §1. Amended by [ADR-0054](0054-board-stats-use-bounded-plugin-reads.md) §1–2.

## 1. Fixed templates

The GitHub Plugin needs to inspect a linked PR with GitHub CLI without importing Node or adding
network work to a save. A Plugin declares `externalReads: ['gh-pr-view']` and calls
`plugin.externalRead(name, parameters, { signal })`. Only the named host-owned template exists;
Plugins cannot declare or supply executables, argv, environment variables or working directories.
Unknown or duplicate template declarations fail loading before Plugin start.

The storage adapter owns `gh pr view <url> --json` and its fixed field selection. It checks that
`url` is an HTTPS PR URL without credentials or extra URL parts. The Plugin validates its input too.
The result is `{ exitCode, stdout, stderr }`. Missing executables, output limits and deadlines fail;
nonzero exit codes are returned for the Plugin to explain. No shell is used and stdin is closed.
Core records and core domain code gain no Plugin fields or vocabulary. The pipeline only transports
names, parameters and results; the host/storage boundary owns the fixed invocation.

## 2. Capability lifetime

Only a live command scope for that Plugin, or a host-issued screen context with an unrevoked lease,
can start an external read. React effects and timers have no execution scope, so absence of a scope
alone never grants this capability. The host gives mounted Plugin screens and slots a leased context;
ordinary contexts and hook contexts cannot create a lease. Hook contexts have no external-read API.
A retained command or screen context still refuses calls while executing a body, replacement,
transform, guard, commit, reaction, doctor callback, field, filter, row or option-input callback.
Ended and other Plugins' command scopes are refused too. Badge and search callbacks run as rows.

The screen's abort signal revokes its lease on unmount. The loaded Plugin owns another signal,
aborted on disable, failure or host disposal. TUI reload, Data Root replacement and command shutdown
dispose their host. `externalReadSignal` combines these lifetimes so a screen can stop its own refresh
timer immediately. A caller's optional signal also cancels a queued or running call. All checks
happen before spawning; reads run outside the Data Root lock and save nothing.

## 3. Resource bounds

Each loaded Plugin may run two processes and queue eight more calls; excess calls fail immediately.
Waiting calls are cancellable. Each running call has a 10-second deadline, 1 MiB stdout and 64 KiB
stderr caps. Cancellation, a deadline or overflow sends SIGTERM, then SIGKILL after 250 ms if needed.
The slot stays occupied until the child closes. Output beyond a cap is discarded, never returned as
valid JSON. Completion removes abort/exit listeners and deadline/escalation timers. Host disposal
cancels all running and queued calls; process exit also kills its children. Deadline and escalation
timers are unreferenced. A running request retains its process pipes until completion or cancellation.

`test/plugins/pipeline.test.ts` extends the kept capability test with a controlled child protocol:
fixed argv, command/screen admission, refused scopes, limits, timeout/escalation, bounded concurrency,
queued cancellation and disposal. Loading tests cover invalid declarations. This adds no test count.

## 4. Trust and rejected alternatives

This is a safeguard against accidental misuse by trusted in-process Built-in Plugins, not a
permission, sandbox or confinement. Code still runs with Rowbly's authority; a different `gh` on PATH
or malicious Plugin code can evade the convention. See [trust.md](../../plugins/trust.md).

- No public arbitrary process runner or Plugin-defined executable/argv templates.
- No subprocesses from save hooks, doctor analysis or display callbacks.
- No persisted polling data or background CLI polling. The GitHub Story tab owns its active refresh.
- No implicit overwrite or repair of opaque GitHub bags: unknown formats remain unchanged.
