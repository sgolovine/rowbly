# ADR-0053: Software Factory setup gives one Board the default Stages and Stage Prompts it lacks

**Status:** Accepted. Built. Amends ADR-0024 §3 and ADR-0041 §2. Amended by [ADR-0059](0059-onboarding-combines-stage-prompt-setup.md) for the combined onboarding flow and setup choices.

## 1. Context

Standing up a software factory meant writing every Stage Prompt from the template: Rowbly shipped
none, and onboarding said so on purpose (ADR-0041 §2). The prompts that run this repository's own
Board work, but they name its branch, server, models, Story Keys and commands, so they cannot be
copied as they are. People asked for two layouts: Backlog, TODO, In Progress, Done for a Board
without a factory, and Backlog, TODO, In Progress, In Review, Done for one with a factory. The
built-in Stage between Backlog and In Progress was named Todo (ADR-0024 §3).

Stages and Stage Prompts are configuration a person owns. A Board can inherit its Stages from the
global level, rename or reorder them, and have Stage Prompts at the global level or its own
(ADR-0005, ADR-0039). Default text must not replace any of it.

## 2. Decision

1. **Layouts.** The built-in Stages are `todo` (TODO) and `in-progress` (In Progress); this amends
   the name in ADR-0024 §3. A stored `stages` list is not rewritten: a Board that stored Todo keeps
   Todo. The factory Stages are `todo` (TODO), `in-progress` (In Progress) and `in-review`
   (In Review). Backlog and Done stay fixed and get no default Stage Prompt.
2. **Setup is explicit and per Board.** The Software Factory operation `setup`
   (`rowbly software-factory setup --board <id>`) changes one Board, in one Change Set, and turns no
   Plugin on.
   - A factory Stage is present when the Board's effective Stages have its key. Its name is kept;
     a name that differs only in case (Todo for TODO) is the same name, and any other name is
     reported as `custom`. Setup never renames, moves or removes a Stage.
   - A missing factory Stage is added to the Board's own list, copied from the inherited one when
     the Board has none, after `todo` and `in-progress` where they are. When nothing is missing, no
     list is written, so the Board keeps inheriting.
   - When another Stage already has a missing factory Stage's name, ignoring case, setup refuses
     (`CONFLICT`) and saves nothing: two Stages a person cannot tell apart, or a prompt for the wrong
     Stage, would follow.
   - A default Stage Prompt is written, as a Board entry and file, only for a factory Stage that has
     no entry at either level and no file at the default path. An existing entry, on or off, at the
     Board or the global level, is kept, so setup never shadows a global Stage Prompt; a file is
     never replaced. Running setup again changes nothing.
3. **Defaults.** In Progress (build with `rowbly-dev` to a draft PR) and In Review (independent
   review, merge, or return) are written on. TODO, an advisory readiness pass with the
   `rowbly-factory` skill's fingerprint helper, is written off: it needs Comments, Git, Node and that
   skill, and reports an incomplete review for any input the helper does not know. The texts name
   only published skills, `git` and `gh`, and defer branch, merge method and screenshots to the
   repository's agent instructions and `ROWBLY.md`. A Stage Prompt entry still defaults to off
   (ADR-0039 §2); setup sets each entry's value.
4. **Onboarding offers it.** The Software Factory and Both modes of Data Root onboarding offer
   "Add factory Stages and default Stage Prompts", which opens setup for the Board; this amends
   ADR-0041 §2. It runs only when chosen. Plain Kanban and `init` add no Stage Prompt.

## 3. Rejected alternatives

- **Writing the factory layout at the global level.** It would change every Board that inherits the
  global Stages, including those without a factory.
- **Renaming Stages to the default names.** A name is a person's choice; a key match is enough.
- **Writing a Board entry for every factory Stage.** A Board entry replaces the global one
  (ADR-0039 §2), so it would hide a global Stage Prompt the person wrote.
- **Turning the TODO default on.** Every pass on a Data Root with a Plugin the helper does not know
  would post an incomplete review Comment.
- **A `--factory` flag on `init`.** `init` turns no Plugin on (ADR-0010), and setup needs the Plugin.
- **Copying this repository's prompts.** They name its machines, models, branch and commands.
