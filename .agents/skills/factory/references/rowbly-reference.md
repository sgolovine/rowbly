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
- Do not assume the keys of the Stages or the custom fields. Read them from the config (section 3).
- Change data only with commands. A command examines the data before it writes the data.
- Run only one command that writes at a time for each Project. Human CLI writes have no global transaction lock. In a
  test, six parallel `story create` commands all reported success, but only four Stories were written.
- Get approval from the user before you run `story delete`, `stage delete`, `spec delete` or
  `custom-field remove`. These commands do not ask for confirmation.
- Do not run a failed command again with the same input. Read the error and change the input.

## 2. Concepts

| Concept      | Description                                                                         |
| ------------ | ----------------------------------------------------------------------------------- |
| Project      | The top-level record. It holds the custom field definitions and the Stages.         |
| Story        | One item of work. It has a title, a description, custom field values and one Stage. |
| Stage        | A step of the workflow. Each Stage can have a prompt.                               |
| Stage prompt | Instructions that tell agents what to do with a Story in that Stage.                |
| Instructions | The text of `.rowbly/ROWBLY.md`. It applies to all agents and all work in a Project. |
| Custom field | A field that you define one time. It applies to all Stories of the Project.         |
| Spec         | A Markdown document that describes work. It links to one or more Stories.           |

Each new Project has Backlog and Done, plus the other Stages selected at setup. Specs are off in each new Project.

## 3. Find the Project and read its config

Rowbly uses the nearest `.rowbly/` at or above the current directory. Use `-C <dir>` to start from
a different directory. If the Project is in Git, each Git worktree has its own copy of `.rowbly/`.
Use `-C <dir>` to select the Project that all agents share.

The CLI has no command that lists the Stages or the custom fields. Read
`.rowbly/rowbly.config.json` to find them. The file is safe to read.

```json
{
  "projectName": "My App",
  "projectKey": "APP",
  "customFields": [{ "key": "priority", "label": "Priority", "type": "select", "options": ["P1", "P2"] }],
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
| `NOT_FOUND`  | The Project, Story, Stage, custom field or Spec does not exist.          | Examine the ID or key.               |
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
The resources are `project`, `story`, `stage`, `custom-field`, `spec` and `skill`.
Run `rowbly <resource>` or `rowbly <resource> --help` to see its actions.
Run `rowbly <resource> <action> --help` to see its arguments and options.
The old flat resource commands do not work.
The commands `init` and `doctor` stay at the root.

A flag with `(repeat)` can occur more than one time.

### Native factory and Threads

| Command | Function |
| --- | --- |
| `rowbly auth providers` | Lists provider login methods. |
| `rowbly auth status` | Shows configured status, without a health check. |
| `rowbly auth login [provider] [--type oauth\|api_key]` | Uses an interactive terminal without `--json`; secrets use masked prompts. |
| `rowbly auth logout <provider>` | Removes a stored credential. |
| `rowbly model list [--provider <id>]` | Lists configured models and supported thinking levels. |
| `rowbly factory configure --max-workers <n> --supervisor <provider/model> --worker <provider/model>` | Saves optional Project factory settings. |
| `rowbly factory start [--foreground] [--max-workers <n>] [--adopt-external]` | Starts the native factory. |
| `rowbly factory status` | Reads native status without Pi activation. |
| `rowbly factory stop` | Aborts native sessions and preserves histories and worktrees. |
| `rowbly factory restart [--adopt-external]` | Waits for stop before a replacement start. |
| `rowbly factory logs [--tail <n>]` | Reads bounded operational logs without transcript bodies. |
| `rowbly thread list [--story <id>]` | Lists active and historical metadata without transcript reads. |
| `rowbly thread show <id>` | Reads one Thread record. |
| `rowbly thread log <id> [--tail <n>]` | Reads current Pi format without activation; default 20, maximum 100 entries. |
| `rowbly thread cancel <id>` | Interrupts through the active native factory. |
| `rowbly thread resume <id>` | Resumes an eligible Thread through the active native factory. |

Native execution requires Node >=22.19.0, Linux, Git, local files and util-linux `flock`.
Model configuration does not prove entitlement or credential health.
Use `--supervisor-thinking` or `--worker-thinking` with a supported level in `factory configure`.
Factory settings stay in `.rowbly/factory.json`. Credentials stay in Pi storage.

Never run native and external supervisors together. Stop external workers before explicit `--adopt-external` use.
Adoption marks active external attempts interrupted; it does not stop workers or import their conversations.

Resume keeps the same session and adds a run. Completed Threads cannot resume. Each Thread has at most three runs.
See [Supervisor policy](supervisor-policy.md) for ownership, locks and recovery limits.

### Project

| Command                                               | JSON result | Notes                                                       |
| ----------------------------------------------------- | ----------- | ----------------------------------------------------------- |
| `rowbly init [--defaults] [--name <name>] [--key <key>] [--stage <stage>] [--skill <name>] [--no-skills] [--harness <id>] [--input <json\|file\|->]` | Project, `installed`, `edits` | Creates `.rowbly/`, the Stages and the skills. Always adds Backlog and Done. Gives `CONFLICT` if `.rowbly/` exists. |
| `rowbly project update [--name <name>] [--key <key>]` | Project     | `--key` renames all Story files and changes all Spec links. |
| `rowbly project update --specs <on\|off>`             | Project     | Turns Specs on or off.                                      |
| `rowbly project get-instructions`                             | Instructions | Reads `.rowbly/ROWBLY.md`. Works if the file does not exist. |

An Instructions record has this shape. `instructions` is empty if the file does not exist:

```json
{ "path": "/abs/path/.rowbly/ROWBLY.md", "instructions": "Markdown text" }
```

### Story

| Command                                                                                             | JSON result     |
| --------------------------------------------------------------------------------------------------- | --------------- |
| `rowbly story create --title <title> [--stage <key>] [--description <md>] [--field <k=v>] (repeat)` | Story           |
| `rowbly story get <id>`                                                                             | Story           |
| `rowbly story search [query] [--stage <key>] [--field <k=v>] (repeat)`                            | Array of Story  |
| `rowbly story update <id> [--title <t>] [--stage <key>] [--position <n>] [--description <md>] [--field <k=v>] (repeat)` | Story |
| `rowbly story delete <id>`                                                                          | `{ "id": … }`   |

A Story record has this shape:

```json
{
  "id": "APP-01",
  "number": 1,
  "title": "Login page",
  "stage": "BACKLOG",
  "position": 1,
  "description": "Markdown text",
  "fields": { "priority": "P1", "story_points": null },
  "path": "/abs/path/.rowbly/stories/APP-01.md"
}
```

- **IDs.** `APP-01`, `app-1` and `1` all select the same Story. The prefix must be the key of the Project.
- **New Stories.** A new Story goes last in its Stage. Without `--stage`, it goes in the first enabled Stage.
- **Moves.** A Story that changes Stage goes last, if you do not give `--position`.
- **Positions.** `--position` starts at 1. A value that is too large puts the Story in the last place.
- **Descriptions.** `--description` replaces the full description. An empty value clears it.
- **Fields.** `--field` changes only the fields that you name.
- **Search.** With no filters, `story search` shows all Stories. A Story must agree with all filters.
- **Search text.** Each word of `query` must occur in the ID, title, description or a field value. Case has no effect.
- **Search order.** The results are in the order of the Stages, then in the order of the positions.

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

Field keys are case sensitive and in snake_case. The keys `title`, `stage`, `position`, `id` and
`description` are reserved.

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

Only Specs have a file flag. `--description` and `--prompt` take the text as an argument. To send
the contents of a file, use command substitution:

```sh
rowbly story update APP-01 --description "$(cat notes.md)" --json
```

## 6. Work on a Story

1. Read the instructions of the Project (section 7):

   ```sh
   rowbly project get-instructions --json
   ```

2. Find the Stories of a Stage. They are in the order of their positions:

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

## 7. Project instructions

`.rowbly/ROWBLY.md` holds the top-level instructions for all agents of a Project. It operates as a
`CLAUDE.md` or `AGENTS.md` file does. Initialization creates the file with only `# ROWBLY INSTRUCTIONS` and a final newline.
Existing Projects can omit the file. Rowbly does not parse or enforce its text.

