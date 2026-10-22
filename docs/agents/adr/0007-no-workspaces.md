# ADR-0007: The Data Root is the only container; there are no Workspaces

**Status:** Accepted. The Epics mentioned below were later removed from core ([ADR-0008](0008-no-epics.md)) and returned as a Built-in Plugin ([ADR-0014](0014-epics-return-as-a-built-in-plugin.md)).

Rowbly used to have Workspaces: named collections of Boards, Epics and an Assignee roster, stored under `.rowbly/workspaces/<id>/`. We removed them. Boards live in `.rowbly/boards/<board-id>/` and Epics in `.rowbly/epics/<epic-id>.json`, directly in the Data Root. Board, Story and Epic files no longer have a `workspaceId` field, and there is no `workspace.config.json`.

The Assignee roster moved to `rowbly.config.json` as `assignees`, so a Data Root has one roster. The Configuration Cascade has two levels, global (`rowbly.config.json`) and Board (`board.config.json`), and then the built-in defaults. An Epic can group Stories from any Board in the Data Root. Local State holds only the current Board and Me. The `rowbly workspaces` command, the `--workspace` flag and `ROWBLY_WORKSPACE` are gone, and `rowbly use` takes a Board id.

We removed Workspaces because they added a level of folders, a cascade level, a flag on most commands and an extra step in context resolution, but they gave no use case that separate Data Roots do not already give. A team that wants separate rosters or separate configuration can use a different `.rowbly/` directory, for example one per repository, and `--data-root` selects it (`--root` or `ROWBLY_ROOT` when this was decided; ADR-0033). Key prefixes were already unique across the Data Root, so a Story Key still resolves to its Board without extra context.
