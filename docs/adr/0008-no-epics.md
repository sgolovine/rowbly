# There are no Epics

Rowbly used to have Epics: named groupings of Stories that could span any Boards in the Data Root, stored as `.rowbly/epics/<epic-id>.json`, with the link held on the Story as `epicId` (ADR-0004) and a derived Epic Progress. We removed them. There is no `epics/` folder, no Epic schema, and Story files no longer have an `epicId` field.

The `rowbly epics` command, the `--epic` and `--no-epic` flags on `stories list`, `create` and `edit`, the Epics and Epic screens in the TUI, the Epic select in the Story form and filters, and the `MISSING_EPIC` doctor finding are gone. ADR-0004 is superseded.

To group Stories across Boards, give them a shared Label and filter with `rowbly stories list --all-boards --label <label>`.

Existing Data Roots keep working without a migration. Schemas drop unknown keys, so an old Story with `epicId` still reads, and the key is dropped the next time the Story is written. A leftover `epics/` folder is not part of the layout, so `rowbly doctor` reports its files as `UNKNOWN_FILE` and they can be deleted.
