# Epics Plugin

Every command below takes `--json --no-prompt`.

An Epic groups Stories from any Boards in the Data Root, and is identified by a slug. A Story belongs to
at most one Epic. The Plugin is off until `rowbly plugins enable epics`.

## Commands

```sh
rowbly epics create auth --name "Authentication" --description "Sign-in and sessions" --json --no-prompt
rowbly stories create --board web --name "Login page" --epic auth --json --no-prompt
rowbly stories edit API-3 --epic auth --json --no-prompt        # or --no-epic to unlink
rowbly stories list --board web --epic auth --json --no-prompt  # or --no-epic
rowbly epics show auth --json --no-prompt                       # its Stories by Board, and Epic Progress
rowbly epics list --json --no-prompt                            # open Epics; --closed or --all
rowbly epics edit auth --name "Auth" --json --no-prompt         # --name or a description flag
rowbly epics close auth --json --no-prompt                      # reopen with: epics reopen auth
rowbly epics delete auth --json --no-prompt                     # unlinks its Stories, with a warning
```

## Rules

- Epic Progress is the share of the Epic's Stories in the `done` Stage Category. It is calculated each
  time and never stored. To finish an Epic, move its Stories to `done`, then `epics close` it.
- `epics edit <id>` needs `--name` or a description flag, or it exits 2. Descriptions take
  `--description`, `--description-file <path|->`; never `--edit`.
- `stories list --epic <id>` takes an Epic id (a slug); anything else exits 2. `stories show` has an
  Epic row.

## Data

- An Epic is `.rowbly/plugins/epics/<id>.json`: `version`, `id`, `name`, `description`, `closed`,
  `createdAt`, `updatedAt`.
- A Story's link is `"plugins": { "epics": { "epic": "auth" } }`.

## Doctor

- `EPICS_MISSING_EPIC` (warning): a Story links to an Epic file that does not exist; `--fix` unlinks it.
- `EPICS_CONFLICT_MARKERS`, `EPICS_INVALID_JSON`, `EPICS_UNSUPPORTED_VERSION`, `EPICS_SCHEMA_INVALID`,
  `EPICS_ID_MISMATCH`, `EPICS_UNREADABLE` (errors): an Epic file that cannot be used. Never fixed
  automatically; correct the file by hand (compare it with git). Reading it exits 6 with `details.path`.