- **Read.** Read the instructions before you do work or change data in a Project.
- **Supervisors.** Give the full text of `instructions` to each worker in its first message.
- **Workers.** If the first message does not have the instructions, read them with `project get-instructions`.
- **Order.** Obey the user first. Then obey the Stage prompt, because it is more specific. Then obey `ROWBLY.md`.
- **Skills.** `ROWBLY.md` has priority over the steps of a skill.
- **Limits.** `ROWBLY.md` does not remove the rules in section 1.
- **Changes.** Edit the file only if the user tells you to do it.

## 8. Files

Read these files if a command does not give the data. Users can edit these files by hand.

```
.rowbly/
  rowbly.config.json   # Project name and key, custom fields, Stages, features, installed skills
  ROWBLY.md            # optional; the full file is the instructions for all agents
  stories/APP-01.md    # frontmatter: title, stage, position, one key for each custom field
  stages/BACKLOG.md    # the full file is the Stage prompt
  specs/login-page.md  # frontmatter: title, stories; the body is the Spec
```

```markdown
---
title: Login page
stage: BACKLOG
position: 1
priority: null
---

The Markdown description of the Story.
```

The `skills` list of `rowbly.config.json` holds each installed skill and its harnesses. The copies
are outside `.rowbly/`, in the project skills folder of each harness (section 5, "Skill").

In Story files, `null` means that the field has no value. A Story with no `position` comes after
the Stories that have one.

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
      "file": ".rowbly/stories/APP-01.md",
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
| Spec has no title, a wrong `stories` value, or a link to a Story that is deleted | Repairs it     |
| Story has no title or has an unknown Stage                                       | No repair      |
| Story file has a bad name, a wrong Project key or a number that another file has | No repair      |
| File has invalid frontmatter, or `rowbly.config.json` is invalid                 | No repair      |
| Installed skill is missing, and the Rowbly package has the skill                 | Repairs it     |
| Installed skill is missing, and the Rowbly package does not have the skill       | No repair      |
| Installed skill folder exists but has no `SKILL.md`                              | No repair      |
| Spec is an orphan (warning)                                                      | No repair      |
| Story is in a disabled Stage (warning)                                           | No repair      |

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
| `rowbly stories move`, `rowbly stories rank`              | `rowbly story update --stage`, `--position`                   |
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
