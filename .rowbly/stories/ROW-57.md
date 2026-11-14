---
title: Link the website from the README and package metadata
stage: BACKLOG
worktree: null
pull_request: null
---

## Goal

Point users from the repository and the npm package to the new website.

## Scope

- Add a website link near the top of `README.md` (under the badges).
- Set `homepage` in the root `package.json` to the website URL.
- Set the GitHub repository website field to the site URL (`gh repo edit --homepage`). Ask the owner before this step; it is a public change.

## Acceptance criteria

- [ ] The README shows the website link.
- [ ] `package.json` `homepage` is the website URL.
- [ ] The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Do this Story after the site is live on GitHub Pages. Write README text in STE (see `docs/contributing/documentation-language.md`).
