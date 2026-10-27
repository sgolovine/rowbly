# ADR-0040: A Stage Run records one agent's work on a Story's current visit to a Stage

**Status:** Accepted

## 1. Context

A factory supervisor (the `rowbly-factory` skill) watches a Board and starts a worker for each Story
that arrives in a Stage whose Stage Prompt is on (ADR-0039). It must not start a second worker for
the same visit after a restart, and it must start one again when the Story comes back, for example
from Review to In Progress. A Story records no Stage history, so the supervisor cannot tell from the
Story alone whether a Story in In Progress was already worked there, and a Story that went A → B → A
while nobody watched looks as if it never left A.

## 2. Decision

- A **Stage Run** is one record in the Story's Software Factory bag,
  `plugins.software-factory.stageRun`: `{ stage, status, attempt, worker, by, startedAt,
  finishedAt?, reason? }`. `status` is `running`, `finished` or `failed`; `attempt` starts at 1;
  `worker` names the agent or thread; `by` is Me of whoever started it, or `null`.
- A Story has at most one Stage Run, and it counts only for the visit it was started in. The Plugin's
  `stories.move` and `stories.update` transforms remove it when the Story's Stage changes, in the same
  Change Set. A Stage Run whose `stage` is not the Story's current Stage is ignored, which covers
  Stage changes that run no hook (a git merge, a hand edit). An invalid bag is not removed; doctor
  reports it as invalid Plugin Data.
- No history is kept. Past Stage Runs have no reader; Comments hold what a worker reports.
- `software-factory.start` refuses a Story whose Stage has no Stage Prompt that is on, and a Story
  with a Stage Run for this visit, unless that Stage Run failed and the start is a retry, which adds
  one to `attempt`. `finish` and `fail` end only a running Stage Run. `clear` removes any Stage Run,
  so the Stage is worked again.
- One supervisor works a Board. A Stage Run is a record of work, not a lock between machines: two
  supervisors that share a Data Root through git can both start one before they synchronize.
- Workers do not write the Board. The supervisor starts and ends Stage Runs and applies the Board
  changes its workers report, so the Data Root has one writer even when workers run in other
  checkouts or on other machines.

## 3. Rejected alternatives

- **A Stage Run list kept as history.** It grows on every visit and nothing reads it.
- **Only a Stage key, no move hook.** A → B → A while unwatched would look already worked.
- **An entered-Stage time stamped on every move.** It adds core-looking data to every Story for one
  Plugin's question, and still needs the Stage Run.
- **A Plugin file per Board instead of the Story's bag.** The move hook would write a second file, and
  the record would not travel with the Story.
- **Stage Runs as claims across machines.** Claim-then-synchronize over git is racy and needs a
  conflict rule; one supervisor per Board is enough today.
