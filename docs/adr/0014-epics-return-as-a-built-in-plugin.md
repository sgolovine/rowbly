# Epics return as a Built-in Plugin

ADR-0008 removed Epics from Rowbly. They come back as the Epics Built-in Plugin, with the same model as before: an Epic groups Stories from any Boards in the Data Root and is identified by a slug, a Story belongs to at most one Epic, an Epic has a name, a description and a closed flag, and Epic Progress is derived. Core still has no Epics: no Epic schema, no `epicId` on Stories, and no Epic code outside `src/plugins/epics/`.

Through the Plugin API, the Epics Plugin brings back what ADR-0008 removed: the `rowbly epics` commands, `--epic` and `--no-epic` on `stories list`, `create` and `edit`, the Epic screens, the Epic select in the Story form and its filter, and a doctor check for Stories that link to a missing Epic. Epics are stored in `.rowbly/plugins/epics/<epic>.json` (ADR-0013). A Story's Epic is Plugin Data on the Story (ADR-0011), so the link stays on the Story, as ADR-0004 decided. Deleting an Epic unlinks its Stories with a warning. Epic data from before ADR-0008 (`epics/*.json` and `epicId`) is not migrated.

Epics are one of the first Plugins because they were designed and tested once, and because they use most extension points: Plugin Data on Stories, Plugin files, commands, options on core commands, screens, form fields, filters and doctor checks.
