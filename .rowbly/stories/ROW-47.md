---
title: Build the website layout, header, footer and shared components
stage: IN_REFINEMENT
position: 6
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-47
pull_request: null
---

## Goal

Build the shared layout and the shared components that all pages use.

## Scope

- **Header:** the `>_` logo and the `rowbly_` wordmark with a blinking amber underscore (CSS animation, stops with `prefers-reduced-motion`). Nav links: How it works, Install, GitHub (with star icon). A mobile menu for small screens.
- **Footer:** links to GitHub, npm, the README (docs), and the MIT License. The line "Free and open source under MIT."
- **Favicon and icons:** make 16, 32, 180 and 512 px icons from `assets/icon.png`. Add the web manifest.
- **Shared components** in `website/src/components/`:
  - `TerminalFrame`: a terminal window frame (title bar with the text `rowbly`) that wraps an image or children. Soft amber glow option.
  - `InstallCommand`: a copy block for `npm install -g rowbly` with a copy button and a "Copied" tooltip.
  - `Kbd`: a keycap for keys such as `f` and `s`.
  - `Section`: a page section with an eyebrow, a headline, a subhead and content, so all sections share spacing.
  - `AgentTag`: a mono tag such as `claude-19` with the amber dot and Stage label, matching the TUI screenshot.
- Copy `assets/screenshot.png`, `assets/header.png` and `assets/icon.png` into the website's public assets (or import them from `assets/` in the build).

## Acceptance criteria

- [ ] Header and footer show on every route and work from 360 px to 1440 px wide.
- [ ] The mobile menu opens and closes with the keyboard and with a tap.
- [ ] `InstallCommand` copies the exact text and shows "Copied".
- [ ] The favicon shows in the browser tab.
- [ ] All colours come from the theme tokens of the scaffold Story.

## Technical notes

Depends on the scaffold Story. See the Visual direction and Voice sections of the Spec `website-content-plan`.
