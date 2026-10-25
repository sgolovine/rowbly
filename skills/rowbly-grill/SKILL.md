---
name: rowbly-grill
description: "Interview a person about a Rowbly Story through a browser form or numbered chat rounds, resolve its design questions, and save the agreed specification and qualifying decisions as Story Specs. Use with a Story Key or number to sharpen a Story before implementation."
---

# Rowbly Grill

Accept `$rowbly-grill STORY-12`, `/rowbly-grill STORY-12`, or a request naming rowbly-grill with a
Story Key, case-insensitive. A bare number resolves against the current Board, as below. If no Key
or number was supplied, ask for one; never choose a Story.

Read [the Rowbly reference](references/rowbly-reference.md) before **every** Rowbly usage.
Use `--json --no-prompt` on every call and pin the intended Data Root with `--data-root <path>`.
In the Rowbly source repository without a global install, use `pnpm --dir <control-checkout>
--silent dev` as the command. Read the Data Root's `ROWBLY.md` before writing.

## Before the first interview question

1. Resolve a bare number with `rowbly use` and `rowbly boards list`: match the current Board id and
   use its `keyPrefix`. If no current Board can be resolved, ask which Board; never guess.
2. Run `rowbly plugins list --json --no-prompt`. Require Specs to have **both** `enabled: true` and
   `loaded: true`. Otherwise refuse to start: explain that Specs must be enabled and loaded, show
   `rowbly plugins enable specs --json --no-prompt` with the same Data Root, and do **not** enable it.
   If enabled but not loaded, report the loading problem too. Plugins are enabled for the entire
   Data Root, shared by its people, never per Board or per developer (ADR-0010).
3. Run `rowbly stories show <KEY>`. On exit 3 `NOT_FOUND`, stop and report the missing Story; do not
   create it or substitute another. On any other failure, report it and stop.
4. Require a nonempty `description` after trimming whitespace. Existing Specs do not satisfy this
   gate. Refuse an empty description and tell the person to run `rowbly stories edit <KEY> --edit`
   to describe the Story, then invoke this skill again. This is advice for the person: never run the
   interactive editor yourself.
5. Read `specs list --story <KEY>` (including existing `spec` and `adr-*`), Comments and Tasks when
   their Plugins are enabled and loaded, the linked Epic (`plugins.epics.epic`), and linked Board
   Specs (`plugins.specs.specs`, using `specs show <slug> --board <story.boardId>`). Read relevant
   existing repository ADRs as context too. Existing Specs and accepted ADRs settle questions; do
   not ask the person to decide them again unless they explicitly want to revisit them. Surface
   conflicts for their decision instead of silently reversing an accepted decision.

Do not start the UI or ask design questions until these gates pass. A request for the missing Key
or Board is input resolution, not an interview round.

## Interview and save

Read [grilling](references/grilling.md) and [the UI protocol](references/ui-protocol.md) before the
first round. Maintain the design tree, ask the whole currently answerable frontier, recommend an
answer to every question, and wait for the person's decisions. Dispatch fact-finding subagents for
facts you can discover; people decide trade-offs. If delegation is unavailable, investigate facts
yourself and report that limitation. Do not turn a research result or a recommended answer into a
person's decision.

Persist agreed material as each frontier settles, rather than waiting until the end. All writes go
through Rowbly commands with `--json --no-prompt`; never write `.rowbly/` files directly. Keep the
Story description and Stage unchanged. The reference's general development Stage/commit defaults
do not apply to this interview. Do not implement, create branches, edit source, or treat the grill
as permission to implement.

The main Story Spec has slug `spec`. Keep its existing agreed material while updating these sections:
**Goal**, **Scope**, **Non-goals**, **Behavior**, **Edges**, **Open questions**, and a short **Resolved
glossary** for settled domain terms. This glossary replaces a separate `CONTEXT.md`. Distinguish
open questions from decisions; never fill an unanswered question with your recommendation.

For a new main Spec, send Markdown on stdin to:

```sh
rowbly specs create --story KEY --title "Story title" --file - --json --no-prompt
```

For an existing one, use `rowbly specs edit spec --story KEY --file - --json --no-prompt`.
Apply the pinned `--data-root` to these and all other examples. Read each result, and stop on write
failure rather than claiming the decision was saved. Offer additional Story Specs (for example API
or migration details) when useful; the person decides whether to split them out.

Read [ADR format](references/adr-format.md) before offering or saving an ADR. Save only qualifying,
person-approved decisions as Story Specs, never repository ADR files. Existing ADRs are inputs.

## Finish

When every design-tree branch is resolved and the frontier is empty, ask the person to confirm shared
understanding in a final round. If they disagree, continue the interview. Save the final agreed Spec
and ADRs. If Comments is enabled and loaded, optionally add one final Comment summarizing the Spec
slugs, ADRs and any explicitly deferred open questions. Do not change the Stage or description.
End the UI with a short summary, then stop its server (also on cancellation or failure). Report the
Story Key, saved Spec slugs, decisions and any deferred questions or failed writes. Leave no server
running. Completion is a shared specification, not implementation authorization.
