# Rowbly reference for agents

This reference tells an agent how to use the `rowbly` CLI. It is not a skill. To use it in a skill,
do these steps:

1. Copy this file into the `references/` folder of the skill.
2. Add this instruction to the `SKILL.md` file of the skill:

   > Read `references/rowbly-reference.md` before you run a `rowbly` command.

Rowbly tracks the work of a software factory. It keeps the data in Markdown and JSON files in a
`.rowbly/` folder. Each `rowbly <command>` runs one time and stops.

## 1. Rules for each command

- Add `--json` to each command. Then read the result from stdout.
- Do not run `rowbly` with no arguments. This starts the TUI, and the TUI waits for a person.
- Do not assume the keys of the Stages, the custom fields or the tags. Read them from the config (section 3).
- Change data only with commands. A command examines the data before it writes the data.
- Run only one command that writes at a time for each Project. Rowbly does not lock its files. In a
  test, six parallel `story create` commands all reported success, but only four Stories were written.
- Get approval from the user before you run `story delete`, `stage delete`, `spec delete`,
  `custom-field remove` or `tag remove`. These commands do not ask for confirmation.
- Do not run a failed command again with the same input. Read the error and change the input.

## 2. Concepts

| Concept      | Description                                                                         |
| ------------ | ----------------------------------------------------------------------------------- |
| Project      | The top-level record. It holds the custom field definitions, the tags and the Stages. |
| Story        | One item of work. It has a title, a description, custom field values, tags and one Stage. |
| Stage        | A step of the workflow. Each Stage can have a prompt.                               |
| Stage prompt | Instructions that tell agents what to do with a Story in that Stage.                |
| User prompts | The Project prompt, the Supervisor prompt and the Worker prompt in `.rowbly/prompts/`. |
| Custom field | A field that you define one time. It applies to all Stories of the Project.         |
| Tag          | A value and a label that you define one time. A Story can have zero or more tags.   |
| Spec         | A Markdown document that describes work. It links to one or more Stories.           |

Each new Project has two Stages, `BACKLOG` and `DONE`. Specs are off in each new Project.

## 3. Find the Project and read its config

Rowbly uses the nearest `.rowbly/` at or above the current directory. Use `-C <dir>` to start from
a different directory. If the Project is in Git, each Git worktree has its own copy of `.rowbly/`.
Use `-C <dir>` to select the Project that all agents share.

The CLI has no command that lists the Stages or the custom fields. Read
`.rowbly/rowbly.config.json` to find them. The file is safe to read. `rowbly tag list` lists the tags.

```json
{
  "projectName": "My App",
  "projectKey": "APP",
  "customFields": [{ "key": "priority", "label": "Priority", "type": "select", "options": ["P1", "P2"] }],
  "tags": [{ "value": "frontend", "label": "Front end" }],
  "stages": [
    { "key": "BACKLOG", "label": "Backlog", "enabled": true },
    { "key": "DONE", "label": "Done", "enabled": true }
  ],
  "features": { "specs": true }
}
```

The order of `stages` is the order of the workflow. If `features.specs` is not `true`, Specs are off.

## 4. Output and errors

A command that succeeds exits with 0 and writes its result to stdout. Each failure exits with 1 and
writes nothing to stdout. Do not use the exit code to find the type of failure. Use `error.code`.

With `--json`, an expected failure writes this object to stderr:

```json
{
  "error": {
    "code": "VALIDATION",
    "message": "The story is invalid",
    "hint": "Optional text that tells you what to do.",
    "details": {
      "issues": [{ "path": ["stage"], "message": "Unknown stage \"nope\". Stages: BACKLOG, DONE" }]
    }
  }
}
```

| `error.code` | Meaning                                                                  | Action                               |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------ |
| `VALIDATION` | The input or a file breaks a rule.                                       | Read `details.issues` and `hint`.    |
| `NOT_FOUND`  | The Project, Story, Stage, custom field, tag or Spec does not exist.     | Examine the ID or key.               |
| `CONFLICT`   | The record exists, other records depend on it, or Specs are off.         | Read `message`, `hint` and `details`. |

Some failures do not write JSON, also with `--json`. They write plain text to stderr and exit with
1. Examples are an unknown command, an unknown flag, a mandatory flag that you did not give and a
`--body-file` that Rowbly cannot read. If stderr is not JSON, read it as text.

## 5. Commands

Each command has `--help`. These options apply to all commands:

