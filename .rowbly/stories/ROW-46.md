---
title: Deploy the website to GitHub Pages
stage: BACKLOG
worktree: null
pull_request: null
---

## Goal

Deploy the website to GitHub Pages automatically when `main` changes.

## Scope

- Add `.github/workflows/website.yml`. Trigger on push to `main` when `website/**` or the workflow file changes, and on `workflow_dispatch`.
- Build `website/` with pnpm (use the same pnpm and Node setup as `ci.yml`).
- Deploy with `actions/upload-pages-artifact` and `actions/deploy-pages`. Set `permissions: pages: write, id-token: write` and a `github-pages` environment.
- Add `.nojekyll` to the output.
- Add a `404.html` that GitHub Pages can serve for unknown paths. It shows the brand and a link back to the home page.
- Keep the existing `ci.yml` and `release.yml` unchanged, except to add a website build check to CI on pull requests if it is cheap.

## Acceptance criteria

- [ ] A push to `main` that changes `website/` builds and deploys the site.
- [ ] `https://sgolovine.github.io/rowbly/` shows the site, with all CSS, fonts and images loaded (no 404 in the browser console).
- [ ] A deep link such as `/rowbly/install` loads directly (after that page exists).
- [ ] An unknown path shows the branded 404 page.
- [ ] `website/README.md` tells how to turn on GitHub Pages (Settings > Pages > Source: GitHub Actions) and how to add a custom domain later.

## Technical notes

Depends on the scaffold Story. The repository owner must set Pages source to "GitHub Actions" one time; write this in the PR description.
