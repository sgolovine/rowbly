# Story create updates

Settled in a grilling session on 2026-10-25. Plain feature work under ADR-0012; no new ADR.

## Goal

The New Story screen becomes tabbed like the Story view. Each enabled Plugin that supports create time adds a tab, so people can set its data while they create the Story: for example several Story Specs, Tasks, and blocks / blocked-by links. Agents can do the same with `rowbly stories create` flags.

## Decisions

### One operation (ADR-0012)
- Everything entered on the create tabs is Plugin input to the single `stories.create` operation (`plugins.<id>`). Each Plugin's create transform writes its bag, its files or other Stories' bags in the same Change Set, so there is one journaled commit.
- If any Plugin's input fails, nothing is saved. Never run `tasks.create`, `specs.create` or `story-linking.add` as follow-up operations.

### Scope
- **In scope:** Specs (Story Specs), Story Linking and Tasks.
- **Out of scope:**
  - Comments: a Comment at create time would only repeat the description.
  - Assignees and Epics: they already work at create time as form fields.
- **Only create changes.** Editing a Story stays the flat form, and Plugin data is still edited on the Story view tabs.

### TUI layout
- **Tabs:** `Details`, then the Plugin create tabs in Plugin registry order: Details · Tasks · Specs · Links (the same order as the Story view). Tab and ←/→ switch tabs, as on the Story view.
- **Details** holds today's core fields, the Custom Fields, and the `storyForm` fields of Plugins that have no create tab (Assignees, Epic).
- A Plugin's `storyForm` fields move to its tab when it has one. The Specs tab holds both the linked Board Specs (today's multiselect) and the new Story Spec drafts.
- **Saving:**
  - `ctrl+s` (or `ctrl+enter`) saves the Story and every tab's drafts from any tab.
  - `enter` after the last field still saves, on Details only.
- **Errors:** an invalid Plugin input (for example a duplicate Story Spec slug, or a link to a Story on another Board) keeps the form open. It selects that Plugin's tab, shows the error there and keeps all drafts. This extends today's `onPluginFields` mapping.
- **Leaving:** `esc` asks to discard when any field or draft has changed. It leaves without asking when nothing has changed.
- **A failing Plugin:** a create tab that fails to load or throws shows the failure in its tab (PluginSlot) and adds no input. The Story can still be saved.
- Follow the TUI design system (`rowbly-tui-design`). Creating a draft row uses `n` with a `new …` key hint (AGENTS.md).

### Plugin API: `tui.storyCreateTabs`
- This is a new contribution, separate from `storyTabs`, because draft editing and saved editing have different keys and saves. Shared row rendering can be a shared helper.
- **Shape:**
  - `{ label, component, input(draft) }`.
  - The component gets the draft value and `onChange` (the host holds the draft), plus `boardId`, `active`, `plugin` and `ui`. It never saves.
  - `input(draft)` returns the Plugin's `plugins.<id>` input for `stories.create`, or `undefined` for none.
- An untouched tab adds no input, as with `storyForm`.
- Document it in `docs/plugins/api.md`, with a compiled `// #region` fixture in `test/docs/fixtures/`.

### Per Plugin

**Tasks**
- Each draft Task holds Name, Stage and description, the same fields as the Tasks tab's new-Task form. The Stage defaults to the first effective Stage.
- The create transform writes the Tasks bag (`nextNumber`, with Tasks numbered 1, 2, … in draft order).
- CLI: `--task <name>`, repeatable. It sets the name only, with the first Stage, in flag order.

**Specs**
- Each Story Spec draft is a slug (default `spec`), a title and a markdown body. A Story can have several.
- The create transform writes `stories/<KEY>/plugins/specs/<slug>.md` in the same Change Set. A Story created in the operation can hold files right away (`docs/plugins/api.md`). Slugs must be unique.
- Board Spec links (`--spec <slug>`, the multiselect) work as they do today, but move to the Specs tab.
- CLI: `--story-spec <slug>=<file>`, repeatable.
  - The body comes from the file. `-` reads stdin and may be used at most once.
  - The title is the file's first `#` heading, or the slug if there is none.

**Story Linking**
- Drafts are blocks and blocked-by links to existing Stories on the same Board.
- A blocked-by link is stored on the blocker's bag, so the create transform changes that other Story with `changes.updateStory` in the same Change Set. This is allowed, as the `stories.remove` transform already does.
- CLI: `--blocks <key>` and `--blocked-by <key>`, both repeatable, with the same names as `story-linking add`. Same-Board and existence checks fail with `VALIDATION`, and nothing is saved.

## Docs and skills to update in the same change
- `docs/architecture/operations.md`: the Plugin input table for `stories.create` (Tasks, Specs Story Specs, Story Linking). Keep the table format, because `operationInventory.test.ts` parses it.
- `docs/plugins/api.md`: `storyCreateTabs`, with its fixture.
- `docs/plugins/built-in.md`: the Tasks, Specs and Story Linking sections.
- `docs/user-guide.md`: the tabbed New Story screen, `esc` discard, and the new flags.
- `skills/rowbly/references/` (stories and `plugin-*.md` pages), `skills/rowbly-reference.md`, and its copy in `skills/rowbly-dev/references/`.

## Tests (AGENTS.md / ADR-0027)
- By default, add no tests for the screens, flags or tabs.
- Required: one `test/plugins/` case for the pipeline rule. A `stories.create` whose Plugin input writes Story Spec files and another Story's link bag either saves everything in one commit or, when one Plugin's input is invalid, saves nothing.
- Verify the rest by hand with `pnpm dev`: the TUI create flow and `stories create --task … --story-spec … --blocked-by …`. Put screenshots in the PR with the `rowbly-screenshots` skill.

## Planned, not in this Story
- Comments at create time.
- Tabs on the Story edit form.
- A JSON `--input` file for `stories create`.