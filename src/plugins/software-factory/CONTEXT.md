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

## Stage Prompts and ROWBLY.md

`ROWBLY.md` describes how people work with every Board of the Data Root, in one file Rowbly does not
read. A Stage Prompt is one Stage's instructions, turned on or off per Stage and Board, that
`rowbly software-factory stages` hands to an agent with the Stages.
