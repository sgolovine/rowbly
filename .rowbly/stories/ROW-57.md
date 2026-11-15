---
title: Link the website from the README and package metadata
stage: IN_REFINEMENT
position: 16
worktree: null
pull_request: null
---

## Goal

Point users from the repository and the npm package to the new website.

## Scope

- Add a link to `https://rowbly.com` near the top of `README.md` (under the badges).
- Set `homepage` in the root `package.json` to `https://rowbly.com`.
- Set the GitHub repository website field to `https://rowbly.com` (`gh repo edit --homepage https://rowbly.com`). Ask the owner before this step; it is a public change.

## Acceptance criteria

- [ ] The README shows the website link.
- [ ] `package.json` `homepage` is `https://rowbly.com`.
- [ ] The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Do this Story after the site is live on GitHub Pages. Write README text in STE (see `docs/contributing/documentation-language.md`).
