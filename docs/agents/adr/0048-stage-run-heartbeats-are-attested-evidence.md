# ADR-0048: A Stage Run heartbeat records attested worker activity, and staleness only asks for a check

**Status:** Accepted; amends [ADR-0040](0040-stage-runs-record-the-current-visit.md).

## 1. Context

A Stage Run (ADR-0040) records when it started and ended, but not when its worker was last active.
A supervisor that restarts, or that watches many workers, cannot tell a working worker from one that
stopped, and has inferred activity by hashing worktrees. Age alone is a poor signal: a worker can be
quiet while it waits for a person, and a harness can show a thread as completed while it still works.

## 2. Decision

- A **heartbeat** is the `heartbeat` section of the Story's Stage Run metadata
  (`plugins/software-factory/run-metadata.json`, ADR-0046): `{ worker, at, source, by }`. It belongs
  to one Run, named by its stage, attempt and start time, and a new Run starts without one.
- `software-factory.touch` sets it. The supervisor runs it when it has verified worker activity: a
  message from the worker or an event from its harness, described in `source`. `at` is the time of
  the touch and `by` is Me. A touch is the supervisor's attestation; it does not mean the worker ran
  Rowbly. That the worker is reachable, or that the supervisor polled, is not activity.
- A touch names the Run it expects and the worker. It refuses (`CONFLICT`) and writes nothing unless
  the Story has a running Stage Run with exactly that stage, attempt and start time, and an attached
  identity with that worker; it never creates an identity or metadata. Metadata Rowbly cannot read or
  does not support refuses with `DATA_INTEGRITY` and stays as it is.
- `software-factory runs` shows each running Stage Run's last-seen time and age: since the heartbeat,
  or since the start when none was reported. A Run is **stale** when that age reaches a threshold,
  15 minutes unless `--stale-after` gives another.
- Staleness is a reason for the supervisor to check the actual worker, never a reason to act on the
  Run. Rowbly never clears, fails, retries or reassigns a Run because of its age. The supervisor
  touches it only on new verified activity, fails it with a reason when the worker is verifiably
  gone, and otherwise reports it to the person; a worker waiting for a person stays shown as such.
- The `runs` digest includes whether a Run is stale but not its age, so reading again, or waiting,
  changes nothing until a heartbeat is saved or a Run becomes stale.

## 3. Rejected alternatives

- **A heartbeat in the Stage Run bag.** Older Rowbly versions rewrite the bag with their schema and
  would drop it silently.
- **Workers touch their own Run.** Workers do not write the Board (ADR-0040 §2).
- **Clearing or retrying stale Runs automatically.** A quiet worker may be waiting for a person; a
  second worker on the same visit duplicates work.
- **A count of heartbeats.** Repeated observations do not show distinct activity.
- **The age in the digest.** Every read would change it and wake a waiting supervisor.
