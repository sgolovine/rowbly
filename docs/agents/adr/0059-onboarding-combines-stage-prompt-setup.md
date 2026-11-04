# ADR-0059: Onboarding combines Stage Prompt setup and keeps saved progress

**Status:** Accepted. Amends ADR-0057 §1–2, ADR-0041 §2 and ADR-0053 §2 items 3–4.

## 1. Context

The separate AI question, Factory setup and Stage Prompts steps repeat choices. A single Board
needs no selection. People need a choice between Rowbly's instructions and minimal placeholders,
without losing saved progress or the freely navigable onboarding from ADR-0057.

## 2. Decision

Data Root onboarding has these steps, in order (saved id, tab label): `mode` Usage, `board` Board,
`plugins` Plugins, `skills` Agent skills, `stage-prompts` Stage Prompts, `finish` Summary.

- Exactly one Board hides Board, puts that Board in context through `context.use`, and marks
  `board` done. Adding or removing Boards recomputes this. No Boards offers creation; several
  offers the existing selection. Plugins is shown in every mode. Stage Prompts is shown only
  with Software Factory on (Software Factory or Both).
- Agent skills opens skill installation directly, without an AI usage question. Installing a skill
  or continuing marks it done; continuing advances. Installed markers are retained.
- Stage Prompts offers explicit default population, minimal population, or inline editing with
  `esc` back to the choices. Population runs only when chosen, reports added/kept/skipped inline,
  and retains its result across Plugin reloads. Successful population or Next marks it done.
  Errors leave the choices available to retry. No skill selection option appears here.
- `software-factory.setup` accepts `prompts: 'default' | 'minimal'`, default `default`;
  the CLI exposes `--prompts default|minimal` and rejects other values with a usage error.
  Default instructions remain ADR-0053's defaults (In Progress and In Review on, TODO off).
  Minimal uses the existing `templateText` placeholders, with every new entry off. Both choices
  add the same missing factory Stages and preserve every existing Stage name/order, entry at
  either level and file, with ADR-0053 §2's atomic conflict and preservation rules unchanged.
- Summary lists this visit's usage (or Software Factory on/off on reopen), Board in context,
  Plugins on, installed skills with their folders, and Stage Prompts outcome (default, minimal,
  edited or not set up) when Software Factory is on. Unvisited steps read not changed in this
  visit. Finish calls the existing completion path.
- Saved `ai` counts as `skills` done; `factory-setup` counts as `stage-prompts` done. Saves keep
  those old ids and unknown ids. The first incomplete visible step opens on reopen. Completion
  remains separate from progress, with the same committed configuration and immediate writes.

Freely clickable tabs, Back/Next/Skip Buttons and their keys, ungated Next (finishing on the last
step), completion marks and inline results without Modals remain unchanged. Settings retains its
existing full-screen onboarding route. This decision supersedes the earlier separate AI step.

## 3. Rejected alternatives

- Forward-only tabs or saving choices at Finish would undo freely navigable, immediate setup.
- Treating retired ids as unknown would discard collaborators' completed progress.
- Turning minimal placeholders on would start agents before instructions are ready.
