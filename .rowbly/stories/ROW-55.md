---
title: Capture real TUI screenshots for the website
stage: BACKLOG
worktree: null
pull_request: null
---

## Goal

Capture real, current screenshots of the Rowbly TUI for the website, so that the website mocks match the product.

## Scope

Use the `rowbly-screenshots` skill (`.agents/skills/rowbly-screenshots/SKILL.md`) with a demo Project, not the Rowbly repository's own `.rowbly/`.

Capture these views at a wide terminal size:

1. The board with many Stories in working Stages and agent tags (a new version of `assets/screenshot.png` with the current version number).
2. The Threads view with a conversation open.
3. Factory controls with the supervisor model, worker counts and an Attention item.
4. Settings > AI > Models (supervisor model, worker model) and Limits.
5. An open Story with its General tab and a Spec.

Put the images in `website/public/screenshots/` with dash-case names. Write alt text for each image in `website/public/screenshots/README.md`.

## Acceptance criteria

- [ ] Five PNG images exist, crisp at 2x, with no private data (no real keys, emails or private repository names).
- [ ] The images show the current version of Rowbly.
- [ ] Each image has alt text.

## Technical notes

The memory note for this repository says agentic-tui PNG output can misalign; if it does, render the `.txt` capture with headless Chrome. Do not run a real factory with live credentials for these screenshots; use a demo Project with fake activity if possible.
This Story does not depend on the scaffold Story, but the image folder is in `website/`; create the folder if it does not exist.
