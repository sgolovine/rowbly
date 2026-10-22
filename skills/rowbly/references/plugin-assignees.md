# Assignees Plugin

Every command below takes `--json --no-prompt`.

An Assignee is a person in the Data Root's roster, identified by a handle (a lower-kebab-case slug). A
Story has zero or more Assignees; its Tasks share them. The Plugin is off until
`rowbly plugins enable assignees`. While it is off, `--assignee` is an unknown option (exit 2) and
`rowbly assignees` an unknown command. Do not turn it on to assign one Story: it changes the Data Root
for everyone, so ask the user first.

## Commands

```sh
rowbly assignees add sam --name "Sam Lee" --email sam@example.com --json --no-prompt
rowbly assignees list --json --no-prompt                                  # the roster, in the order added
rowbly assignees edit sam --email "" --json --no-prompt                   # --name and/or --email; "" removes the email
rowbly assignees remove sam --json --no-prompt                            # also from every Story, with a warning

rowbly stories create --board web --name "Login page" --assignee sam,me --json --no-prompt
rowbly stories edit WEB-42 --add-assignee me --json --no-prompt           # --assignee replaces, --remove-assignee drops
rowbly stories list --board web --assignee me --json --no-prompt          # Stories with any of these Assignees
```

## Rules

- An Assignee must be in the roster: otherwise exit 2 (`VALIDATION`) with `details.validHandles`. `me`
  means Me, and exits 2 when Me is not set. Duplicates are dropped.
- `--assignee` replaces the whole list and cannot be combined with `--add-assignee` or
  `--remove-assignee` (exit 2).
- `assignees edit` needs `--name` or `--email`, or it exits 2. An email is optional but must be valid.
- `assignees remove` takes the handle off every Story, stamps each Story's `updatedAt`, and warns with
  the count (`Assignee "sam" removed from 1 story`). It does not clear Me.
- Add Me's handle to the roster too, or doctor warns `ASSIGNEES_UNKNOWN_ME` for a local Me.

## Data

- The roster is `.rowbly/plugins/assignees/roster.json`: `version` and `assignees`, a list of
  `{ handle, name, email? }`. Without the file the roster is empty.
- A Story's Assignees are `"plugins": { "assignees": { "assignees": ["sam"] } }`; a Story without
  Assignees has no entry.

## Doctor

- `ASSIGNEES_UNKNOWN_ASSIGNEE` (warning): a Story Assignee that is not in the roster; `--fix` removes it.
  Or add the person with `rowbly assignees add`.
- `ASSIGNEES_UNKNOWN_ME` (warning): the local Me is not in the roster (global Me is not checked);
  `--fix` clears the local Me. Or add Me with `rowbly assignees add <handle>`.
- `ASSIGNEES_ROSTER_UNAVAILABLE` (error): the roster file has conflict markers, is not valid JSON or
  fails its schema. Every roster change exits 6 until it is fixed by hand.
- Changing the Assignees of a Story whose stored Assignees are invalid exits 6; `--assignee` replaces them.
