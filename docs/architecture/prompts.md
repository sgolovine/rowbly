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

The `files` list of `package.json` includes `src/config/prompts`, so the package has the system
prompts. There is no system Stage prompt.

## Who gets each prompt

| File                               | Name                     | Who gets it                    |
| ---------------------------------- | ------------------------ | ------------------------------ |
| `src/config/prompts/SYSTEM.md`     | Rowbly system prompt     | The supervisor and all workers |
| `src/config/prompts/SUPERVISOR.md` | Supervisor system prompt | The supervisor only            |
| `src/config/prompts/WORKER.md`     | Worker system prompt     | All workers, in all Stages     |
| `.rowbly/prompts/SYSTEM.md`        | Project prompt           | The supervisor and all workers |
| `.rowbly/prompts/SUPERVISOR.md`    | Supervisor prompt        | The supervisor only            |
| `.rowbly/prompts/WORKER.md`        | Worker prompt            | All workers, in all Stages     |
| `.rowbly/stages/<KEY>.md`          | Stage prompt             | Only the workers of that Stage |

## Priority

The global system prompt tells each agent this order of priority:

1. The Rowbly system prompts. A user prompt cannot remove a rule of a system prompt.
2. The Stage prompt.
3. The Supervisor prompt or the Worker prompt.
4. The Project prompt.

## The messages

`src/services/messages/messages.ts` is the only place that builds the messages of the factory agents.
Do not build a message in a different module. Each section starts with a `# ` heading, in this order:

1. `Rowbly system prompt`
2. `Rowbly supervisor system prompt` or `Rowbly worker system prompt`
3. `Project prompt`
4. `Supervisor prompt` or `Worker prompt`
5. `Stage prompt (<KEY>)`, for workers only
6. `Digest` for the supervisor, or `Run` for a worker

The `Run` section gives the Story, the Stage, the canonical Project root, the worktree, the model and
the `flock` command prefix. When the Project has checks, it also lists the checks, and the worker
system prompt keeps its check rules. See [native-factory/checks.md](native-factory/checks.md#prompts-and-the-digest). A user prompt or a Stage prompt with no text gives no section. Rowbly cuts
each user prompt at 16000 characters (`USER_PROMPT_LIMIT`).

## Read and write the user prompts

`src/services/prompts/prompts.ts` reads and writes the user prompts. Its functions are `listPrompts()`,
`getPrompt()`, `setPrompt()`, `readUserPrompt()`, `readSystemPrompt()` and `createUserPrompts()`.

- Rowbly never assumes that a user prompt exists. A missing file has no text.
- `rowbly init` and the onboarding of the TUI create the three user prompts with no text.
- `rowbly prompt list` shows the three user prompts.
- `rowbly prompt get <system|supervisor|worker>` shows the text of one prompt. With `--json`, it gives
  `{name,label,path,exists,text}`.
- `rowbly prompt set <name> --text <markdown>` replaces a prompt. `--file <path>` reads the text from a
  file, and `--file -` reads stdin.
- In the TUI, Settings › Project › Prompts shows the three user prompts, their state and their
  audience. The state is `missing`, `empty` or the number of lines. Press `enter` or `e`, or click a
  row, to edit a prompt in a Modal. Press `ctrl+s` to save.

## Doctor and prompts

- `rowbly doctor` shows a warning for each user prompt that is missing. `--fix` creates an empty file.
- An old `.rowbly/ROWBLY.md` gives a warning, because Rowbly does not read it now.
- If `ROWBLY.md` has no text or only `# ROWBLY INSTRUCTIONS`, `--fix` deletes it.
- If the Project prompt has no text, `--fix` moves `ROWBLY.md` to `prompts/SYSTEM.md`.
- If the two files both have text, `doctor` offers no fix. Merge them by hand.

## Related

- [storage.md](storage.md): the layout of `.rowbly/`.
- [native-factory/README.md](native-factory/README.md): the supervisor and the workers.
- [skills-and-stages.md](skills-and-stages.md): the default Stage prompts.