| Option            | Effect                                                 |
| ----------------- | ------------------------------------------------------ |
| `--json`          | Writes results and expected errors as JSON.            |
| `-C, --cwd <dir>` | Runs the command as if Rowbly started in `<dir>`.      |
| `-h, --help`      | Shows the usage text.                                  |
| `-v, --version`   | Shows the version.                                     |

Resource commands use `<resource> <action>`.
The resources are `project`, `prompt`, `story`, `stage`, `custom-field`, `tag`, `spec`, `skill` and `host`.
Run `rowbly <resource>` or `rowbly <resource> --help` to see its actions.
Run `rowbly <resource> <action> --help` to see its arguments and options.
The old flat resource commands do not work.
The commands `init`, `doctor`, `status` and the attachment commands stay at the root.

A flag with `(repeat)` can occur more than one time.

### Project

| Command                                               | JSON result | Notes                                                       |
| ----------------------------------------------------- | ----------- | ----------------------------------------------------------- |
| `rowbly init [--defaults] [--name <name>] [--key <key>] [--stage <stage>] [--skill <name>] [--no-skills] [--harness <id>] [--input <json\|file\|->]` | Project, `installed`, `edits` | Creates `.rowbly/`, the Stages and the skills. Always adds Backlog and Done. Gives `CONFLICT` if `.rowbly/` exists. |
| `rowbly project update [--name <name>] [--key <key>]` | Project     | `--key` renames all Story files and changes all Spec links. |
| `rowbly project update --specs <on\|off>`             | Project     | Turns Specs on or off.                                      |
| `rowbly project update --compact-threads <on\|off>`   | Project     | Shows each Thread on one line in the TUI. The default is on. |
| `rowbly project update --time-zone <zone>`            | Project     | Sets the time zone of the Story times in the TUI. `""` uses the system time zone. |
| `rowbly status`                                       | Status      | Shows the factory phase, the Thread counts and the Story count of each Stage. |
| `rowbly thread steer <id> --message <text>`           | Receipt     | Sends a message of 1 to 4000 characters to a running worker through the running factory. Gives `VALIDATION` for an empty or long message, and `CONFLICT` when the factory or the worker does not run. |

`rowbly status --json` gives this object. `stages` is in config order and includes the disabled Stages.
A Story with a Stage that is not in the config is in `stories` only.

```json
{
  "factory": { "phase": "stopped" },
  "threads": { "running": 0, "pending": 0 },
  "stages": [{ "key": "BACKLOG", "label": "Backlog", "enabled": true, "stories": 3 }],
  "stories": 3
}
```

### Prompt

| Command                                                         | JSON result     | Notes                                                    |
| --------------------------------------------------------------- | --------------- | -------------------------------------------------------- |
| `rowbly prompt list`                                            | Array of Prompt | Shows the three user prompts.                            |
| `rowbly prompt get <system\|supervisor\|worker>`                | Prompt          | Works if the file does not exist.                        |
| `rowbly prompt set <name> --text <md>`                          | Prompt          | Replaces the full prompt. An empty value clears it.      |
| `rowbly prompt set <name> --file <path\|->`                     | Prompt          | Reads the text from a file. `-` reads stdin.             |

A Prompt record has this shape. `exists` is `false` and `text` is empty if the file does not exist:

```json
{ "name": "worker", "label": "Worker", "path": "/abs/path/.rowbly/prompts/WORKER.md", "exists": true, "text": "Markdown text" }
```

### Story

| Command                                                                                             | JSON result     |
| --------------------------------------------------------------------------------------------------- | --------------- |
| `rowbly story create --title <title> [--stage <key>] [--description <md>] [--field <k=v>] (repeat) [--depends-on <ids>] (repeat) [--tag <value>] (repeat)` | Story |
| `rowbly story get <id>`                                                                             | Story, with `blocks` and `waitingFor` |
| `rowbly story search [query] [--stage <key>] [--field <k=v>] (repeat) [--tag <value>] (repeat) [--blocked \| --ready]` | Array of Story |
| `rowbly story update <id> [--title <t>] [--stage <key>] [--description <md>] [--field <k=v>] (repeat) [--depends-on <ids> \| --add-dependency <id> --remove-dependency <id>] (repeat) [--tag <value> \| --add-tag <value> --remove-tag <value>] (repeat)` | Story |
| `rowbly story delete <id>`                                                                          | `{ "id": … }`   |

A Story record has this shape:

