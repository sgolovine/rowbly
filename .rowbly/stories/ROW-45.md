---
title: Scaffold the website with TanStack Start, Tailwind and shadcn/ui
stage: CHANGELOG
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-45
pull_request: https://github.com/sgolovine/rowbly/pull/241
---

## Goal

Create the marketing website project for Rowbly in a new `website/` folder. Use TanStack Start with static prerendering, Tailwind CSS and shadcn/ui. Later Stories build the pages on this base.

## Scope

In scope:

- Create `website/` as a separate package with its own `package.json` and its own `pnpm-lock.yaml`. Do not add website dependencies to the root `package.json` or the root `pnpm-lock.yaml`.
- Use TanStack Start (React) with static prerendering. The build output must be plain static files for GitHub Pages.
- The site is served at the root of the custom domain `https://rowbly.com`. Use the base path `/`. Keep the site URL (`https://rowbly.com`) in one exported constant (for example `SITE_URL` in `website/src/lib/site.ts`) so that canonical URLs, the OG image URL and the sitemap of later Stories use it.
- Add Tailwind CSS v4 and initialize shadcn/ui (`components.json`, `src/components/ui/`). Add only `button`, `card`, `badge`, `tooltip`, `tabs` and `separator`.
- Add the brand tokens as Tailwind theme variables, dark theme only:
  - background `#111214`, surface `#17181B`, border `#26282D`
  - accent (amber) `#F5B841`
  - text `#ECEAE4`, muted text `#9A9CA3`
  - Story-key blue `#56B6E8` (sampled from `assets/screenshot.png`)
  - Map the shadcn/ui variables (`--background`, `--foreground`, `--card`, `--primary`, `--muted-foreground`, `--border`, and the other variables that the six components use) to these tokens. Use no other hues.
- Fonts: JetBrains Mono for the wordmark, code, keys and agent tags; Inter for body text and headings. Self-host the fonts (no Google Fonts or other CDN request at runtime).
- One placeholder route `/` that shows the `rowbly_` wordmark, so the build and deploy can be checked.
- Add root scripts `website:dev` and `website:build` that run the website package (for example `pnpm --dir website dev`).
- `website/README.md`: how to install, run, build, where the static output is, and how to add a shadcn component.

Not in scope:

- Deployment to GitHub Pages and the CI workflow (ROW-46).
- Layout, header, footer and shared components (ROW-47), and all page content (ROW-48 to ROW-53).
- SEO metadata, OG image and sitemap (ROW-54). This Story only adds the `SITE_URL` constant.
- Changes to the lint rules for route file names. ROW-58 does them.

## Repository rules

- The root `pnpm lint` runs Biome and `scripts/check-names.mjs` on the website too. Do not exclude `website/` from these checks. ROW-58 updates the lint rules to accept TanStack Router route names such as `__root.tsx` and `$param.tsx`; this Story depends on ROW-58.
- Set `generatedRouteTree` to the dash-case path `./src/route-tree.gen.ts`, as ROW-58 describes.
- All file names outside `website/src/routes/` are dash-case (for example the shadcn/ui files in `src/components/ui/`).
- Exclude `website/` from root Knip, Vitest and `tsc`.
- The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` must still pass, and must not build the website.

## Acceptance criteria

- [ ] `pnpm --dir website install && pnpm --dir website build` makes a static output folder with `index.html`. `website/README.md` names this folder.
- [ ] The root `pnpm-lock.yaml` and the root `package.json` `dependencies` and `devDependencies` do not change.
- [ ] Each asset URL in the built `index.html` starts with `/` (not `./` and not a sub-path), so the assets load at `https://rowbly.com`.
- [ ] The built `index.html` and CSS have no request to `fonts.googleapis.com`, `fonts.gstatic.com` or another font CDN. The font files are in the output folder.
- [ ] `pnpm website:dev` serves the placeholder page with the `rowbly_` wordmark in JetBrains Mono, the brand background and the brand text colour. (A person examines this.)
- [ ] `website/components.json` exists, and `website/src/components/ui/` has `button.tsx`, `card.tsx`, `badge.tsx`, `tooltip.tsx`, `tabs.tsx` and `separator.tsx`, and no other components.
- [ ] The website CSS defines the eight brand colours above as Tailwind theme variables.
- [ ] `website/src` exports one `SITE_URL` constant with the value `https://rowbly.com`.
- [ ] `pnpm --dir website typecheck` (a `tsc --noEmit` script in the website package) passes after a build.
- [ ] The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass, and none of them builds the website.
- [ ] `website/README.md` tells how to run, build and add a shadcn component, in STE.

