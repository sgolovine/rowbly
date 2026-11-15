---
title: Build the Install page
stage: IN_REFINEMENT
position: 12
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-53
pull_request: null
---

## Goal

Build the `/install` page: requirements, the first commands and the first factory run, in a short and honest form. Link to the README for all other detail.

## Scope

1. **Requirements:** Node 22 or later. The factory runs on Linux today. The board and the CLI work without a provider sign-in. Key line: "You can use the board on any platform. The factory itself runs on Linux today."
2. **Install:** `npm install -g rowbly`, or `npx rowbly` without a global install. Use `InstallCommand`.
3. **First run:** run `rowbly` in a repository. Onboarding asks for a project name, Stages and prompts; the defaults are fine.
4. **Sign in to a provider:** `rowbly auth login`. Pick a supervisor model, a worker model and a worker limit in Settings > AI, or with `rowbly factory configure`.
5. **Start the factory:** press `f` then `s`, or run `rowbly factory start`.
6. **Costs:** "Rowbly is free. Your model provider bills you for the models you use."
7. **Keys:** "Your keys stay on your machine. Rowbly sends them only to the provider you signed in to." Check this claim against the auth docs before you publish it.
8. A link: "Read the full docs on GitHub" to the README.

Each step is a numbered card with a copyable command.

## Acceptance criteria

- [ ] The page is at `https://rowbly.com/install` and loads directly from a deep link.
- [ ] Every command on the page runs on the current `rowbly` version (check with `rowbly --help` and each subcommand `--help`).
- [ ] The Linux requirement is in the first section.
- [ ] Each command has a copy button.
- [ ] The copy matches the Spec `website-content-plan`, section 5.

## Technical notes

Depends on the layout Story. Commands are in `README.md` and `docs/architecture/cli.md`.
