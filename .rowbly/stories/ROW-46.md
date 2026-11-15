---
title: Deploy the website to GitHub Pages
stage: IN_REVIEW
position: 2
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-46
pull_request: https://github.com/sgolovine/rowbly/pull/242
---

## Goal

When `main` changes, deploy the Rowbly marketing website (`website/`) to GitHub Pages automatically. The site is served at the custom domain `https://rowbly.com`.

## Scope

In scope:

- Add `.github/workflows/website.yml` with these triggers:
  - `push` to `main` when `website/**` or `.github/workflows/website.yml` changes.
  - `pull_request` with the same `paths` filter. On a pull request, the workflow only builds. It does not deploy.
  - `workflow_dispatch`.
- A `build` job: checkout, `pnpm/action-setup@v4` with `version: 12`, `actions/setup-node@v6` with `node-version-file: .nvmrc`, `cache: pnpm` and `cache-dependency-path: website/pnpm-lock.yaml` (the same setup as `ci.yml`). Then `pnpm --dir website install --frozen-lockfile`, `pnpm --dir website build` and `pnpm --dir website typecheck`. Then check that `website/dist/client/` has `index.html`, `404.html`, `CNAME` and `.nojekyll`. On a push or a `workflow_dispatch` (not a pull request), upload `website/dist/client` with `actions/upload-pages-artifact`.
- A `deploy` job: `needs: build`. It runs only when the event is not `pull_request`. It uses `actions/deploy-pages` and `environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }`.
- Permissions: the workflow default is `contents: read`. The `deploy` job adds `pages: write` and `id-token: write`.
- Concurrency for deploys: group `pages`, `cancel-in-progress: false`, so that a deploy that is in progress is not cancelled.
- Add `website/public/.nojekyll` (empty file). Vite copies `public/` into the output.
- Add `website/public/CNAME` with the one line `rowbly.com`, so that each deploy keeps the custom domain.
- Add `CNAME` to `META_FILES` in `scripts/check-names.mjs`, because the root `pnpm lint` rejects the uppercase name. Add a case for `website/public/CNAME` to `scripts/check-names.test.mjs`.
- Add a branded 404 page that the build writes to `website/dist/client/404.html`. It shows the `rowbly_` wordmark, a short "Page not found" text and a link to `/`. Use the brand tokens and fonts of the scaffold (ROW-45). Also set the same component as `notFoundComponent` on the root route, so that the client router shows it for an unknown path too.
- `website/README.md`: add a "Deploy" section in STE. It tells how the workflow deploys, how to turn on GitHub Pages (Settings > Pages > Source: GitHub Actions), and how the custom domain `rowbly.com` is set up (the `CNAME` file, the DNS records and "Enforce HTTPS").
- Put the one-time steps of the owner (see "Technical notes") in the PR description.

Not in scope:

- Changes to `ci.yml` and `release.yml`. The website build check on pull requests is in `website.yml`.
- The pages of the site (ROW-47 to ROW-53), SEO, OG image and sitemap (ROW-54).
- The DNS and GitHub settings changes themselves. The repository owner does them.

## Acceptance criteria

- [ ] `.github/workflows/website.yml` exists, with the triggers, jobs, permissions and concurrency of "Scope". `ci.yml` and `release.yml` do not change.
- [ ] `pnpm --dir website install && pnpm --dir website build` makes `website/dist/client/` with `index.html`, `404.html`, `.nojekyll` and `CNAME`. The `CNAME` file has the text `rowbly.com`.
- [ ] `website/dist/client/404.html` has the `rowbly_` wordmark and a link with `href="/"`. Each asset URL in it starts with `/`.
- [ ] The build writes one HTML file for each prerendered route (for example `install/index.html` or `install.html` when the `/install` route exists), so that GitHub Pages serves a deep link directly.
- [ ] A pull request that changes `website/` runs the `build` job and does not run the `deploy` job. (A person examines this in the Actions tab.)
- [ ] After the merge and the owner steps, a push to `main` that changes `website/` builds and deploys the site. `https://rowbly.com/` shows the site over HTTPS with all CSS, fonts and images loaded (no 404 in the browser console). An unknown path, for example `https://rowbly.com/no-such-page`, shows the branded 404 page. (A person examines this.)
- [ ] `website/README.md` has the "Deploy" section of "Scope", in STE.
- [ ] `node --test scripts/` passes, with the new `CNAME` case.
- [ ] The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Depends on ROW-45 (scaffold). ROW-45 is in development and is not on `main` yet. If ROW-45 is not on `main` when development starts, merge the ROW-45 branch (`story/ROW-45`) into this branch first, and tell this in the pull request.
- The scaffold (ROW-45) uses TanStack Start with `prerender: { enabled: true, crawlLinks: true }` in `website/vite.config.ts`. The static output is `website/dist/client/`. The root route is `website/src/routes/__root.tsx`. The website has its own `pnpm-lock.yaml` and `pnpm-workspace.yaml` in `website/`.
- 404 page: prerender an extra page to `404.html` with the `pages` option of the TanStack Start `prerender` config, for example `pages: [{ path: "/404", prerender: { enabled: true, outputPath: "/404.html" } }]` with a route `website/src/routes/404.tsx` (check the current option names in the TanStack Start docs). If the plugin cannot write `404.html`, add a small `postbuild` script in `website/package.json` that copies the prerendered 404 page to `dist/client/404.html`.
- GitHub Pages with a deploy from Actions does not run Jekyll. `.nojekyll` is harmless and the Story asks for it.
- For a folder route (`install/index.html`), GitHub Pages redirects `/install` to `/install/` and serves the page. This agrees with "loads directly".
- Use the current major versions: `actions/upload-pages-artifact@v4` (or `@v3`) and `actions/deploy-pages@v4`, `actions/checkout@v6`.
- One-time steps of the repository owner (write them in the PR description and in `website/README.md`):
  1. Set Settings > Pages > Source to "GitHub Actions".
  2. Set the custom domain to `rowbly.com` and turn on "Enforce HTTPS".
  3. At the DNS provider of `rowbly.com`, add the GitHub Pages `A` records (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) and `AAAA` records (`2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`) for the apex domain, and a `CNAME` record from `www` to `sgolovine.github.io`.
  4. Optional: verify the domain in the GitHub account settings, to prevent domain takeover.

## Assumptions

- The website build check on pull requests is a `pull_request` trigger in `website.yml` with a `paths` filter, not a new job in `ci.yml`. Reason: it runs only when the website changes, so it is cheap, and `ci.yml` stays unchanged.
- `CNAME` is in `website/public/`, and `scripts/check-names.mjs` accepts the name `CNAME` as a meta file. Reason: the Story suggests `website/public/CNAME`, GitHub requires the uppercase name, and the root lint check rejects it without this change.
- The output folder is `website/dist/client/`. Reason: the ROW-45 scaffold uses TanStack Start without a Nitro preset, and its `vite.config.ts` comment names this folder.
- The 404 page is a prerendered TanStack route, not a hand-written HTML file. Reason: it then uses the same CSS, fonts and brand tokens as the site with no copy of the styles.
- The deep link criterion is tested with each route that exists at development time. Reason: `/install` comes from ROW-53, which can merge later.
