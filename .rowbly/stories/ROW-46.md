---
title: Deploy the website to GitHub Pages
stage: IN_REFINEMENT
position: 5
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
- Add a `CNAME` file with the text `rowbly.com` to the output (for example from `website/public/CNAME`), so that each deploy keeps the custom domain.
- Add a `404.html` that GitHub Pages can serve for unknown paths. It shows the brand and a link back to the home page.
- Keep the existing `ci.yml` and `release.yml` unchanged, except to add a website build check to CI on pull requests if it is cheap.

## Acceptance criteria

- [ ] A push to `main` that changes `website/` builds and deploys the site.
- [ ] `https://rowbly.com/` shows the site over HTTPS, with all CSS, fonts and images loaded (no 404 in the browser console).
- [ ] A deep link such as `https://rowbly.com/install` loads directly (after that page exists).
- [ ] An unknown path shows the branded 404 page.
- [ ] `website/README.md` tells how to turn on GitHub Pages (Settings > Pages > Source: GitHub Actions) and how the custom domain `rowbly.com` is set up (the `CNAME` file, the DNS records and "Enforce HTTPS").

## Technical notes

Depends on the scaffold Story. The repository owner must do these steps one time; write them in the PR description:

1. Set Settings > Pages > Source to "GitHub Actions".
2. Set the custom domain to `rowbly.com` and turn on "Enforce HTTPS".
3. At the DNS provider of `rowbly.com`, add the GitHub Pages `A` and `AAAA` records for the apex domain, and a `CNAME` record from `www` to `sgolovine.github.io`.
4. Optional: verify the domain in the GitHub account settings, to prevent domain takeover.
