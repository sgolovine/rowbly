---
title: Build the website layout, header, footer and shared components
stage: IN_REVIEW
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-47
pull_request: https://github.com/sgolovine/rowbly/pull/243
---

## Goal

Build the shared layout and the shared components that all pages of the Rowbly website use. Later page Stories (ROW-48 to ROW-53) build on them. The result: each route has the same header, footer, favicon and visual style, and page Stories use one set of components.

## Scope

In scope:

- **Header** (`website/src/components/site-header.tsx`): the `>_` logo and the `rowbly_` wordmark in JetBrains Mono, with a blinking amber underscore (CSS animation; no blink with `prefers-reduced-motion: reduce`). The logo and wordmark link to `/`. Nav links: **How it works** (`/how-it-works`), **Install** (`/install`), **GitHub** (`https://github.com/sgolovine/rowbly`, with a star icon from `lucide-react`). A mobile menu for small screens.
- **Footer** (`website/src/components/site-footer.tsx`): links to GitHub (`https://github.com/sgolovine/rowbly`), npm (`https://www.npmjs.com/package/rowbly`), the README as docs (`https://github.com/sgolovine/rowbly#readme`) and the MIT License (`https://github.com/sgolovine/rowbly/blob/main/LICENSE.md`). The line "Free and open source under MIT."
- **Root layout:** `website/src/routes/__root.tsx` renders the header, then the route content in `<main>`, then the footer, on each route.
- **Placeholder routes** `website/src/routes/how-it-works.tsx` and `website/src/routes/install.tsx`, so that the nav links do not go to a missing page. Each shows one `Section` with the page name and one short line that links to the README. ROW-52 and ROW-53 replace their content.
- **Favicon and icons:** make 16, 32, 180 and 512 px PNG icons from `assets/icon.png` (400x400) and commit them in `website/public/`: `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (180), `icon-512.png`. Add `website/public/site.webmanifest` (name `Rowbly`, short name `Rowbly`, the 512 px icon, `background_color` and `theme_color` `#111214`, `display: "standalone"`). Add the icon links and the manifest link to the `head` of the root route.
- **Shared components** in `website/src/components/` (dash-case file names, PascalCase exports):
  - `TerminalFrame` (`terminal-frame.tsx`): a terminal window frame with a title bar with the text `rowbly`. It wraps an image or children. A `glow` prop adds a soft amber glow.
  - `InstallCommand` (`install-command.tsx`): a copy block that shows a command with a `$` prompt and a copy button. The `command` prop has the default `npm install -g rowbly`, so that ROW-53 can use it for other commands. A click on the button copies the exact command text with `navigator.clipboard.writeText` and shows a "Copied" tooltip for about 2 s.
  - `Kbd` (`kbd.tsx`): a keycap for keys such as `f` and `s`.
  - `Section` (`section.tsx`): a page section with an optional `id`, an eyebrow, a headline, a subhead and children, so that all sections have the same spacing and max width.
  - `AgentTag` (`agent-tag.tsx`): a mono tag as in `assets/screenshot.png`: `▸ claude-19` in muted text, then an amber dot `•` and the Stage label (for example `In Refinement`) in amber. Props: `agent` and `stage`.
- Copy `assets/screenshot.png`, `assets/header.png` and `assets/icon.png` into `website/public/images/` with the same names.

Not in scope:

- Page content of the landing page, `/how-it-works` and `/install` (ROW-48 to ROW-53).
- SEO metadata, Open Graph tags, the OG image and the sitemap (ROW-54).
- The 404 page, the GitHub Pages deploy, `CNAME` and `.nojekyll` (ROW-46).
- New TUI screenshots (ROW-55).
- A live GitHub star count. The site is static and makes no API request.

## Acceptance criteria

