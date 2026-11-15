---
title: Scaffold the website with TanStack Start, Tailwind and shadcn/ui
stage: IN_REFINEMENT
position: 4
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-45
pull_request: null
---

## Goal

Create the marketing website project for Rowbly in a new `website/` folder. Use TanStack Start with static prerendering, Tailwind CSS and shadcn/ui. Later Stories build the pages on this base.

## Scope

- Create `website/` as a separate package with its own `package.json`. Do not add website dependencies to the root `package.json`.
- Use TanStack Start in static (prerender / SPA) mode. The build output must be plain static files for GitHub Pages.
- The site is served at the root of the custom domain `https://rowbly.com`. Use the base path `/`. Keep the site URL (`https://rowbly.com`) in one constant so that canonical URLs, the OG image URL and the sitemap use it.
- Add Tailwind CSS (v4) and initialize shadcn/ui (`components.json`, `src/components/ui/`). Add only `button`, `card`, `badge`, `tooltip`, `tabs`, `separator` for now.
- Add the brand tokens as Tailwind theme variables, dark theme only:
  - background `#111214`, surface `#17181B`, border `#26282D`
  - accent (amber) `#F5B841`
  - text `#ECEAE4`, muted text `#9A9CA3`
  - Story-key blue, sampled from `assets/screenshot.png`
- Fonts: JetBrains Mono for the wordmark, code, keys and agent tags; Inter or Geist for body text and headings. Self-host the fonts (no Google Fonts request at runtime).
- One placeholder route `/` that shows the `rowbly_` wordmark, so the build and deploy can be checked.
- Add root scripts `website:dev` and `website:build` that run the website package.

## Repository rules

- The root `pnpm lint` runs Biome and `scripts/check-names.mjs` on the website too. Do not exclude `website/` from these checks. ROW-58 updates the lint rules to accept TanStack Router route names such as `__root.tsx` and `$param.tsx`; this Story depends on ROW-58.
- Set `generatedRouteTree` to a dash-case path such as `./src/route-tree.gen.ts`, as ROW-58 describes.
- All file names outside `website/src/routes/` are dash-case (for example the shadcn/ui files in `src/components/ui/`).
- Exclude `website/` from root Knip, Vitest and `tsc`.
- The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` must still pass, and must not build the website.

## Acceptance criteria

- [ ] `pnpm --dir website install && pnpm --dir website build` makes a static output folder with `index.html`.
- [ ] Assets in the output load from the site root (`/`), so they work at `https://rowbly.com`.
- [ ] `pnpm website:dev` serves the placeholder page with the brand colours and fonts.
- [ ] shadcn/ui is initialized and the six components exist.
- [ ] The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] `website/README.md` tells how to run, build and add a shadcn component.

## Technical notes

Read the content plan Spec `website-content-plan` (Visual direction section) for the palette, type and motion rules.
This Story depends on ROW-58 and blocks all other website Stories.
