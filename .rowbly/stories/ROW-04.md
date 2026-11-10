---
title: Init should add ROWBLY.md to .rowbly folder.
stage: DONE
position: 1
worktree: /home/sgolovine/.t3/worktrees/rowbly/row-04-in_development
pull_request: https://github.com/sgolovine/rowbly/pull/180
---

## Goal

Create `.rowbly/ROWBLY.md` when a user creates a Project through the CLI or the TUI.
The file gives the user a place for Project instructions for agents.

## Scope

Create the file for each new Project, with defaults or custom choices.
The file contains only the Markdown heading `# ROWBLY INSTRUCTIONS` and a final newline.
Do not add instructions, examples, frontmatter or other text.
Do not add a migration, a new option or a TUI control.
Existing Projects can still omit this optional file.

## Acceptance criteria

- [ ] A successful CLI initialization creates `.rowbly/ROWBLY.md` with exactly `# ROWBLY INSTRUCTIONS\n` as its UTF-8 contents.
- [ ] A successful TUI initialization creates the same file with the same contents.
- [ ] Defaults and custom choices produce the file, including choices that install no skills.
- [ ] `get-instructions` returns `# ROWBLY INSTRUCTIONS` for the new Project through its current trim behavior.
- [ ] Initialization in an existing `.rowbly/` directory still fails with the current conflict error and changes no instructions.
- [ ] A Project without `ROWBLY.md` still returns an empty instructions string from `get-instructions`.
- [ ] A skill installation failure still removes the new `.rowbly/` directory, including `ROWBLY.md`.
- [ ] Tests cover the exact file contents, both entry points, conflict protection and the existing rollback behavior.
- [ ] Repository documentation states that initialization creates the file and that existing Projects can omit it.

## Technical notes

- Put file creation in `initProject` in `src/services/project/project.ts`.
- Use `projectPaths(root).instructionsFile` from `src/services/workspace/workspace.ts` and the existing file write helper.
- `applyOnboarding` in `src/services/onboarding/onboarding.ts` calls `initProject` for both front ends.
- The CLI entry point is `src/commands/init/init.ts`.
- The TUI entry point is `src/tui/screens/onboarding/OnboardingSummary/OnboardingSummary.tsx`.
- Keep the front ends thin. No TUI layout change is necessary.
- Relevant tests are in `src/services/project/project.test.ts` and `src/services/onboarding/onboarding.test.ts`.
- Also examine `src/commands/init/init.test.ts` and `src/tui/screens/onboarding/OnboardingSummary/OnboardingSummary.test.tsx`.
- The missing-file test must explicitly remove the file if its fixture starts to create it.
- Update the statement in `AGENTS.md` that Rowbly does not create `ROWBLY.md`.
- Preserve the current conflict check and onboarding rollback. Do not overwrite an existing Project.
- Specs are on, but ROW-04 has no linked Specs.
