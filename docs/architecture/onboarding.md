# Onboarding

Onboarding creates a Project. The TUI and `rowbly init` ask the same questions, and both call the
same two services: `planOnboarding()` and `applyOnboarding()` in `src/services/onboarding/`. This
page gives the steps, the defaults and the rules.

Read this when you change `rowbly init`, the onboarding steps of the TUI, the default Stages or the
default skills of a new Project.

## Two front ends, one plan

- `rowbly` with no Project shows the steps on the screen, in the Story panel
  (`src/tui/screens/onboarding/`). Do not use a Modal for these steps.
- `rowbly init` asks the same questions through `@clack/prompts` (`src/commands/init-wizard/`).

## Steps

The first question is "defaults" or "customize". The defaults go directly to the summary. The steps
are:

| Step         | Default                                                  | Customization                                     |
| ------------ | -------------------------------------------------------- | ------------------------------------------------- |
| Name and key | The name of the directory, and the first 3 letters of it | Any valid name and key                            |
| Stages       | All files in `stages/`, in the order of `DEFAULT_STAGES` | Remove other default stages, or add custom stages |
| Agent skills | All folders in `skills/`, for all harnesses              | Select the skills and the harnesses               |

The last step is always a summary. It also tells the user where to edit each item.

`DEFAULT_STAGES` is `BACKLOG`, `IN_REFINEMENT`, `IN_DEVELOPMENT`, `IN_REVIEW` and `DONE`.

## Rules

- Backlog and Done are always enabled. The user cannot remove them. If flags or JSON leave one out,
  Rowbly adds it.
- A custom Stage gets a placeholder prompt. A default Stage gets its file from `stages/`.
- A skill that a selected default Stage uses shows `(required)`. The user cannot remove it.
- The `factory` skill also shows `(required)`, because the factory cannot run without it. The user can
  remove it. Then the summary and the output of `rowbly init` show a warning.
- The custom fields of the skills (`worktree`, `pull_request`) are added with the skills that use them.
- If a skill install fails, `applyOnboarding()` removes the new Project and the skills that it
  installed.
- Initialization creates `ROWBLY.md` and `.rowbly/.gitignore`. See [storage.md](storage.md).

## `rowbly init` input

`rowbly init` asks questions only in a terminal, with no choice flags and no `--json`. Otherwise it
uses the flags, the `--input` JSON and the defaults, in this priority.

- The flags are `--name`, `--key`, `--stage` (repeat), `--skill` (repeat), `--no-skills`, `--harness`
  (repeat), `--input` and `--defaults`.
- The `--input` value is inline JSON, a file path, or `-` for stdin.
- The JSON keys are `name`, `key`, `stages`, `skills` and `harnesses`.
- Agents can use `rowbly init --defaults --harness <id>` with no questions.

## Related

- [skills-and-stages.md](skills-and-stages.md): the default Stage prompts and the bundled skills.
- [storage.md](storage.md): the files that onboarding creates.
