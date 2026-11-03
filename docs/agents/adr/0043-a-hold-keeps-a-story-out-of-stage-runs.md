# ADR-0043: A hold keeps a Story out of Stage Runs and lives in its own Plugin file

**Status:** Accepted

Amends [ADR-0040](0040-stage-runs-record-the-current-visit.md) §2: `software-factory.start` also
refuses a held Story.

## 1. Context

A factory supervisor starts a worker for every Story that arrives in a Stage whose Stage Prompt is on
(ADR-0039, ADR-0040). A person who wants to handle one of those Stories by hand had no way to say so:
moving the Story elsewhere changes its Stage, and clearing or failing its Stage Run only invites the
supervisor to start it again. The person needs a request the supervisor cannot miss, that says why,
and that can be taken back without losing the Story's Stage Run.

The Stage Run lives in the Story's Software Factory bag, `{ stageRun }`. Rowbly releases that know
only that shape read a bag with an extra key as valid, and drop the key when they write the bag
(docs/plugins/compatibility.md §3.3); `stories.move` writes it on every Stage change. A hold kept in
that bag would vanish without a word the first time an older Rowbly touched the Story, and the
supervisor would start it.

## 2. Decision

- A **hold** is one Story-scope Plugin file, `boards/<board>/stories/<KEY>/plugins/software-factory/hold.json`:
  `{ "version": 1, "reason", "by", "heldAt" }`. `reason` is required; `by` is Me of whoever held it,
  or `null`. The Story's bag and its Stage Run do not change shape.
- `software-factory.hold` writes the file and `software-factory.release` deletes it, each as one
  operation. Holding a held Story is a `CONFLICT`; releasing one that is not held is `NOT_FOUND`.
  Neither touches the Stage Run, so its `attempt`, `worker` and `reason` survive a hold and release.
- A hold belongs to the Story, not to a visit: it stays through Stage changes, and only `release`
  ends it.
- A held Story is not eligible for a Stage Run: its eligibility has the reason `HELD`, whose message
  names who held it and why. `software-factory.start` refuses it (`CONFLICT`), `--retry` included. A
  Stage Run that is already running when the Story is held keeps running; the person stops its
  worker.
- A hold file this Rowbly cannot read (not JSON, invalid, a `version` other than 1, fields version 1
  does not have, or a path it cannot read safely, such as a symbolic link, which is never followed)
  counts as held. `hold` and `release` refuse it with `DATA_INTEGRITY` and leave it unchanged, and doctor
  reports it as `SOFTWARE_FACTORY_UNREADABLE_HOLD`.
- A Rowbly release without holds never reads, writes or deletes the file, and keeps it when it moves
  or renumbers the Story's folder. It does not know holds, so a supervisor that runs it starts held
  Stories: run the factory with a Rowbly that has them.

## 3. Rejected alternatives

- **A `hold` key in the Stage Run bag.** Older releases read the bag as valid and drop the key on
  their next write, so the hold is lost silently and dispatch resumes.
- **A versioned bag that the old schema rejects.** It turns every Stage Run bag written by the new
  release invalid to older ones, which then refuse to start, finish or clear Stage Runs, and it
  needs a migration for bags written before. A separate file needs neither.
- **A Label such as `hold`.** It is a convention, not a rule the start refuses, and a Label carries
  no reason or author.
- **Ending a hold on a Stage change.** A person who handles a Story by hand moves it through several
  Stages; the factory would take it back at the next one.
