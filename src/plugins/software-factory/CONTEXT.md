# Software Factory

A Built-in Plugin that gives each Stage of a Board a Markdown Stage Prompt, so an agent that works the
Board knows what to do with a Story in each Stage.

## Language

**Stage Prompt**:
A Markdown file of instructions for an agent working on a Story in one Stage (Backlog and Done
included). Each Stage Prompt is on or off, off by default, and is set per Stage key at the global
level (`rowbly.config.json`) or the Board level (`board.config.json`); a Board's entry for a Stage
replaces the global entry for that Stage. An agent treats it as on only when its setting is on, its
path points inside the Plugin's folder for its level, and the file exists.
_Avoid_: column prompt, lane prompt, status prompt

**Stage Run**:
One agent's work on a Story during the Story's current visit to a Stage whose Stage Prompt is on:
running, finished or failed, with its attempt number and the worker that does it. A Story has at
most one, and a change of Stage ends it, so the next visit starts unworked.
_Avoid_: job, claim, lock

**Supervisor**:
The one agent that watches a Board, starts a Stage Run and a worker for each Story that arrives in a
Stage whose Stage Prompt is on, and makes every change to the Board that its workers report.
_Avoid_: orchestrator, manager, dispatcher

**Worker**:
An agent the Supervisor starts for one Stage Run. It follows the Stage Prompt and reports the Board
changes it wants instead of making them.
_Avoid_: runner, bot

**Reported block**:
The fenced `rowbly` block in which a Worker reports the Board changes it wants. The Supervisor
checks and applies it with `software-factory apply`, which refuses it whole when any line is not an
allowed command that writes only the Worker's Story, and holds a move until the Stage Run is
finished; the move it runs names that Stage Run, and is refused when it is no longer the visit's.
_Avoid_: patch, script

## Stage Prompts and ROWBLY.md

`ROWBLY.md` describes how people work with every Board of the Data Root, in one file Rowbly does not
parse or enforce; `rowbly software-factory brief` copies it into a Worker's brief as text
(ADR-0047). A Stage Prompt is one Stage's instructions, turned on or off per Stage and Board, that
`rowbly software-factory stages` hands to an agent with the Stages.

## Launch eligibility

`runs` includes eligibility independently of Stage Run state. With Story Linking on, unfinished
blocking Stories prevent starts and retries until they reach Stage category `done`. Software Factory
uses Story Linking's public Story filter; Story Linking checks its own links again in the final start
guard. Refusal leaves the stored Run and attempt unchanged. Disabled link data stays preserved.

## Worker identity and recovery

A Stage Run's worker string is a launch hint until `run attach` records the supervisor's verified
machine, harness and thread identity in `run-metadata.json`. Rowbly records that attestation; it
does not contact the harness. Metadata belongs only to the current Run and is explicitly reset
on every start, including retry. Clear/Stage changes remove recognized metadata, while finish/fail
keep it. Unknown data remains unavailable and unchanged. Resolve remote identities on their
recorded machine before deciding whether work is gone; publish attachment before GO.
