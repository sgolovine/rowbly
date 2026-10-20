# ADR-0025: A Story has any number of Story Specs, each named by a slug

**Status:** Accepted. Built. Amends ADR-0015.

ADR-0015 gave a Story at most one Story Spec, `stories/<KEY>/plugins/specs/spec.md`. Work on one Story is often described by several documents (requirements, a design, an API sketch), and a person kept them in one long file or as Board Specs that no other Story needs.

**§1 A Story Spec is named by a slug.** A Story Spec is `boards/<board>/stories/<KEY>/plugins/specs/<slug>.md`, as a Board Spec is `boards/<board>/plugins/specs/<slug>.md`; the slug is lower-kebab-case and unique within the Story. A Story can have any number of Story Specs. Its first `# ` heading is still its title.

**§2 `spec` is the Story Spec named by its Story alone.** `spec.md` is the Story Spec with the slug `spec`, so a Story Spec written before this decision is read as it is, with no migration. The CLI names a Story Spec with `--story <KEY>` and an optional slug (`rowbly specs show design --story WEB-1`); without a slug it means `spec`, so commands written for one Story Spec keep working. The `specs.create`, `specs.edit` and `specs.delete` operations take the slug with `story`, and a Spec result has a `slug` for both kinds.

**§3 The TUI lists Specs and opens one in the full-screen editor.** The Story's Specs tab lists its Story Specs, then the Board Specs it links to; the Board's Specs screen lists its Board Specs. Opening one shows it in the full-screen editor, which renders the markdown and switches to the raw text to edit it.

**§4 Compatibility.** A release before this decision reads only `spec.md` and ignores other Story Specs; it neither shows nor removes them. They are deleted with their Story, like every Plugin file (ADR-0013).

We rejected one Story Spec made of several files (a folder per Spec): it needs a new term for the parts, and moves `spec.md`. We rejected making the slug required with `--story`: it would break every command and agent workflow written for one Story Spec.
