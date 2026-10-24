# Comments Plugin

Every command below takes `--json --no-prompt`, and a delete also needs `--yes`.

A Comment is a note on a Story; a Story's Comments, oldest first, are its Thread. Use Comments to record
progress, blockers and decisions on the Story you are working on. The Plugin is off until
`rowbly plugins enable comments`; if `comments` is an unknown command, turn it on and tell the user,
since that changes shared configuration.

## Commands

```sh
rowbly comments add WEB-42 --body "Blocked on the API token endpoint." --json --no-prompt
printf '%s\n' "Decided:" "- keep sessions for 1 h" \
  | rowbly comments add WEB-42 --body-file - --json --no-prompt
rowbly comments list WEB-42 --json --no-prompt                           # oldest first
rowbly comments edit WEB-42 lcMT5Ekv --body "Unblocked." --json --no-prompt
rowbly comments delete WEB-42 lcMT5Ekv --yes --json --no-prompt
```

## Rules

- The target is a Story Key. Tasks have no Comments: comment on their Story.
- The author is Me when the Comment is added, or `null` when Me is not set. Comment ids are 8 random
  characters; get them from `list` or `add`.
- Comment ids must be unique within one Story; repeated ids make the stored Thread invalid.
- The body comes from exactly one of `--body`, `--body-file <path|->` or `--edit`; never use `--edit`.
  An empty or whitespace-only body exits 2. `--body` is kept exactly; `--body-file` drops trailing
  whitespace.
- `--json` prints Comment objects (`id`, `author`, `body`, `createdAt`, `updatedAt`): an array for
  `list`, one Comment for `add` and `edit`, `{ deleted }` for `delete`. `stories show` counts them.

## Data

A Story's Comments are `"plugins": { "comments": { "comments": [ … ] } }` in its `story.json`. A change
to a Thread that is stored invalid exits 6 and saves nothing; `comments list` exits 6 for it. Repair it
by hand, using `rowbly doctor` to find it.
Duplicate ids produce `PLUGIN_DATA_INVALID` (warning) while Comments is on. `doctor --fix` leaves
the Thread unchanged; preserve both records while resolving the duplicate identity by hand.