```json
{
  "id": "APP-01",
  "number": 1,
  "uid": "0b7c6f3e-2d4a-4f1e-9c8b-5a6d7e8f9a0b",
  "title": "Login page",
  "stage": "BACKLOG",
  "position": 1,
  "dependsOn": ["APP-02"],
  "tags": ["frontend"],
  "createdAt": "2025-01-02T03:04:05.678Z",
  "updatedAt": "2025-01-03T10:00:00.000Z",
  "description": "Markdown text",
  "fields": { "priority": "P1", "story_points": null },
  "path": "/abs/path/.rowbly/stories/BACKLOG/APP-01.md"
}
```

- **IDs.** `APP-01`, `app-1` and `1` all select the same Story. The prefix must be the key of the Project.
- **uid.** `uid` is the permanent identity of the Story, a UUID. Rowbly writes it when it creates the Story.
  It does not change when the number of the Story changes. You cannot set or change it. An older Story can
  have no `uid`. Then `story get` does not give the key, and `doctor --fix` adds a `uid`.
- **New Stories.** A new Story goes first in its Stage. Without `--stage`, it goes in the first enabled Stage.
- **Moves.** A Story that changes Stage goes first in the new Stage.
- **Positions.** The Stories of a Stage are in the order of `updatedAt`, the most recent first. `position` is the
  1-based place in this order. A change of a Story puts it first. You cannot set the place of a Story.
- **Descriptions.** `--description` replaces the full description. An empty value clears it.
- **Fields.** `--field` changes only the fields that you name.
- **Search.** With no filters, `story search` shows all Stories. A Story must agree with all filters.
- **Search text.** Each word of `query` must occur in the ID, title, description or a field value. Case has no effect.
- **Search order.** The results are in the order of the Stages, then in the order of `updatedAt`, the most recent first.
- **Dependencies.** `dependsOn` has the IDs of the upstream Stories. A Story is complete only in the last Stage.
  A Story is blocked when one or more upstream Stories are not complete. Otherwise it is ready.
- **Set dependencies.** `--depends-on` takes a comma-separated list, and you can repeat it. On update, the
  list replaces the old list. `--depends-on ""` removes all dependencies.
- **Change one dependency.** `--add-dependency` and `--remove-dependency` change one ID. You can repeat them.
  You cannot use them together with `--depends-on`.
- **Bad dependencies.** An unknown ID, a self reference or a cycle gives `VALIDATION`. `details.unknown`,
  `details.self` or `details.cycle` has the IDs. Nothing is saved.
- **Tags.** `tags` has the values of the tags of the Story. `--tag` sets the list. On update, it replaces the
  list, and `--tag ""` removes all tags. `--add-tag` and `--remove-tag` change one value. You cannot use them
  together with `--tag`. A value that is not a tag of the Project gives `VALIDATION`.
- **Search by tag.** `story search --tag` finds the Stories that have the tag. With more than one `--tag`, a
  Story must have all of the tags.
- **Times.** `createdAt` and `updatedAt` are ISO 8601 UTC strings. Each change of a Story sets `updatedAt`.
  An older Story can have `null`.
- **Dependency state.** `story get` adds `blocks` (the downstream Stories) and `waitingFor` (the upstream
  Stories that are not complete). `story search --blocked` or `--ready` filters by this state.

Do not keep a Story ID after you delete the Story. Each new Story gets the highest number plus one,
so Rowbly can give the deleted ID to a new Story.

### Stage

| Command                                                                                      | JSON result                     |
| -------------------------------------------------------------------------------------------- | ------------------------------- |
| `rowbly stage create --label <label> [--key <key>] [--prompt <md>] [--position <n>] [--disable]` | Stage                       |
| `rowbly stage get <key>`                                                                     | Stage                           |
| `rowbly stage update <key> [--rename <key>] [--label <l>] [--prompt <md>] [--position <n>] [--enable] [--disable]` | Stage     |
| `rowbly stage delete <key> [--move-to <key>]`                                                | `{ "key": …, "movedStories": n }` |

A Stage record has this shape:

```json
{ "key": "IN_PROGRESS", "label": "In Progress", "enabled": true, "prompt": "Markdown text", "position": 2 }
```

