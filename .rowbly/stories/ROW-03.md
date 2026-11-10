---
title: Manage skills via TUI
stage: IN_DEVELOPMENT
position: 4
worktree: null
pull_request: null
---

## Goal

Users can manage the default Rowbly skills from the TUI. Add a Skills section to Settings with install and uninstall controls.

## Scope

Manage bundled skills for the current Project and its supported harnesses. Show installed skills that the Project tracks, including missing copies.

Use the same service rules as `install-skill`, `list-skills` and `remove-skill`. Custom skill sources, skill text editors and skill upgrades are outside this Story.

Do not change onboarding, Stage prompts or the rules for custom fields. Do not add automatic skill installation when a Stage changes.

## Acceptance criteria

- [ ] Settings has a Skills section in the Project group. The keyboard and mouse can open it.
- [ ] The section lists all bundled skills and all skills that the Project tracks, without duplicate names.
- [ ] Each tracked skill shows its harnesses, paths and installed or missing state. An untracked bundled skill shows as not installed.
- [ ] An empty list shows a clear message. Data loads and failures use the standard TUI states and error messages.
- [ ] An install action lets the user choose one bundled skill and one or more supported harnesses.
- [ ] The harness choices are `claude-code`, `codex`, `gemini-cli`, `github-copilot` and `cursor`.
- [ ] The install form rejects an empty harness selection. Cancel closes the form without a write.
- [ ] Install calls `installSkill` for the selected harnesses. It can add harnesses or restore a missing tracked copy.
- [ ] Install preserves a present tracked copy and its local changes. A conflicting path shows the service error and hint.
- [ ] An uninstall action lets the user choose one or more tracked harnesses for the selected skill, including all tracked harnesses.
- [ ] Before uninstall, a ConfirmDialog names the skill, harnesses and paths. It warns that removal deletes local changes in removed folders.
- [ ] Cancel or Escape from the confirmation changes no files. Confirm calls `removeSkill` for only the selected harnesses.
- [ ] The result distinguishes a removed folder, an already missing folder and a shared folder that the service keeps.
- [ ] The section explains that another harness can still read a retained or shared skill folder after removal.
- [ ] Skills that are no longer bundled remain visible and removable when tracked. Install is unavailable for those skills.
- [ ] Each successful operation refreshes the list and calls Settings `onChange`. A failure shows the error and keeps Settings usable.
- [ ] An operation in progress prevents duplicate submissions. Each action has a visible key and a mouse control.
- [ ] Component tests cover list states, harness selection, install, removal confirmation, cancellation, errors and refresh.
- [ ] A real-terminal check through agentic-tui verifies the section and its forms at normal and small terminal sizes.

## Technical notes

`src/services/skill/skill.ts` supplies `bundledSkills`, `listSkills`, `installSkill`, `removeSkill` and `HARNESS_SKILL_DIRS`.
`src/services/config/config.ts` supplies `SKILL_HARNESSES`. Use the supplied service context for each call.

Register the section in `src/tui/screens/settings/settingsSections.ts`. Follow `SettingsSectionProps` and the existing section patterns.
Use shared Form, SelectList, ConfirmDialog and list components as appropriate. Follow the TUI design skill for focus, keys and layout.

Keep all file operations and config writes in the services. Do not copy the onboarding rules into Settings.
The existing install service does not add custom fields or enforce skill dependencies from Stage prompts.
Removal follows the existing service rules for tracked folders and symlinks.

`src/services/skill/skill.test.ts` covers conflicts, missing copies and shared paths. Reuse these rules in TUI tests.
Use temporary Projects for tests. Do not install or remove skills in the repository Project for verification.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` before completion.
