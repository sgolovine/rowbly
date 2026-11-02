# ADR-0044: Plugins give Story Context sections that a Plugin command can read

**Status:** Accepted

## 1. Context

An agent that works a Story needs all of it: the Story's fields, its Specs, Tasks, Comments, Epic,
links and Attachments. Each of those belongs to a Plugin. `storyRows` sums each one up in a line for
`stories show`, and only core reads rows. A Plugin command cannot read another Plugin's records:
`PluginServices` has no `plugins` service (ADR-0020 §1), and a Plugin reads only its own bags and
files. So the factory supervisor (the `rowbly-factory` skill) built each worker's brief from one
call per Plugin and a hand-filled template, and briefs drifted between workers. A Plugin must not
parse another Plugin's bag to fix this: each Plugin owns its data format (ADR-0021).

## 2. Decision

- A Plugin definition can declare `storyContext(story, plugin)`. It returns the Plugin's **Story
  Context** section for the Story, `{ title, text, data, unavailable? }`, or `null`: `text` is
  Markdown with the full content, `data` the same content as plain JSON in the shape of the Plugin's
  own `--json` output, and `unavailable` says why the section is partial (for example, invalid bags
  that may hide links). It runs in the `row` stage (ADR-0020 §1): it reads and cannot start an
  operation.
- `PluginContext.storyContext(key)` returns `{ story, plugins, sections, incomplete }`: the Story,
  the Plugins that are on in registry order, the section of each in that order, and every gap. It
  reads one committed state under the Data Root lock (ADR-0019 §1) and saves nothing. Each Plugin
  gets its own copy of the Story. It is not available while a section or a row is given, and hook
  contexts do not have it.
- A gap is never silent. `incomplete` lists each Plugin that is enabled but did not load, each whose
  `storyContext` throws or returns no valid section, and each that marks its section `unavailable`,
  with the reason. A Plugin that is off is not part of the Story's context and is not a gap; its
  data is kept as it is (ADR-0011). A Built-in Plugin's section throws on its own invalid data
  rather than showing it as empty.
- The Built-in Plugins with Story data give a section: Tasks, Specs (Story Specs and linked Board
  Specs in full), Comments, Epics, Story Linking, Attachments (names, not images) and Assignees.
- The Software Factory Plugin's `brief` command uses it to print the context part of a Worker's
  brief: the Story with every section, the Stage Prompt, the Board's Stages, the instructions and
  retry context it is given. It refuses with `CONFLICT` and `details.incomplete` when the context
  is incomplete, unless `--allow-incomplete`, which lists every gap at the top of the brief. It does
  not read `ROWBLY.md`, which Rowbly does not read (data model, ROWBLY.md); the brief leaves a
  placeholder for the supervisor to fill.

## 3. Rejected alternatives

- **Give Plugins the `plugins` service, or another Plugin's context.** A Plugin could run another
  Plugin's operations and read its private data, which ADR-0020 §1 rules out.
- **Read other Plugins' bags in the Software Factory Plugin.** It would copy their schemas and break
  when a Plugin changes its format (ADR-0021).
- **Extend `storyRows`.** Rows are one-line summaries for people; a context needs full text and JSON,
  and a failing row only warns, which would let an incomplete brief through.
- **A core `stories context` command.** Core still needs the same contribution, and the brief needs
  Stage Prompts and Stage Runs, which are the Software Factory Plugin's terms.
- **Warn and carry on when a section fails.** A worker would start from a partial Story without
  knowing it.