- **Keys.** Stage keys are in UPPER_SNAKE_CASE. Commands accept them in lower case.
- **Positions.** A Stage `--position` outside the range of the Stages gives `VALIDATION`.
- **Renames.** `--rename` changes the Stage file and all Stories in the Stage.
- **Deletes.** A Stage with Stories gives `CONFLICT` without `--move-to`. `details.stories` lists the Stories.
- **Last Stage.** A Project must have at least one Stage. The last Stage cannot be deleted.
- **Disabled Stages.** `story create` does not use a disabled Stage as its default. `--stage` can select
  a disabled Stage, and `doctor` then shows a warning.

### Custom field

| Command                                                                                   | JSON result  |
| ----------------------------------------------------------------------------------------- | ------------ |
| `rowbly custom-field add --label <label> --type <type> [--key <key>] [--option <v>] (repeat)` | Custom field |
| `rowbly custom-field update <key> [--rename <key>] [--label <l>] [--type <type>] [--option <v>] (repeat)` | Custom field |
| `rowbly custom-field remove <key>`                                                        | Custom field |

Field keys are case sensitive and in snake_case. The keys `title`, `stage`, `position`, `id`,
`description`, `tags` and `uid` are reserved.

| Type      | Value for `--field <key>=<value>`                       |
| --------- | ------------------------------------------------------- |
| `string`  | Any text                                                |
| `number`  | A number                                                |
| `boolean` | `true`, `yes`, `y`, `1`, `false`, `no`, `n` or `0`      |
| `url`     | A full URL                                              |
| `date`    | `YYYY-MM-DD`                                            |
| `select`  | One of the options of the field                         |

- **Clear a value.** `--field <key>=` clears the value in `story create` and `story update`.
- **Find empty values.** `--field <key>=` in `story search` finds the Stories with no value.
- **Select options.** A `select` field must have at least one `--option`. In an update, `--option`
  replaces all options.
- **Type changes.** `--type` converts the values in all Stories. If one value cannot change, the
  command gives `VALIDATION` and writes nothing.

### Tag

| Command                                                  | JSON result  |
| -------------------------------------------------------- | ------------ |
| `rowbly tag list`                                        | Array of Tag |
| `rowbly tag add --label <label> --value <value>`         | Tag          |
| `rowbly tag update <value> --label <label>`              | Tag          |
| `rowbly tag remove <value>`                              | Tag          |

A Tag record has this shape:

```json
{ "value": "frontend", "label": "Front end" }
```

- **Values.** A value has only lower-case letters, digits, `_` and `-`. It starts with a letter or a digit.
  A value that exists gives `CONFLICT`.
- **No value change.** The value of a tag cannot change. `tag update` changes only the label.
- **Removal.** `tag remove` removes the tag from the config and from each Story that has it.

### Host

A worker host is a remote machine that runs factory workers only. The hosts belong to the user, not to
a Project. Rowbly keeps them in the `hosts` key of `~/.rowblyrc.json`. Only `host use` and `host unuse`
need a Project.

| Command                                                 | JSON result              |
| ------------------------------------------------------- | ------------------------ |
| `rowbly host list`                                      | Array of Host            |
| `rowbly host update <id> [--max-workers <n>] [--enable \| --disable]` | Host        |
| `rowbly host add <id> --ssh <target> --max-workers <n>` | Host, `install`, `check` |
| `rowbly host check <id>`                                | `{ host, ready, items }` |
| `rowbly host login <id>`                                | None; terminal only      |
| `rowbly host remove <id> [--purge]`                     | Host, `purge`            |
| `rowbly host use <id> [--path <dir>]`                   | Clone record             |
| `rowbly host unuse <id>`                                | Clone record             |

A Host record has this shape:

```json
{ "id": "mini", "ssh": "user@mini.lan", "maxWorkers": 2, "enabled": true }
```

- **Ids.** An id is dash-case, for example `mac-mini`. The id `local` is reserved for the main machine.
  An id that exists gives `CONFLICT`. An unknown id gives `NOT_FOUND`.
- **SSH target.** The target must not be empty. It must not start with `-`, and it must not have
  whitespace or control characters. A bad target gives `VALIDATION`.
- **Worker limit.** `--max-workers` is a whole number of 1 or more. A bad value gives `VALIDATION`.
- **Install.** `host add` needs SSH access with a key. It checks Node 22.19.0 or later on the host, and
  installs the exact Rowbly build in `~/.local/share/rowbly/versions/<build-id>/` on the host. `node`
  and `npm` must be on the `PATH` of a non-interactive SSH session. A missing Node gives
  `HOST_NODE_MISSING`. An old Node gives `HOST_NODE_TOO_OLD`. A failed install gives
  `HOST_INSTALL_FAILED`. Then the host is not recorded. The `install` object has `state`, `buildId`,
  `localVersion`, `remoteVersion`, `remoteExecutable`, `installed`, `nodeVersion` and `stderr`.
