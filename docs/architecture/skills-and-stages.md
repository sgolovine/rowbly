# Bundled skills and stage prompts

The skills in `skills/` and the stage prompts in `stages/` are a part of the product. Onboarding and
`rowbly skill install` copy them into a user Project. The external factory runs them with no person
present, so changes to them have strict rules.

Read this when you change a bundled skill, a default stage prompt, the `skill` commands, or the
shared factory scripts.

## Bundled skills

| Skill     | Function                                                                      |
| --------- | ----------------------------------------------------------------------------- |
| `factory` | Starts the native factory, or supervises workers through an external harness. |
| `refine`  | Makes a Story ready for development without source code changes.              |
| `develop` | Builds a refined Story in a Git worktree, or repairs review findings.         |
| `review`  | Examines a Story pull request and reports if it is ready to merge.            |

`rowbly skill install` copies them into a Project. The default stage prompts in `stages/` use them.

`skills/rowbly-reference.md` is a shared reference that tells an agent how to use the `rowbly` CLI.
Each skill has a copy in `references/rowbly-reference.md`. The `factory` copy adds text about the
native factory and Threads.

## The installed copies in this repository

The folders `.agents/skills/<name>` and `.claude/skills/<name>` of this repository are installed
copies of the bundled skills.

- After a change in `skills/<name>/`, copy the folder to the two installed copies.
- A test in `pnpm test:factory` compares the `factory` copies with the bundled files.

## Rules for a change to a skill or a stage prompt

The factory runs with no person present, and agents with small models can run it. Obey these rules
when you change a bundled skill or a file in `stages/`:

- Do not add a step that asks a person a question or that waits for a person.
- Do not add a condition that stops the factory because of one Story, one Stage, one worker or one check.
- Give each problem an action that lets the work continue: a fallback, a new worker or a record in the Story.
- Put each rule that has no judgement in a script of `skills/factory/scripts/`, not in the text of a skill.
- Give the exact command line for each step of a skill.

## Factory skill files

| File in `skills/factory/`         | Function                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `scripts/factory.mjs`             | The tool of the external supervisor. Each command prints the next actions as JSON.  |
| `scripts/supervisor-policy.mjs`   | The assignment rules: new workers, delays, the limit of workers and parked Stories. |
| `scripts/factory-state.mjs`       | Reads and replaces `.rowbly/state.json` under the state lock.                       |
| `scripts/commit-project.mjs`      | Commits the changed files of `.rowbly/` under the shared write lock.                |
| `scripts/ownership-lock.mjs`      | The shared local ownership protocol of the native and external factory.             |
| `scripts/worker-message.mjs`      | Fills the fields of a worker message template.                                      |
| `references/supervisor-policy.md` | The v1 policy and the `state.json` format.                                          |
| `references/worker-message.md`    | The template of the first message that each external worker gets.                   |
| `references/supervisor-native.md` | The prompt of the native supervisor.                                                |

The `.d.mts` files give TypeScript types for the scripts, because `src/` imports some of them. The
tests of these scripts use `node:test`. Run them with `pnpm test:factory`.

## Default stage prompts

- `stages/` holds the default stage prompts for new Projects: `BACKLOG.md`, `IN_REFINEMENT.md`,
  `IN_DEVELOPMENT.md`, `IN_REVIEW.md` and `DONE.md`. Onboarding copies them into a Project.
- `.rowbly/stages/` of this repository holds the prompts of the Rowbly project itself.
- A change to one does not change the other.

## Skills in a user Project

The `skills` list of the config holds the bundled skills that a Project has installed. Each entry has
the `name` of a skill and the `harnesses` that have a copy. `rowbly skill install` copies a folder from
the `skills/` folder of the Rowbly package to the project skills folder of each harness:

| Harness          | Project skills folder |
| ---------------- | --------------------- |
| `claude-code`    | `.claude/skills`      |
| `codex`          | `.agents/skills`      |
| `gemini-cli`     | `.gemini/skills`      |
| `github-copilot` | `.github/skills`      |
| `cursor`         | `.cursor/skills`      |

A skill is present if its folder has a `SKILL.md`. `skill install`, `skill list` and `doctor` use the
same rule.

- `rowbly skill list` shows the installed skills.
- `skill install` examines each target before it writes. If other content is at a target, the command
  stops and changes nothing. If nothing is at the path of a tracked skill, the command copies it again.
- `rowbly skill remove` deletes only the folders that the config tracks. It keeps a folder that a
  different tracked harness uses through a symlink, at the skill or at the skills folder. If the path
  of the skill is a symlink, it deletes only the link.

Keep your changes to a tracked skill in a different place. `rowbly skill remove` deletes the folder
and all local changes in it.

Harnesses can read the same folders. For example, Cursor also reads `.claude/skills` and
`.agents/skills`. A skill can then stay visible to a harness after you remove the skill for that
harness.

## Doctor and skills

- `rowbly doctor` shows an error if a tracked skill is not installed for a harness.
- `--fix` installs the skill again if nothing is at its path and the Rowbly package still has the skill.
- `--fix` does not change a folder that has no `SKILL.md`, because the folder can contain the work of
  a user.
- A file or a broken symlink can prevent the creation of the skills folder. Then `doctor` shows an
  error with the path and offers no fix.

## Related

- [onboarding.md](onboarding.md): how a new Project selects Stages and skills.
- [native-factory/README.md](native-factory/README.md): the native factory, which uses the shared scripts.
- [testing.md](testing.md#factory-script-tests): the `node:test` suite.
