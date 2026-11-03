# ADR-0047: A Plugin command can read ROWBLY.md as inert text

**Status:** Accepted. Amends [ADR-0039](0039-software-factory-stage-prompts.md) §1 and the
[data model](../../architecture/data-model.md#rowblymd)'s rule that Rowbly does not read `ROWBLY.md`.
Approved by the user for ROW-53.

## 1. Context

`ROWBLY.md` holds how the people of a Data Root work with its Boards. ADR-0039 and the data model
said Rowbly does not read it: agents read it themselves. The factory supervisor (the `rowbly-factory`
skill) gives each worker a brief that must carry `ROWBLY.md`, and `software-factory brief`
(ADR-0044) assembles every other part of that brief. Leaving `ROWBLY.md` for the supervisor to paste
in keeps the drift between briefs that the command removes.

## 2. Decision

- `PluginContext.readRowblyMd()` returns the text of the resolved Data Root's own `ROWBLY.md`, as
  stored, or `null` when there is none. It reads that one fixed file and no other: it is not a
  general file read, and a Plugin still reads nothing else outside its scope.
- It follows the symbolic link policy of Plugin files (ADR-0019 §10): a `ROWBLY.md` that is a
  symbolic link, or anything but a regular file, throws `ValidationError`. It reads under the Data
  Root lock, like other reads, and saves nothing.
- The text is inert. Rowbly does not parse, run, validate or enforce it, and it is not
  configuration: no command, operation, hook or setting changes behaviour because of what it says.
  `rowbly init` still does not create it, and doctor still accepts it as part of the layout.
- `software-factory brief` embeds it, without trailing whitespace, under `## How people work with
  this Board`, or "None." when there is none. A `ROWBLY.md` that cannot be read is a gap in
  `details.incomplete`, like any other part of the brief (ADR-0044): the brief refuses, or with
  `--allow-incomplete` says the file is not included. It never fills the section in itself.

## 3. Rejected alternatives

- **Keep the placeholder for the supervisor to fill.** Every supervisor pastes the file by hand, and
  a brief can go out without it.
- **Let Plugins read any Data Root file.** A general read reaches records and other Plugins' files,
  which ADR-0013 and ADR-0020 keep private.
- **Parse `ROWBLY.md` into settings or rules.** It has no schema on purpose; people write it in
  their own words, for agents to follow.