- **Check.** `host check` shows if the host is ready. Each item is `{ id, label, state, detail, action? }`.
  `state` is `ok`, `warning`, `fail` or `skipped`. A `fail` item has an action for the user on the host.
  `ready` is `true` only when no item is `fail`. The exit code is 0 also when items fail. The items are
  `ssh`, `linux`, `flock`, `git`, `node`, `rowbly`, `pi-login`, `models`, `clone`, `git-push`, `gh`,
  `git-identity` and `local-ahead`. `host add` runs the check after the install and gives it in `check`.
  The check does not install, log in or clone.
- **Login.** `host login` runs `ssh -t <target> <remote rowbly> auth login`. It must run in a terminal.
  With `--json`, or without a terminal, it gives `VALIDATION`.
- **Update.** `host update` changes the worker limit, or turns the host on or off for all Projects. A
  command without a change, or with `--enable` and `--disable` together, gives `VALIDATION`.
- **Last check.** `host check` and `host add` write `lastCheck: { at, ready, failed }` to the host entry
  of `~/.rowblyrc.json`. `failed` has the ids of the `fail` items. `host list` does not show it.
- **Removal.** `host remove` gives `CONFLICT` while a known Project has a `pending` or `running` Thread
  on the host. `--purge` does no work at this time.
- **Use.** `host use` turns the host on for the current Project. Without `--path`, it clones the local
  `origin` URL into `~/.local/share/rowbly/projects/<project-id>/repo` on the host, or uses the clone of
  the same repository that is there. With `--path <dir>`, it uses an existing clone. The clone must be a
  Git work tree of the same repository, without changes. The JSON result is
  `{ host, root, path, managed, url, cloned }`. A clone without Git access on the host gives
  `HOST_GIT_ACCESS`. Another failure of the clone gives `HOST_CLONE_FAILED`. A Project without `origin`
  gives `VALIDATION`. A Project that the host uses gives `CONFLICT`.
- **Unuse.** `host unuse` removes only the record of the current Project. The clone stays on the host. It
  gives `CONFLICT` while a `pending` or `running` Thread of the Project is on the host.
- **Bad file.** If `~/.rowblyrc.json` is not valid, each command gives `VALIDATION` and does not change the file.
- **Placement.** `rowbly factory configure --placement <policy>` sets how the factory selects the machine of a
  new worker. The policies are `prefer-local` (the default), `most-free` and `prefer-remote`.
- **Remote worker.** A worker on a worker host writes to a copy of the Project. Its command prefix has
  `-C <copy>`. Story field changes, Stage moves and attachments go through the outbox. The main machine
  applies them to the board later. A new Story, Stage or Spec, and each config change, give `CONFLICT`
  with the text `A remote worker cannot …`. Do not try the write again. Record the problem in the result.

### Spec

Turn Specs on before you use these commands. If Specs are off, each command gives `CONFLICT`.

| Command                                                                                     | JSON result     |
| ------------------------------------------------------------------------------------------- | --------------- |
| `rowbly spec create --title <t> --story <id> (repeat) [--slug <s>] [--body <md>] [--body-file <path>]` | Spec |
| `rowbly spec get <slug>`                                                                    | Spec            |
| `rowbly spec list [--story <id>]`                                                          | Array of Spec   |
| `rowbly spec update <slug> [--title <t>] [--story <id>] (repeat) [--body <md>] [--body-file <path>]` | Spec   |
| `rowbly spec link <slug> <story>`                                                           | Spec            |
| `rowbly spec unlink <slug> <story>`                                                         | Spec            |
| `rowbly spec delete <slug>`                                                                 | `{ "slug": … }` |

A Spec record has this shape:

```json
{
  "slug": "login-page",
  "title": "Login Page",
  "stories": ["APP-01"],
  "body": "Markdown text",
  "path": "/abs/path/.rowbly/specs/login-page.md"
}
```

- **Body.** `--body-file -` reads the body from stdin. Do not use `--body` and `--body-file` together.
- **Slugs.** The default slug comes from the title. If the slug exists, Rowbly adds a number, for
  example `login-page-2`.
