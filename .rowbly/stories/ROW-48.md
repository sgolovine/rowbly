---
title: Build the landing page Hero and proof strip
stage: IN_REFINEMENT
position: 7
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-48
pull_request: null
---

## Goal

Build the first two sections of the landing page: the Hero and the proof strip. A visitor must understand what Rowbly is and how much it can do in the first screen.

## Scope

### Hero
- Headline: **Your backlog, built by a factory of agents.**
- Subhead: "Rowbly is a software factory manager that lives in your terminal. Put Stories on a board. Tell each Stage what to do. Start the factory, and a team of AI agents refines, builds, opens PRs and reviews, all at once, while you watch."
- CTAs: `InstallCommand` for `npm install -g rowbly`; buttons **Get started** (scrolls to the install section) and **See it work** (scrolls to the board animation); text link **Star on GitHub**.
- Trust row: "Free. Open source. MIT. Bring your own models."
- Visual: `assets/screenshot.png`, cropped to the board, in `TerminalFrame` with the amber glow. On load, the agent tags fade in one after the other (about 1.5 s total). No motion with `prefers-reduced-motion`.

### Proof strip
- Headline: **One board. Twenty-six agents. All at the same time.**
- Copy: "This is a real Rowbly board. Eight Stories being refined, ten being built, eight under review, each one with its own agent and its own branch. Nobody is waiting on anybody."
- Four stat cards: **8** In Refinement, **10** In Development, **8** In Review, **3** model providers on one board (Claude, Codex, Gemini). Numbers count up when they scroll into view (reduced motion: show the final numbers).
- Below the cards: the screenshot with amber rings around some agent tags.
- Label the screenshot as "a real Rowbly board" and do not say it is a typical result.

## Acceptance criteria

- [ ] The headline, subhead and install command are visible without scrolling at 1280x800 and at 390x844.
- [ ] Alt text of the screenshot names the project and the number of agents at work.
- [ ] Both buttons scroll to their sections (use anchors that later Stories create: `#install`, `#see-it-work`).
- [ ] Animations stop with `prefers-reduced-motion: reduce`.
- [ ] The copy matches the Spec `website-content-plan`, sections 3.1 and 3.2.

## Technical notes

Depends on the layout Story. Do not use video. Use CSS or a small amount of React state for the animations.