- [ ] `pnpm --dir website install && pnpm --dir website build` passes and writes `index.html`, and an HTML file for `/how-it-works` and `/install`, to `website/dist/client/`.
- [ ] Each of these HTML files has the header (the `rowbly_` wordmark and links with `href="/how-it-works"`, `href="/install"` and `href="https://github.com/sgolovine/rowbly"`) and the footer (the four footer links and the text "Free and open source under MIT.").
- [ ] `website/dist/client/` has `favicon-16x16.png` (16x16), `favicon-32x32.png` (32x32), `apple-touch-icon.png` (180x180), `icon-512.png` (512x512) and `site.webmanifest`. `file` shows the sizes. The built `index.html` has `<link rel="icon">` tags for the 16 and 32 px icons, `<link rel="apple-touch-icon">` and `<link rel="manifest">`, each with a URL that starts with `/`.
- [ ] `website/public/images/` has `screenshot.png`, `header.png` and `icon.png`.
- [ ] `website/src/components/` has `terminal-frame.tsx`, `install-command.tsx`, `kbd.tsx`, `section.tsx` and `agent-tag.tsx`, with the exports `TerminalFrame`, `InstallCommand`, `Kbd`, `Section` and `AgentTag`.
- [ ] No file in `website/src/` other than `website/src/styles/app.css` has a hex, `rgb(` or `hsl(` colour, or a Tailwind default palette colour class (for example `text-gray-500` or `bg-zinc-900`). A `grep` examines this. All colours come from the theme tokens of ROW-45.
- [ ] The underscore blink animation is in a `@media (prefers-reduced-motion: no-preference)` block or uses the Tailwind `motion-safe:` variant.
- [ ] `pnpm --dir website typecheck` passes after a build.
- [ ] The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] (A person examines this.) In `pnpm website:dev`, the header and the footer show on `/`, `/how-it-works` and `/install`, with no horizontal scroll from 360 px to 1440 px wide. Below 768 px the nav links are in the mobile menu.
- [ ] (A person examines this.) The mobile menu button has `aria-expanded` and `aria-controls`. Tab and Enter or Space open and close the menu, Escape closes it and moves focus back to the button, and a tap opens and closes it. A click on a menu link closes the menu.
- [ ] (A person examines this.) A click on the `InstallCommand` copy button puts the exact text `npm install -g rowbly` on the clipboard and shows "Copied". The status is also in an `aria-live="polite"` region.
- [ ] (A person examines this.) The favicon shows in the browser tab.

## Technical notes

