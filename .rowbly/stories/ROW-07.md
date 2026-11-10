---
title: PR title must include the ticket number
stage: DONE
position: 3
worktree: /home/sgolovine/.t3/worktrees/rowbly/row-07-in_development
pull_request: https://github.com/sgolovine/rowbly/pull/183
---

## Goal

Every pull request that an agent opens for a Rowbly Story has the Story key and number in its title.
The title lets a reader identify the Story without access to the pull request body.

PR https://github.com/sgolovine/rowbly/pull/180 shows the problem: its title does not include the Story ID.
The author gave `ROW-5: Made some change...` as an example.

## Scope

Update the pull request instructions in the bundled `develop` skill and its tracked copies in this repository.
Use the format `<Story ID>: <summary>` for each new pull request that an agent opens for a Story.
Use the ID that `get-story` returns, including its Project key and number.

This Story does not change runtime code, commit title rules, Stage prompts or Project config.
This Story does not add GitHub Actions enforcement or rename past pull requests.

## Acceptance criteria

- [ ] `skills/develop/SKILL.md` tells agents to set the title to `<Story ID>: <summary>` when they open a Story pull request.
- [ ] The title uses the full ID from `get-story`, followed by a colon, a space and a short summary.
- [ ] The instructions include an example, such as `ROW-07: Include Story IDs in pull request titles`.
- [ ] The instructions use the current Story ID rather than a fixed Project key or number.
- [ ] `.agents/skills/develop/SKILL.md` and `.claude/skills/develop/SKILL.md` contain the same title rule and example.
- [ ] The existing pull request body format and immediate `pull_request` field update remain in the instructions.
- [ ] Repository lint, typecheck, tests and build pass, or the developer reports each unrelated failure with evidence.

## Technical notes

- `skills/develop/SKILL.md` has a `## Pull request` section. It defines the body format but has no title rule.
- `.agents/skills/develop/SKILL.md` and `.claude/skills/develop/SKILL.md` are separate tracked copies.
- `src/services/skill/skill.ts` copies bundled skills into the selected harness folders. No service change is necessary.
- `stages/IN_DEVELOPMENT.md` opens the pull request after the develop result. The skill already defines its format.
- Keep the title rule in the skill. Do not change any Stage prompt or Project config.
- Commit titles retain the Conventional Commits format from `AGENTS.md`.
- Write the new instructions in ASD-STE100 Simplified Technical English.
- Check the three skill files for the same rule and example. No runtime test is necessary for this instruction change.
- Specs are on, but ROW-07 has no linked Specs.
