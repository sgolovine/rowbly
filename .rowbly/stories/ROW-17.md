---
title: "Factory Git settings: commit author and message"
stage: DONE
position: 16
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-17
pull_request: https://github.com/sgolovine/rowbly/pull/200
---

## Goal

The author asked for Git settings for the factory:

- Define the author and the commit message.
- Define if the factory does a periodic sync when it finds changes. Often the factory makes commits but does not push them. Give an option to commit and sync changes automatically.
- Also give an option for periodic pulls (part of the feature above).

The native factory already commits the canonical `.rowbly/` files after each scan, with the fixed message `chore(rowbly): record project changes after scan` and the default Git identity. This Story lets the user set the author and the message of these commits. The user gets canonical commits with a known author and a message that the user selects.

## Scope

In scope:

- A new optional `git` section in `.rowbly/factory.json` with `commitMessage`, `authorName` and `authorEmail`.
- Validation of the section in the `factory-settings` service.
- New flags of `rowbly factory configure` that set these values.
- The factory canonical commit (`commitCanonicalProject` and `skills/factory/scripts/commit-project.mjs`) uses these values.
- Documentation of the new settings.

Not in scope:

- Periodic push and periodic pull, and their settings. See ROW-18.
- Git settings in the TUI settings screen. See ROW-19.
- Commits that worker agents make on Story branches in their worktrees.

## Acceptance criteria

- [ ] `getFactorySettings` accepts a `factory.json` with or without a `git` section. A `git` section with a value that is not a non-empty string (for example `commitMessage: ""` or `authorEmail: 5`) gives `ValidationError("Invalid factory settings")`. A unit test examines each case.
- [ ] `rowbly factory configure --commit-message "<text>" --json` writes `git.commitMessage` to `factory.json` and keeps all other keys. A test examines this.
- [ ] `rowbly factory configure --commit-author "Name <email@example.com>" --json` writes `git.authorName` and `git.authorEmail`. A value that is not in the `Name <email>` form gives a `VALIDATION` error, and `factory.json` does not change. A test examines this.
- [ ] `rowbly factory configure` with only Git flags does not start the Pi auth runtime. A test examines this.
- [ ] A clear operation exists: `--commit-message ""` and `--commit-author ""` remove the value, and the factory uses the default again. A test examines this.
- [ ] `commit-project.mjs` accepts `--author "Name <email>"`. With the flag, the commit has that author and committer. Without the flag, the commit uses the Git config identity as before. `commit-project.test.mjs` examines both cases.
- [ ] When the factory commits canonical files, the commit uses `git.commitMessage` (or the default message if it is not set) and the configured author. A test of `factory-manager` or `project-write` examines this.
- [ ] `docs/architecture/storage.md`, `docs/architecture/native-factory/runtime-and-locks.md` and `docs/architecture/native-factory/pi-runtime-and-auth.md` describe the `git` section in STE.
- [ ] The copies of `skills/factory/` in `.agents/skills/factory` and `.claude/skills/factory` are the same as the source. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:factory` pass.

## Technical notes

- Settings: `src/services/factory-settings/factory-settings.ts`. Add `git?: { commitMessage?: string; authorName?: string; authorEmail?: string }` to `FactorySettings`, extend `validate`, and extend `ConfigureInput` and `configureFactory`. `authorName` and `authorEmail` must be set together. `chooseRole` starts the auth runtime only for a model value; keep it so.
- CLI: `registerConfigure` in `src/commands/factory/factory.ts`. Add `--commit-message <text>` and `--commit-author <identity>`. Parse the identity in the service, not in the command.
- Commit: `commitCanonicalProject(root)` in `src/services/project-write/project-write.ts` runs `commit-project.mjs --root <root> --locked`. Add optional `message` and `author` inputs and pass `--message` and `--author`. `commitLocked` in `commit-project.mjs` runs `git commit`; use `git -c user.name=<name> -c user.email=<email> commit ...` or `--author` plus the committer environment variables, so that the commit works also when Git has no identity. Update `commit-project.d.mts`.
- Caller: `commitProject(manager)` in `src/services/factory-manager/supervisor-loop.ts` runs after `refreshSettings`. Read `getState(manager).settings.git` there.
- `factory.json` is a committed file. It is not a runtime file.
- After a change in `skills/factory/`, copy the folder to `.agents/skills/factory` and `.claude/skills/factory`.
- Follow the `rowbly-code-style` skill. Write Markdown in STE.

## Assumptions

- The author and the commit message apply only to the canonical `.rowbly/` commits that the factory makes. Reason: this is the only commit that Rowbly code makes. Worker agents make their own commits on Story branches, and the author did not mention them. This is the smallest scope.
- The settings go in `.rowbly/factory.json` under a `git` key, not in `rowbly.config.json` or `~/.rowblyrc.json`. Reason: `factory.json` already holds the factory settings and the factory reads it on each scan.
- The commit message setting replaces the subject line only. The body with the list of changed paths stays. Reason: the body helps the user see what changed, and the author did not ask to remove it.
- The author is one `Name <email>` value in the CLI, and Rowbly also sets the committer to the same identity. Reason: this is the usual Git form, and the commit then works on a machine with no Git identity.
- The request was split into three Stories (this Story, ROW-18 for periodic push and pull, ROW-19 for the TUI). Reason: one pull request cannot hold all the work. The author and message settings have a result of their own and are first, because ROW-18 and ROW-19 use the same settings section.