## Technical notes

- Read the content plan Spec `website-content-plan` (section "7. Visual direction") for the palette, type and motion rules.
- This Story depends on ROW-58 and blocks all other website Stories (ROW-46 to ROW-57).
- Separate package: the root has a `pnpm-workspace.yaml` with no `packages` key. Add `website/pnpm-workspace.yaml` so that pnpm treats `website/` as its own workspace root with its own lockfile. Copy the `minimumReleaseAge: 10080` setting into it, and add `allowBuilds` entries for the packages that need a build script (for example `esbuild`). Do not add `website` to the root `pnpm-workspace.yaml`.
- Root exclusions that exist now: `tsconfig.json` has `include: ["src"]`, `vitest.config.ts` has `include: ["src/**/*.test.{ts,tsx}"]`, `knip.json` has `project: ["src/**/*.{ts,tsx}!", ...]`, and `tsup.config.ts` has only `src/` entries. Make sure these stay true. If `knip` reports website files or dependencies, add `website/**` to `ignore` (or `ignoreWorkspaces`) in `knip.json`.
- TanStack Start: use the Vite plugin (`@tanstack/react-start/plugin/vite`) with `prerender: { enabled: true, crawlLinks: true }` and `router: { generatedRouteTree: "./src/route-tree.gen.ts" }` (check the current option names in the TanStack Start docs). Without a Nitro preset the static output is `website/dist/client/`.
- Fonts: use `@fontsource-variable/jetbrains-mono` and `@fontsource-variable/inter` (or the static `@fontsource/*` packages). Vite bundles the font files into the output, so they are self-hosted.
- Tailwind v4: use `@tailwindcss/vite` and a CSS file with `@import "tailwindcss";` and `@theme`. Biome 2.6.5 checks CSS files. If Biome rejects the Tailwind directives (`@theme`, `@apply`, `@custom-variant`), set `css.parser.tailwindDirectives: true` in the root `biome.json`.
- Files that the tools generate: add `website/.gitignore` with `node_modules`, `dist`, `.output`, `.tanstack`, `.nitro`, `.vinxi` and `src/route-tree.gen.ts`. Root Biome uses the Git ignore files, and `check-names.mjs` uses `git ls-files --exclude-standard`, so they skip these files.
- Run `pnpm exec biome check --write website` after shadcn/ui adds files, so that the files use the repository format. If a Biome rule still fails on generated shadcn/ui code, fix the code, or add the smallest `overrides` entry for `website/src/components/ui/**` with a comment that tells why.
- The strict style skill (`.agents/skills/rowbly-code-style/`) and the Biome plugins apply to `src/**` of the CLI only. They do not apply to `website/`.

## Assumptions

- The Story-key blue is `#56B6E8`. Reason: it is the most frequent saturated blue pixel in `assets/screenshot.png` (5813 pixels; the next shade `#54B0E1` is an anti-aliased variant).
- The body font is Inter, not Geist. Reason: the Story allows both; Inter has a mature self-hosted `@fontsource` package and a smaller decision scope.
- The website has its own lockfile and its own `pnpm-workspace.yaml` in `website/`. Reason: the Story requires a separate package with no website dependencies in the root, and a root workspace entry would add website packages to the root lockfile.
- The generated route tree `src/route-tree.gen.ts` is not committed (Git ignores it). Reason: TanStack Start generates it on each `dev` and `build`, and a generated file does not agree with the Biome format. The website `typecheck` script therefore runs after a build or dev start; the README says so.
- If ROW-58 is not on `main` when development starts, merge the ROW-58 branch (PR #240) into this branch first, and tell this in the pull request. Reason: ROW-58 says "Do this Story before ROW-45, or in the same branch as its first commit", and the root `pnpm lint` fails on `__root.tsx` without it.
- The `SITE_URL` constant is in `website/src/lib/site.ts`. Reason: the Story asks for one constant but gives no path; `src/lib/` is the shadcn/ui convention (`lib/utils.ts`).
