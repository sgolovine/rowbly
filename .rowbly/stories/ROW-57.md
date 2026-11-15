---
title: Link the website from the README and package metadata
stage: CHANGELOG
position: 2
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-57
pull_request: https://github.com/sgolovine/rowbly/pull/252
---

## Goal

Point users from the repository and the npm package to the new website `https://rowbly.com`. The user who reads the README on GitHub or the package page on npm can find the website.

## Scope

In scope:

- Add a link to `https://rowbly.com` near the top of `README.md`, below the badges block.
- Add the `homepage` key with the value `https://rowbly.com` to the root `package.json`.
- Add one `CHANGELOG.md` entry under `### Pre Release` only if the Changelog Stage does not add it (the factory `Changelog` Stage normally adds it; do not add a duplicate).

Not in scope:

- The GitHub repository website field (`gh repo edit --homepage https://rowbly.com`). This is a public change to the repository settings, and the author said to ask the owner first. A person must do this step manually.
- New `repository`, `bugs` or `keywords` keys in `package.json`.
- Changes to the `website/` folder.

## Acceptance criteria

- [ ] `README.md` has a link to `https://rowbly.com` above the `# Rowbly` heading or directly below it, after the badges block. Examine with `grep -n 'https://rowbly.com' README.md`.
- [ ] `node -p "require('./package.json').homepage"` prints `https://rowbly.com`.
- [ ] The README text that you add obeys ASD-STE100 STE (`docs/contributing/documentation-language.md`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass in the repository root.

## Technical notes

- `README.md` starts with a centred header image (`<p align="center">`) and a centred badges paragraph. Put the website link in the same HTML style, for example a new centred paragraph `<p align="center"><a href="https://rowbly.com"><strong>rowbly.com</strong></a></p>` below the badges, or a short STE sentence below `# Rowbly`, for example `Website: [rowbly.com](https://rowbly.com)`.
- `package.json` has no `homepage`, `repository` or `bugs` key now. Put `homepage` near `description`. Keep the 2-space JSON format, so that Biome passes.
- `website/public/CNAME` contains `rowbly.com`. The `website.yml` workflow deploys the site to GitHub Pages (ROW-46).
- No code in `src/` changes. No service test applies.

## Assumptions

- The GitHub repository website field is out of scope. Reason: a factory worker cannot ask the owner, and the author said to ask the owner before this public change. The smallest scope leaves it to a person.
- The work can start now, also if `https://rowbly.com` does not answer from the worker host. Reason: ROW-45 to ROW-54 are done and `website/public/CNAME` sets the domain; a request from the factory host failed with a TLS error (curl exit 35), which can be a network limit of the host. The link text does not depend on the state of the site.
- Only `homepage` is added to `package.json`. Reason: the Story asks only for `homepage`; other metadata keys are a larger scope.
