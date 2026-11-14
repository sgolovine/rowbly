---
title: Scaffold the website with TanStack Start, Tailwind and shadcn/ui
stage: BACKLOG
worktree: null
pull_request: null
---

## Goal

Create the marketing website project for Rowbly in a new `website/` folder. Use TanStack Start with static prerendering, Tailwind CSS and shadcn/ui. Later Stories build the pages on this base.

## Scope

- Create `website/` as a separate package with its own `package.json`. Do not add website dependencies to the root `package.json`.
- Use TanStack Start in static (prerender / SPA) mode. The build output must be plain static files for GitHub Pages.
- Set the router base path to `/rowbly/` (the GitHub Pages project URL `https://sgolovine.github.io/rowbly/`). Keep the base path in one constant or env value so a custom domain needs only one change.
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

- The root `pnpm lint` runs Biome over `**` and `scripts/check-names.mjs` checks dash-case names. TanStack Start uses names such as `__root.tsx` and `$param.tsx`. Make the root checks pass: exclude `website/` from the root Biome config and add `^website\/` to `IGNORED_PATHS` in `scripts/check-names.mjs`, or keep all names dash-case. Give the website its own lint script.
- Exclude `website/` from root Knip, Vitest and `tsc`.
- The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` must still pass, and must not build the website.

## Acceptance criteria

- [ ] `pnpm --dir website install && pnpm --dir website build` makes a static output folder with `index.html`.
- [ ] Assets in the output use the `/rowbly/` base path.
- [ ] `pnpm website:dev` serves the placeholder page with the brand colours and fonts.
- [ ] shadcn/ui is initialized and the six components exist.
- [ ] The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] `website/README.md` tells how to run, build and add a shadcn component.

## Technical notes

Read the content plan Spec `website-content-plan` (Visual direction section) for the palette, type and motion rules.
This Story blocks all other website Stories.