- **Links.** `spec update --story` replaces all links. Use `spec link` to add one link.
- **Last link.** `spec unlink` cannot remove the last link. Link a different Story or delete the Spec.
- **Deleted Stories.** `story delete` removes the Story from each Spec. A Spec with no Stories stays.
  It is an orphan, and its `stories` list is empty.

### Attachment

The attachment commands stay at the root.

| Command                                  | JSON result                   |
| ---------------------------------------- | ----------------------------- |
| `rowbly list-attachments <story>`        | Array of Attachment           |
| `rowbly get-attachment <story> <id>`     | Attachment with `path`        |

`get-attachment` gives the record and the absolute `path` of the attachment file. Read the file at
`path` with your read tool. Without `--json`, the command prints only the path.

- **Errors.** An unknown Story or id, or a missing file, gives `NOT_FOUND`. A bad id gives `VALIDATION`.
- **Remote worker.** On a worker host, a file that is not in the copy comes from the main machine.
  This can take up to 30 seconds. If the host is offline, or the main machine cannot send the file,
  the command gives `CONFLICT`. The message gives the reason. Do not try again in a loop. Record the
  problem and continue.

### Skill

The Rowbly package contains skills for coding agents. These commands copy a bundled skill into the Project and record
it in `rowbly.config.json`.

| Command                                                  | JSON result    |
| -------------------------------------------------------- | -------------- |
| `rowbly skill install <name> --harness <id> (repeat)`    | Skill result   |
| `rowbly skill list`                                     | Array of Skill |
| `rowbly skill remove <name> [--harness <id>] (repeat)`   | Skill result   |

| Harness ID       | Project skills folder |
| ---------------- | --------------------- |
| `claude-code`    | `.claude/skills`      |
| `codex`          | `.agents/skills`      |
| `gemini-cli`     | `.gemini/skills`      |
| `github-copilot` | `.github/skills`      |
| `cursor`         | `.cursor/skills`      |

A Skill record has this shape. `installed` is `false` if the copy for that harness is not there:

```json
{ "name": "review", "harnesses": [{ "harness": "codex", "path": "/abs/path/.agents/skills/review", "installed": true }] }
```

A Skill result has this shape. It has `status` in place of `installed`:

```json
{ "name": "review", "harnesses": [{ "harness": "codex", "path": "/abs/path/.agents/skills/review", "status": "installed" }] }
```

- **Names.** Only a bundled skill can install. Any other name gives `NOT_FOUND`, and `hint` lists the bundled skills.
- **Conflicts.** If a target has content that is not an installed copy of the skill, the command gives `CONFLICT` and writes nothing. For example, a folder that the config does not track, or a tracked folder with no `SKILL.md`.
- **Repairs.** If nothing is at the path of a tracked skill, `skill install` copies the skill again and gives the status `installed`.
- **Install status.** The value is `installed`, `shared` or `already-installed`. A `shared` harness uses the same folder as a tracked harness.
- **Remove status.** The value is `removed`, `missing` or `shared`. Rowbly keeps a `shared` folder because a tracked harness still uses it.
- **Removes.** With no `--harness`, `skill remove` removes the skill from all of its harnesses.
- **Shared read locations.** Harnesses can read the same folders. A skill can stay visible after you remove it for one harness.

Get approval from the user before you run `skill remove`. The command deletes the folder and all local
changes in it, and does not ask for confirmation.

### Long text

Only Specs and user prompts have a file flag. `--description` and `--prompt` take the text as an
argument. To send the contents of a file, use command substitution:

```sh
rowbly story update APP-01 --description "$(cat notes.md)" --json
```

## 6. Work on a Story

1. Read the Project prompt and the Worker prompt (section 7):

   ```sh
   rowbly prompt get system --json
   rowbly prompt get worker --json
   ```

2. Find the Stories of a Stage. The most recently updated Story is first:

   ```sh
   rowbly story search --stage IN_PROGRESS --json
   ```

3. Read the Story:

   ```sh
   rowbly story get APP-01 --json
   ```

4. Read the prompt of the Stage of the Story. Do the instructions in `prompt`:

   ```sh
   rowbly stage get IN_PROGRESS --json
   ```

5. If Specs are on, read the Specs of the Story:

   ```sh
   rowbly spec list --story APP-01 --json
   ```

6. Do the work.
7. Move the Story to the Stage that the prompt or the user names:

   ```sh
   rowbly story update APP-01 --stage DONE --json
   ```

Read the prompt each time that you start work on a Story. Users can change prompts at any time, and
a Stage can tell you to do no work.

