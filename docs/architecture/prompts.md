# Prompts

The factory agents get their instructions from prompts at two levels. Rowbly owns the system prompts.
The user owns the user prompts and the Stage prompts of a Project. One service builds each message
from these prompts.

Read this when you change a prompt, the `prompt` commands, the Prompts section of Settings, or the
message of a factory agent.

## The two levels

| Level  | Folder                                 | Who can change it             |
| ------ | -------------------------------------- | ----------------------------- |
| System | `src/config/prompts/` of the package   | Rowbly developers only        |
| User   | `.rowbly/prompts/` of each Project     | The user, by hand, CLI or TUI |
| Stage  | `.rowbly/stages/<KEY>.md` of a Project | The user, by hand, CLI or TUI |

The `files` list of `packages/cli/package.json` includes `src/config/prompts`, so the package has the system
prompts. There is no system Stage prompt.

## Who gets each prompt

| File                           | Name                 | Who gets it                    |
| ------------------------------ | -------------------- | ------------------------------ |
| `src/config/prompts/SYSTEM.md` | Rowbly system prompt | All workers                    |
| `src/config/prompts/WORKER.md` | Worker system prompt | All workers, in all Stages     |
| `.rowbly/prompts/SYSTEM.md`    | Project prompt       | All workers                    |
| `.rowbly/prompts/WORKER.md`    | Worker prompt        | All workers, in all Stages     |
| `.rowbly/stages/<KEY>.md`      | Stage prompt         | Only the workers of that Stage |

## Old Supervisor prompt

Older versions of Rowbly had a Supervisor prompt in `.rowbly/prompts/SUPERVISOR.md`. Rowbly does not
use it now.

- No agent gets the text of this file.
- `rowbly prompt get supervisor` and `rowbly prompt set supervisor` give a `VALIDATION` error with a
  hint. The exit code is 1.
- `rowbly prompt list` does not show it.
- Rowbly never deletes the file. The user can delete it.

## Priority

The global system prompt tells each agent this order of priority:

1. The Rowbly system prompts. A user prompt cannot remove a rule of a system prompt.
2. The Stage prompt.
3. The Worker prompt.
4. The Project prompt.

## The messages

`src/services/messages/messages.ts` is the only place that builds the messages of the factory agents.
Do not build a message in a different module. It builds only the first message of a worker. Each
section starts with a `# ` heading, in this order:

1. `Rowbly system prompt`
2. `Rowbly worker system prompt`
3. `Project prompt`
4. `Worker prompt`
5. `Stage prompt (<KEY>)`
6. `Run`

The `Run` section gives the Story, the Stage, the canonical Project root, the worktree, the model and
the `flock` command prefix. When the Project has checks, it also lists the checks, and the worker
system prompt keeps its check rules. See [native-factory/checks.md](native-factory/checks.md#prompts). A user prompt or a Stage prompt with no text gives no section. Rowbly cuts
each user prompt at 16000 characters (`USER_PROMPT_LIMIT`).

### Upstream Stories

When the Story of a worker has upstream Stories (`dependsOn`), the worker message tells the worker about them:

- The `Run` section lists the upstream Stories under the line
  `Upstream Stories (read each one with \`story get\`):`. The order is the order of `dependsOn`.
- Each line gives the ID, the title and the Stage key of one upstream Story. It also gives the key and
  the value of each `url` custom field that has a value, for example
  `- ROW-59: Store Story dependencies (DONE), pull_request: https://…`.
- The line does not show a `url` field with no value or a field of a different type.
- An ID in `dependsOn` that is not a Story gives no line and no error. `rowbly doctor` reports it.
- `src/config/prompts/WORKER.md` has the upstream rule between `<!-- upstream -->` and
  `<!-- /upstream -->`. The rule tells the worker not to do the work of the upstream Stories again.
  The message keeps this rule only when the Story has upstream Stories. It does not keep the marker
  comments.
- A Story with no upstream Stories gets no upstream lines and no upstream rule.
- `upstreamOf()` in `messages.ts` makes the upstream lines from the Stories and the keys of the `url`
  fields. `buildWorkerPrompt` in `factory-manager/worker-launch.ts` reads the Stories and the config
  only when `dependsOn` is not empty.
- The message does not include the descriptions of the upstream Stories. The worker reads them with
  `rowbly story get`.

## Dependency rules

The manager does not start a worker for a blocked Story, and the launch order starts the upstream
Stories first. The factory snapshot gives the dependency lists. The manager also raises an
`upstream-stuck:<ID>` attention entry for an upstream Story that cannot progress. See
[native-factory/README.md](native-factory/README.md).

## Read and write the user prompts

`src/services/prompts/prompts.ts` reads and writes the user prompts. Its functions are `listPrompts()`,
`getPrompt()`, `setPrompt()`, `readUserPrompt()`, `readSystemPrompt()` and `createUserPrompts()`.

- Rowbly never assumes that a user prompt exists. A missing file has no text.
- `rowbly init` and the onboarding of the TUI create the two user prompts with no text.
- `rowbly prompt list` shows the two user prompts.
- `rowbly prompt get <system|worker>` shows the text of one prompt. With `--json`, it gives
  `{name,label,path,exists,text}`.
- `rowbly prompt set <name> --text <markdown>` replaces a prompt. `--file <path>` reads the text from a
  file, and `--file -` reads stdin.
- In the TUI, Settings › Project › Prompts shows the two user prompts, their state and their
  audience. The state is `missing`, `empty` or the number of lines. Press `enter` or `e`, or click a
  row, to edit a prompt in a Modal. Press `ctrl+s` to save.

## Doctor and prompts

- `rowbly doctor` shows a warning for each user prompt that is missing. `--fix` creates an empty file.
- An old `.rowbly/ROWBLY.md` gives a warning, because Rowbly does not read it now.
- If `ROWBLY.md` has no text or only `# ROWBLY INSTRUCTIONS`, `--fix` deletes it.
- If the Project prompt has no text, `--fix` moves `ROWBLY.md` to `prompts/SYSTEM.md`.
- If the two files both have text, `doctor` offers no fix. Merge them by hand.
- `rowbly doctor` shows no warning when `.rowbly/prompts/SUPERVISOR.md` is missing.
- When `.rowbly/prompts/SUPERVISOR.md` exists, `rowbly doctor` shows a warning: Rowbly does not use
  the file, and the user can delete it. The warning has no fix. `--fix` does not delete the file.

## Related

- [storage.md](storage.md): the layout of `.rowbly/`.
- [native-factory/README.md](native-factory/README.md): the factory pass and the workers.
- [skills-and-stages.md](skills-and-stages.md): the default Stage prompts.