- ROW-45 (scaffold) is merged on `origin/main` (PR #241). The worktree of this Story was made from an older commit with no `website/` folder. Start the branch from the current `origin/main` (or merge `origin/main` into it) before the work.
- Scaffold facts: TanStack Start with `prerender: { enabled: true, crawlLinks: true }` in `website/vite.config.ts`; the output is `website/dist/client/`; the root route is `website/src/routes/__root.tsx`; the CSS and the tokens are in `website/src/styles/app.css`; the `@/` alias points to `website/src/`; shadcn/ui components (`button`, `card`, `badge`, `tooltip`, `tabs`, `separator`) are in `website/src/components/ui/`.
- Theme tokens (Tailwind classes): `bg-brand-background`, `bg-brand-surface`, `border-brand-border`, `text-brand-accent`, `text-brand-text`, `text-brand-muted`, `text-brand-story-key`, and the shadcn/ui mapped classes (`bg-background`, `text-foreground`, `bg-card`, `text-primary`, `text-muted-foreground`, `border-border`). For the amber glow, use a shadow with the accent token, for example `shadow-[0_0_60px_-15px_var(--color-brand-accent)]`, or a `color-mix()` of the token in `app.css`. Add new keyframes or utilities to `app.css` only.
- `crawlLinks` prerenders each internal link. The placeholder routes make sure that the links to `/how-it-works` and `/install` do not fail the build or go to a missing page.
- Use the shadcn/ui `tooltip` for "Copied", or a small positioned label. Use `Button` from `@/components/ui/button` for the copy button and the menu button. `lucide-react` 1.x has no brand icons; use `Star` (and `Menu`, `X`, `Copy`, `Check`).
- Make the icons one time with ImageMagick or `sharp` (for example `magick assets/icon.png -resize 32x32 website/public/favicon-32x32.png`) and commit the PNG files. Do not add an image tool to the website dependencies or the build. The 512 px icon is an upscale of the 400 px source; use a high-quality filter (for example `-filter Lanczos`).
- ROW-46 also changes `website/src/routes/__root.tsx` (`notFoundComponent`) and adds files to `website/public/`. Keep the changes to `__root.tsx` small, so that a merge is easy.
- File names: `scripts/check-names.mjs` checks all tracked files. All new names above are dash-case. `site.webmanifest` and `apple-touch-icon.png` pass.
- The strict code-style skill applies only to `src/` of the CLI, not to `website/`. Biome applies to `website/`. Do not write tests for the website components (the website has no test runner).
- Voice: see sections 6 and 7 of the Spec `website-content-plan`. Amber means "live"; use it sparingly (the cursor, the agent tag, the glow).
- Update `website/README.md` with a short STE section that lists the shared components and where the icons come from.
- Add a `CHANGELOG.md` entry if the repository rules for a feature require it.

## Assumptions

- The header links go to the pages `/how-it-works` and `/install`, not to anchors on `/`. Reason: the sitemap of the Spec `website-content-plan` has these two pages.
- This Story adds placeholder routes for `/how-it-works` and `/install`. Reason: `crawlLinks` prerender follows each nav link, and a link to a missing route can fail the build or show a broken page. ROW-52 and ROW-53 replace the content. This is the smallest change that keeps the nav links valid.
- The `>_` logo is text in JetBrains Mono with the accent colour, not the image `icon.png`. Reason: the Story names the `>_` logo next to the wordmark, and text needs no image request and scales with the font.
- The GitHub link has a star icon and no star count. Reason: the site is static, and a live count needs a runtime API request.
- The icons and the brand images are committed static files in `website/public/`, not made or imported at build time. Reason: the Story allows the copy, and it adds no build dependency.
- The 512 px icon is an upscale of the 400 px `assets/icon.png`. Reason: no larger source exists. The icon is flat shapes, so the upscale stays clean.
- `InstallCommand` takes a `command` prop with the default `npm install -g rowbly`. Reason: ROW-53 needs one copy button for each command, and one component with a prop is smaller than a second component.
- The mobile menu breakpoint is 768 px (the Tailwind `md` breakpoint). Reason: it is the Tailwind default, and the Story gives no value.
- The web manifest has only the 512 px icon. Reason: the Story names only these four sizes, and the site is not an installable app.

## Review findings

1. `website/src/routes/__root.tsx` (lines 1-5 and 12-22): the pull request has a merge conflict with `origin/main`. ROW-46 (PR #242, merged) adds `import { NotFoundPage } from "@/components/not-found-page";` and `notFoundComponent: NotFoundPage` to the root route, next to the lines that this pull request changes (the imports and `links`). GitHub shows the pull request as `CONFLICTING`. `CHANGELOG.md` also has a conflict. Fix: merge `origin/main` into `story/ROW-47`. Keep both changes in `__root.tsx` (the header, footer, icon links and manifest link, and `notFoundComponent: NotFoundPage`). Keep both `CHANGELOG.md` entries and both `website/README.md` sections. After the merge, the 404 page renders inside the root layout: `website/src/components/not-found-page.tsx` has its own `<main className="flex min-h-screen ...">`, so it becomes a nested `<main>` inside the `<main>` of the layout. Change its outer element to a `div` (and remove `min-h-screen`, or use a smaller height), so that the page has one `<main>`. Then run `pnpm --dir website build`, make sure that `dist/client/404.html` is written and has the header and footer, and run the root checks again.