Rowbly does not move Stories and does not start agents. A Story stays in its Stage until a command
or a person moves it.

## 7. Prompts

A Project has three user prompts in `.rowbly/prompts/`. They operate as a `CLAUDE.md` or `AGENTS.md`
file does. Rowbly does not parse or enforce their text.

| File            | Prompt            | Who gets it                    | Command                   |
| --------------- | ----------------- | ------------------------------ | ------------------------- |
| `SYSTEM.md`     | Project prompt    | The supervisor and all workers | `rowbly prompt get system` |
| `SUPERVISOR.md` | Supervisor prompt | The supervisor only            | `rowbly prompt get supervisor` |
| `WORKER.md`     | Worker prompt     | All workers, in all Stages     | `rowbly prompt get worker` |

The Stage prompt in `.rowbly/stages/<KEY>.md` goes only to the workers of that Stage. Rowbly also has
system prompts in its package. A user cannot change them.

- **Read.** Read the Project prompt and the Worker prompt before you do work or change data in a Project.
- **Native factory.** The first message of a native factory worker already has the prompts. Do not read them again.
- **Missing prompts.** A prompt file can be missing. A missing prompt has no text. Continue without it.
- **Order.** Obey the user first. Then obey the Rowbly system prompts, the Stage prompt, the Worker prompt and the Project prompt, in this order.
- **Skills.** The user prompts have priority over the steps of a skill.
- **Limits.** A user prompt does not remove the rules in section 1.
- **Changes.** Change a prompt only if the user tells you to do it.

Older versions of Rowbly kept the instructions in `.rowbly/ROWBLY.md`. Rowbly does not read this file now.

## 8. Files

Read these files if a command does not give the data. Users can edit these files by hand.

```
.rowbly/
  rowbly.config.json   # Project name and key, custom fields, tags, Stages, features, installed skills, factory settings
  prompts/SYSTEM.md    # the Project prompt, for the supervisor and all workers
  prompts/SUPERVISOR.md # the Supervisor prompt, for the supervisor only
  prompts/WORKER.md    # the Worker prompt, for all workers
  stories/BACKLOG/APP-01.md # stories/<Stage key>/<ID>.md; frontmatter: title, stage, uid, dependsOn, tags, createdAt, updatedAt, one key for each custom field
  stages/BACKLOG.md    # the full file is the Stage prompt
  specs/login-page.md  # frontmatter: title, stories; the body is the Spec
```

```markdown
---
title: Login page
stage: BACKLOG
uid: 0b7c6f3e-2d4a-4f1e-9c8b-5a6d7e8f9a0b
createdAt: 2025-01-02T03:04:05.678Z
updatedAt: 2025-01-03T10:00:00.000Z
priority: null
---

The Markdown description of the Story.
```

The `skills` list of `rowbly.config.json` holds each installed skill and its harnesses. The copies
are outside `.rowbly/`, in the project skills folder of each harness (section 5, "Skill").

In Story files, `null` means that the field has no value. A Story with no valid `updatedAt` comes
after the Stories that have one. Older Story files can have a `position` key. It has no effect.

Each Story file is in the folder of its Stage. The `stage` key of the frontmatter is the authority.
A Rowbly write that changes the Stage moves the file. Do not move a Story file by hand: change its
Stage with `story update --stage`. Older Projects can have Story files directly in `stories/`. Rowbly
reads them, and `rowbly doctor --fix` moves them to the folder of their Stage.

## 9. Repair a Project

`rowbly doctor --json` compares the files with the config. It does not change files. Add `--fix` to
apply each available repair.

```json
{
  "root": "/abs/path",
  "issues": [
    {
      "severity": "error",
      "message": "Stage \"backlog\" should be BACKLOG",
      "file": ".rowbly/stories/BACKLOG/APP-01.md",
      "fix": "Correct it",
      "fixed": false
    }
  ],
  "ok": false
}
```

Run `doctor` if an error has a hint about `rowbly doctor`, or after a Git merge changes `.rowbly/`.
One invalid Story file makes `story search` fail for the full Project.

`doctor` exits with 1 if an `error` issue is not fixed. Warnings do not change the exit code.

