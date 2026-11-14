---
title: Build the closing landing sections and the install call to action
stage: BACKLOG
position: 9
worktree: null
pull_request: null
---

## Goal

Build the closing sections of the landing page: Bring your own models, The board is just files in your repo, Humans and scripts, Specs and attachments, and the final install call to action.

## Scope

### Bring your own models
- Headline: **Your models. Your limits. Your keys.**
- Copy: "Sign in to Anthropic, OpenAI, Google Gemini and more. Pick one model to supervise and another to do the work. Set how many workers run at once. Change your mind any time."
- Visual: provider names (plain wordmarks, not logos, until the owner approves logos) and a static settings mock with three rows: Supervisor model, Worker model, Worker limit.

### The board is just files in your repo
- Headline: **The board is just files in your repo.**
- Copy: "Your Stories, Stages and Specs are Markdown and JSON in a `.rowbly/` folder. Commit them. Diff them. Branch them. Clone the repo and the board comes with it. No account, no sync, no vendor between you and your work."
- Visual: a short file tree (`.rowbly/` with `stories/`, `stages/`, `specs/`) next to a Story card. Do not show real schemas.

### A terminal UI and a CLI
- Headline: **A terminal UI when you want to look. A CLI when you want to script.**
- Copy: "Open `rowbly` and work the board with your keyboard. Or drive it from the command line: `rowbly story create`, `rowbly factory status`. Your own scripts and agents can use the same commands."
- Visual: `Tabs` with "TUI" (screenshot) and "CLI" (the two commands with real output).

### Specs and attachments (small)
- Headline: **Context that travels with the Story.**
- Copy: "Link a Markdown Spec to a Story so agents build what you meant. Paste a screenshot straight onto a Story. Everything stays next to the code."

### Final call to action
- Anchor: `#install`.
- Headline: **Start your factory in two minutes.**
- A terminal block: `npm install -g rowbly`, `cd your-repo`, `rowbly`, with the blinking `rowbly_` cursor at the end.
- Copy: "Onboarding sets up your Stages and prompts. Sign in to a provider, press `f` then `s`, and watch the board move."
- The honest line: "Free and open source under MIT. Needs Node 22 or later. The factory runs on Linux today."
- Buttons: **Get started** (to `/install`) and **View on GitHub**.

## Acceptance criteria

- [ ] All five sections are on `/` in this order, after "Watch everything live".
- [ ] The CLI output in the CLI tab comes from a real run of the current `rowbly` version.
- [ ] The Linux note is visible in the final call to action, not in small print.
- [ ] The copy matches the Spec `website-content-plan`, sections 3.6 to 3.10.

## Technical notes

Depends on the layout Story.
