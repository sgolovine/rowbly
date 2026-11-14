# Factory activity

The factory activity tells the TUI which Stories have an active worker. The
`src/services/factory-activity/` service reads `.rowbly/state.json` and gives the activity of each
Story. It never stops the load of a Project, and it never writes the file.

Read this when you change the `▶` marker of a Story row or the status line below the Story list.
Also read it when you change how the board reads `state.json`.

## Source

The native factory writes `.rowbly/state.json` under the state lock. An old external supervisor can
also write it. The format is version 1 of the policy format (`src/services/factory-policy/policy-types.ts`).
The activity reader does not examine if a worker is alive. The native factory controls examine daemon ownership separately.

## Rules

The service uses only the attempts of a Story in its current Stage:

- No `preparing` or `running` attempt gives no activity.
- One active attempt that is also the last attempt gives the `model` of the attempt, or its `workerId`.
- Two active attempts, or an active attempt before a later attempt, give `conflict`.
- An attempt without `stage`, `workerId` or `status` gives `unknown`.

## File status

A problem with the file never stops the load of the Project. The service gives a status in place of
an error:

| Status        | Meaning                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| `ok`          | The file is valid.                                                                   |
| `missing`     | There is no file.                                                                    |
| `unavailable` | Rowbly cannot read or accept the file. It gives no activity.                         |
| `incomplete`  | The file is valid but some data is missing. It gives the activity that it can match. |

## In the TUI

- The TUI shows the activity as `▶` in the Story row.
- The TUI shows each file problem in one line below the Story list.
- A Project without `state.json` shows no status line.
- The activity service and the TUI never write `state.json` directly.

## Related

- [runtime-and-locks.md](runtime-and-locks.md): `state.json` and the state lock.
- [../domain-concepts.md](../domain-concepts.md#factory-activity): the definition.