| Problem                                                                          | `--fix` action |
| -------------------------------------------------------------------------------- | -------------- |
| Folder or Stage file is not there, or a Stage file is not in the config          | Repairs it     |
| Story has no Stage, or has a Stage key in the wrong case                         | Repairs it     |
| Story has a custom field too few or too many                                     | Repairs it     |
| Story has a field value in the wrong format that Rowbly can convert              | Repairs it     |
| Story has a tag value that is not in the config, or a `tags` value that is not a list | Removes the bad values |
| Spec has no title, a wrong `stories` value, or a link to a Story that is deleted | Repairs it     |
| Story has no title or has an unknown Stage                                       | No repair      |
| Story has no `uid` (warning)                                                     | Adds a new `uid` |
| Story has a `uid` that is not a UUID                                             | No repair      |
| Story file has a bad name, a wrong Project key or a number that another file has | No repair      |
| File has invalid frontmatter, or `rowbly.config.json` is invalid                 | No repair      |
| Installed skill is missing, and the Rowbly package has the skill                 | Repairs it     |
| Installed skill is missing, and the Rowbly package does not have the skill       | No repair      |
| Installed skill folder exists but has no `SKILL.md`                              | No repair      |
| Spec is an orphan (warning)                                                      | No repair      |
| User prompt file is not there (warning)                                          | Creates an empty file |
| Old `ROWBLY.md` with no text or only `# ROWBLY INSTRUCTIONS` (warning)           | Deletes it     |
| Old `ROWBLY.md`, and the Project prompt has no text (warning)                    | Moves it to `prompts/SYSTEM.md` |
| Old `ROWBLY.md`, and the Project prompt has text (warning)                       | No repair. Merge them by hand. |
| The `factory` key of `rowbly.config.json` is invalid                             | No repair      |
| Old `factory.json` is not valid JSON or has invalid settings                     | No repair. The file stays. |
| Old `factory.json`, and the config has no `factory` key (warning)                | Moves it to the `factory` key |
| Old `factory.json` with the same settings as the `factory` key (warning)         | Deletes it     |
| Old `factory.json` with different settings from the `factory` key (warning)      | No repair. Merge them by hand. |
| Story is in a disabled Stage (warning)                                           | No repair      |
| Story file is not in the folder of its Stage (warning)                           | Moves it to `stories/<Stage key>/` |
| Two Story files have the same ID, in one folder or in different folders          | No repair      |
| Folder in `stories/` does not have the name of a Stage key (warning)             | No repair      |

Fix a problem with no repair by hand. Then run `rowbly doctor --json` again. Do not delete an
orphan Spec if the user did not tell you to do it. A problem with an installed skill has a
`message` that names the `skill remove` command. Get approval from the user before you run it.

## 10. Differences from older versions

Older skills and notes can show commands that do not exist now. Do not use the items in this table.

| Old item                                                  | Current replacement                                           |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `rowbly stories list`                                     | `rowbly story search`                                       |
| `rowbly stories show`                                     | `rowbly story get`                                            |
| `rowbly stories create --name`                            | `rowbly story create --title`                                 |
| `rowbly stories edit`                                     | `rowbly story update`                                         |
| `rowbly stories move`                                     | `rowbly story update --stage`                                 |
| `rowbly stories rank`, `rowbly story update --position`   | None. The order in a Stage is by `updatedAt`                  |
| `rowbly stories delete --yes`                             | `rowbly story delete`                                         |
| `rowbly config show`                                      | Read `.rowbly/rowbly.config.json`                             |
| Data Root                                                 | Project                                                       |
| Boards, `--board`, `rowbly use`, `rowbly boards`          | One Project in each `.rowbly/`, with no Boards                |
| Lower-case Stage keys, Stage categories                   | Stage keys in UPPER_SNAKE_CASE, with no categories            |
| `--no-prompt`, `--yes`, `--edit`                          | No replacement. The CLI does not ask questions.               |
| `--description-file`                                      | Command substitution (section 5, "Long text")                 |
| Labels, priority, due date                                | Custom fields                                                 |
| Specs Plugin                                              | The Specs feature (`rowbly project update --specs on`)        |
| `rowbly plugins`, and all other Plugins                   | No replacement                                                |
| Tasks, Epics, Comments, Assignees, Attachments            | No replacement                                                |
| Automatic Git commits, GitHub integration                 | No replacement. Rowbly does not run Git.                      |
| Exit codes 2 to 6                                         | Exit code 1 and `error.code`                                  |
| `rowbly project get-instructions`, `.rowbly/ROWBLY.md`    | `rowbly prompt get system`, `.rowbly/prompts/SYSTEM.md`       |
| `.rowbly/factory.json`                                    | The `factory` key of `.rowbly/rowbly.config.json`             |
