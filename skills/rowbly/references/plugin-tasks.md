# Tasks Plugin

Every command below takes `--json --no-prompt`, and a delete also needs `--yes`.

A Task is a smaller item of work inside exactly one Story, with its own name, description and Stage. Its
Task Id is the Story Key, a dot and a number (`WEB-42.1`). The Plugin is off until
`rowbly plugins enable tasks`; if `tasks` is an unknown command, turn it on and tell the user, since
that changes shared configuration.

## Commands

```sh
rowbly tasks create WEB-42 --name "Build the form" --json --no-prompt    # → WEB-42.1, first Stage
rowbly tasks create WEB-42 --name "Write tests" --stage todo --description "Unit and e2e." --json --no-prompt
rowbly tasks list WEB-42 --json --no-prompt                              # creation order, each with its id
rowbly tasks show WEB-42.1 --json --no-prompt
rowbly tasks edit WEB-42.1 --name "Build the sign-in form" --json --no-prompt   # --name or description flags
rowbly tasks move WEB-42.1 done --json --no-prompt
rowbly tasks delete WEB-42.1 --yes --json --no-prompt
```

## Rules

- Tasks use the Board's Stages; `--stage` and `move` to any other Stage exit 2. Pick Stages by Stage
  Category, as for Stories.
- Tasks have no Assignees, Priority or Rank of their own; they are listed in creation order and share
  their Story's Assignees.
- Task Ids are case-insensitive (`web-42.1`) and need no `--board`.
- Task numbers are never reused: after deleting `WEB-42.3`, the next Task is `WEB-42.4`.
- Moving every Task to a done Stage does **not** move the Story. Move the Story yourself.
- Tasks have no Comments: comment on their Story.
- `tasks edit` needs `--name` or a description flag, or it exits 2. Every change also stamps the
  Story's `updatedAt`.
- `stages remove` refuses a Stage that Tasks still use (exit 4, `details.needsMoveTo`); `--move-to`
  moves the Tasks too.
- `stories show` has a Tasks row (`2/5 done`).

## Data

A Story's Tasks are `"plugins": { "tasks": { "nextNumber": 4, "tasks": [ … ] } }` in its `story.json`.
Each Task has `number`, `name`, `description`, `stage`, `createdAt` and `updatedAt`; `--json` adds `id`.
When doctor renumbers a Story after a merge, its Task Ids follow the new key.

## Doctor

- `TASKS_UNKNOWN_STAGE` (error): a Task in a Stage its Board does not have. Move it with
  `rowbly tasks move <TASK-ID> <stage>`.
- `TASKS_COUNTER_BEHIND` (warning): `nextNumber` is not above the highest Task number; `--fix` raises it.
- A change to the Tasks of a Story whose stored Tasks are invalid exits 6 and saves nothing;
  `tasks list` exits 6 for it. Repair the file by hand, using `rowbly doctor` to find it.
