---
title: Check the website for accessibility, motion and performance
stage: DONE
position: 66
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-56
pull_request: https://github.com/sgolovine/rowbly/pull/253
---

## Goal

Check the whole website (`website/`) for accessibility, motion, performance and layout before the launch, and repair the problems that you find. The user gets a site that is fast, that works with a keyboard and a screen reader, that obeys reduced motion and that fits all usual screen widths.

## Scope

In scope:

- Run Lighthouse on the prerendered pages `/`, `/how-it-works` and `/install`, with the mobile and the desktop presets, against `pnpm --dir website build` and `pnpm --dir website preview`.
- Check `prefers-reduced-motion: reduce`: all loops, count-ups, typing, pulses, the cursor blink, smooth scroll and fades stop and show the final state. The known motion is in `src/components/landing/animated-board.tsx`, `count-up.tsx`, `watch-live.tsx`, `board-shot.tsx` (`animate-ring-pulse`), `src/components/how-it-works/the-factory.tsx` and `src/styles/app.css`.
- Check keyboard navigation: a visible focus ring on each link, button, tab, tooltip trigger and the mobile menu button. Add a "Skip to content" link. The site does not have one now.
- Check the colour contrast of the text colours on the dark backgrounds (WCAG 2.1 AA): `brand-muted` (#9a9ca3), `brand-accent` (#f5b841), `brand-story-key` (#56b6e8) and `brand-text` on `brand-background` (#111214) and `brand-surface` (#17181b).
- Check the layout at 360, 390, 768, 1024, 1280 and 1440 px wide on the three pages and on the 404 page.
- Check that each content image has alt text and that each decorative image has `alt=""` (or `aria-hidden`).
- Check that the total transfer size of the home page on first load is less than 1 MB. If it is more, make the images smaller (for example WebP, `loading="lazy"`, `width` and `height`, or `srcset`).
- Repair each problem that you find in `website/`.

Not in scope:

- A committed Lighthouse dependency, script or CI job. Run Lighthouse with `pnpm dlx lighthouse` or a local Chrome, and do not commit it.
- New content, new sections or new copy, except the "Skip to content" link and alt text.
- The new TUI screenshots of ROW-55 and their use on the site.
- Changes to `src/` of the CLI.

## Acceptance criteria

- [ ] Lighthouse (mobile preset) gives scores of 90 or more for Performance, Accessibility, Best Practices and SEO on `/`, `/how-it-works` and `/install` of the built site. The PR shows the scores of the mobile and the desktop runs.
- [ ] Each page has a "Skip to content" link as the first focusable element. It is visible when it has focus, and it moves focus to `<main>` (for example `<main id="main-content" tabIndex={-1}>`).
- [ ] With the keyboard only, a person can reach each link, button, tab and tooltip trigger, and each one shows a visible focus ring. A person examines this.
- [ ] With `prefers-reduced-motion: reduce` (Chrome DevTools rendering emulation or Playwright `reducedMotion: "reduce"`), no element animates, and the count-ups, the typing conversation and the animated board show their final state. A person or a Playwright script examines this.
- [ ] At each width of 360, 390, 768, 1024, 1280 and 1440 px, `document.documentElement.scrollWidth` is not more than `window.innerWidth` on `/`, `/how-it-works`, `/install` and `/404`.
- [ ] Each `<img>` has an `alt` attribute. A content image has a description. A decorative image has `alt=""`. `grep -rn "<img" website/src` and the Lighthouse Accessibility audit examine this.
- [ ] Each text colour pair in the scope has a contrast ratio of minimum 4.5:1 (3:1 for large text), or the PR changes the colour so that it has this ratio.
- [ ] The total transfer size of `/` on first load (no cache) is less than 1 MB. The PR shows the value from Lighthouse or DevTools.
- [ ] `pnpm lint`, `pnpm --dir website typecheck` and `pnpm --dir website build` pass.
- [ ] The PR description lists each problem that you found and its repair.

## Technical notes

- The website is a separate pnpm package in `website/` (TanStack Start, Tailwind CSS v4, shadcn/ui). Read `website/README.md`. Install with `pnpm --dir website install`. The build prerenders static files to `website/dist/client/`.
- The root layout is `website/src/routes/__root.tsx`. Put the skip link and the `id` of `<main>` there. The header is `src/components/site-header.tsx`.
- Use only the brand colours of `src/styles/app.css`. Do not add other hues. If a contrast repair is necessary, change the lightness of an existing brand colour.
- The CSS motion is already in `@media (prefers-reduced-motion: no-preference)` blocks and `motion-safe:` variants. The JS motion reads `matchMedia("(prefers-reduced-motion: reduce)")`. Examine each of them and repair the gaps.
- The images are in `website/public/images/` (`screenshot.png` 249 KB, `board.png` 191 KB, `board-no-tags.png` 114 KB, `header.png` 35 KB, `icon.png` 11 KB). They are the most probable cause of a large page weight.
- Google Chrome (`/usr/bin/google-chrome`) and Playwright Chromium are available on the development machine for Lighthouse and layout checks.
- All page Stories (ROW-47 to ROW-54) are done.
- Write all Markdown in ASD-STE100 Simplified Technical English.

## Assumptions

- Lighthouse runs against the local production build (`vite preview`), not against `https://rowbly.com`. Reason: the site can be not deployed yet, and the local build is the code of the PR.
- The 90 score target applies to the mobile preset. The desktop runs are reported only. Reason: the original criteria say "(mobile)".
- No Lighthouse tool or CI check is committed. Reason: the smallest scope that satisfies the intent of the author is a manual check with the results in the PR.
- The 404 page is in the layout check, but not in the Lighthouse check. Reason: it is static HTML with a small scope, and the author listed only three pages for Lighthouse.
- The work does not wait for ROW-55 (screenshots). Reason: ROW-55 does not change the website components, and its images are not used on the site yet.
